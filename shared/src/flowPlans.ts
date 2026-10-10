// Requests a sheet asks for, and where they go in a drawing.
//
// Declaring a flow used to be five unexplained decisions — a name, a kind, a
// rate, a guarantee, and steps picked from a dropdown in order. A sheet already
// knows the first three, and the drawing already says the last one: the arrows
// are the path. This turns "declare a flow" into "confirm the path we found".

import { requestPaths } from './engine.js';
import type { FlowKind, FlowPlan, GraphDSL, Problem } from './types.js';

/** What an underived plan assumes, and what a new flow defaults to anyway. */
export const DEFAULT_PLAN_RPS = 100;
/** More than this many paths is a list nobody reads. */
const MAX_CHOICES = 4;

const KIND_WORDS: [FlowKind, RegExp][] = [
  ['admin', /\badmin/],
  ['async', /\b(job|jobs|worker|background|generation|export|nightly|process|processing|resize|fan-?out|digest|reindex)/],
  ['write', /(upload|writ|creat|updat|delet|checkout|pay|send|import|post|submit|reserv|charge|register|sign ?up|shorten)/],
];

export function guessFlowKind(name: string): FlowKind {
  const n = name.toLowerCase();
  for (const [kind, re] of KIND_WORDS) if (re.test(n)) return kind;
  return 'read';
}

export const sameFlowName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One plan per expected flow: the authored one when it exists, a guessed one when not. */
export function plansFor(problem: Pick<Problem, 'expectedFlows' | 'flowPlans'>): FlowPlan[] {
  const authored = problem.flowPlans ?? [];
  return problem.expectedFlows.map(
    (name) =>
      authored.find((p) => sameFlowName(p.name, name)) ?? {
        name,
        kind: guessFlowKind(name),
        rps: DEFAULT_PLAN_RPS,
        plain: '',
      },
  );
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Distinct request paths of two or more steps, from where traffic starts. */
export function candidatePaths(graph: GraphDSL): string[][] {
  const out: string[][] = [];
  for (const { nodeIds } of requestPaths(graph)) {
    if (nodeIds.length >= 2 && !out.some((p) => same(p, nodeIds))) out.push(nodeIds);
  }
  return out;
}

export type PathMatch =
  | { status: 'found'; path: string[] }
  | { status: 'choose'; paths: string[][] }
  | { status: 'none' };

/**
 * The path in the drawing this request takes.
 *
 * A path qualifies when it passes through one type from every `mustReach` group;
 * it is cut just after the last group is reached, because an upload ends at the
 * storage it writes to even if the drawing carries on past it. The shortest
 * qualifying paths win; one is "found", several are offered as a choice.
 */
export function matchPath(plan: FlowPlan, graph: GraphDSL): PathMatch {
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const groups = plan.mustReach ?? [];
  const fits: string[][] = [];
  for (const path of candidatePaths(graph)) {
    let end = 1;
    let ok = true;
    for (const group of groups) {
      const at = path.findIndex((id) => group.includes(typeOf.get(id)!));
      if (at < 0) {
        ok = false;
        break;
      }
      end = Math.max(end, at);
    }
    if (!ok) continue;
    const steps = handOff(plan, groups.length ? path.slice(0, end + 1) : path, graph);
    if (!fits.some((f) => same(f, steps))) fits.push(steps);
  }
  if (fits.length === 0) return { status: 'none' };
  if (groups.length === 0) return { status: 'choose', paths: fits.slice(0, MAX_CHOICES) };
  const shortest = Math.min(...fits.map((f) => f.length));
  const best = fits.filter((f) => f.length === shortest);
  return best.length === 1
    ? { status: 'found', path: best[0]! }
    : { status: 'choose', paths: best.slice(0, MAX_CHOICES) };
}

/**
 * Background work starts where the request hands it off. Every flow that starts at
 * the user is traffic the user sends, so an email flow walked from the user would
 * double the signup load in the simulator; started at the component that enqueues
 * it, it carries exactly the requests that reach that component.
 */
function handOff(plan: FlowPlan, steps: string[], graph: GraphDSL): string[] {
  if (plan.kind !== 'async') return steps;
  const at = steps.findIndex((id, i) =>
    i < steps.length - 1 && graph.edges.some((e) => e.from === id && e.to === steps[i + 1] && e.kind === 'async'),
  );
  return at > 0 ? steps.slice(at) : steps;
}

/**
 * True when a flow's steps no longer describe a path in the drawing — a step was
 * deleted, or nothing earlier in the flow calls it. The same rule the simulator
 * applies, so the card and the load run never disagree.
 */
export function isPathBroken(steps: string[], graph: GraphDSL): boolean {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return steps.some(
    (id, i) =>
      !ids.has(id) ||
      (i > 0 && !graph.edges.some((e) => e.to === id && steps.slice(0, i).includes(e.from))),
  );
}
