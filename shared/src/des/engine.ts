// The request engine: one request at a time.
//
// The flow engine works in rates and answers in a few milliseconds, which is what
// makes it usable while drawing. What it cannot show is anything that depends on
// requests meeting each other — a burst inside one second, a queue that forms and
// drains, a dependency that is fine on average and terrible for one caller in a
// hundred. This engine follows each request through the parts it visits, on a
// clock that jumps from one event to the next.
//
// Phase 1 of docs/superpowers/specs/2026-10-10-request-engine-design.md: sources,
// queues of cores, calls along connections, the wire, and the statistics. The
// result is its own shape for now; mapping it onto the flow engine's result is
// phase 3.

import { rateAt, type Scenario } from '../engine.js';
import { callCount } from './dist.js';
import { EventHeap } from './heap.js';
import { buildModel, type Link, type Part, type ServiceOverride } from './model.js';
import { createRng, type Rng } from './rng.js';
import { LatencyHistogram } from './stats.js';
import type { GraphDSL } from '../types.js';

export interface DesOptions {
  /** Same seed, same run. */
  seed?: number;
  /** Seconds at the start whose waits and response times are not counted. */
  warmupS?: number;
  /** Test hook: replace named parts' log-normal service time. */
  service?: Record<string, ServiceOverride>;
}

export interface DesTick {
  t: number;
  /** Requests that arrived at a source in this second. */
  offered: number;
  /** Requests that finished end-to-end in this second. */
  completed: number;
  p50Ms: number;
  p99Ms: number;
}

export interface DesPart {
  nodeId: string;
  /** Visits that reached this part. */
  arrivals: number;
  completed: number;
  /** 0 when elastic. */
  servers: number;
  elastic: boolean;
  /** Time spent queueing for a core, per visit, ms. */
  meanWaitMs: number;
  waitP99Ms: number;
  /** Busy core-time over available core-time, after warm-up. */
  utilization: number;
}

export interface DesResult {
  seed: number;
  /** Events handled: the measure of how much work the run was. */
  events: number;
  ticks: DesTick[];
  parts: DesPart[];
  completed: number;
  meanResponseMs: number;
  p99ResponseMs: number;
  assumptions: string[];
}

interface Frame {
  part: number;
  calls: Link[];
  next: number;
  /** The connection this visit came in on, for the way back. Null at the source. */
  via: Link | null;
}

interface Request {
  startedAt: number;
  stack: Frame[];
}

const ARRIVE = 0;
const ENTER = 1;
const WORK_DONE = 2;
const REPLY = 3;

interface Event {
  kind: number;
  /** Source index for ARRIVE, part index for ENTER. */
  at: number;
  request: Request | null;
  link: Link | null;
}

interface Waiting {
  request: Request;
  work: number;
  since: number;
}

class PartState {
  busy = 0;
  queue: Waiting[] = [];
  head = 0;
  arrivals = 0;
  completed = 0;
  busyMs = 0;
  waits = new LatencyHistogram();
}

const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

function pickWeighted(rng: Rng, links: Link[]): Link | undefined {
  const total = links.reduce((sum, l) => sum + l.share, 0);
  if (!(total > 0)) return undefined;
  let r = rng() * total;
  for (const link of links) {
    r -= link.share;
    if (r < 0) return link;
  }
  return links[links.length - 1];
}

export function runDes(graph: GraphDSL, scenario: Scenario, options: DesOptions = {}): DesResult {
  const seed = options.seed ?? 1;
  const rng = createRng(seed);
  const model = buildModel(graph, options.service);
  const { parts, sources } = model;
  const state = parts.map(() => new PartState());

  const horizonMs = Math.max(0, scenario.horizonS) * 1000;
  const warmupMs = Math.max(0, options.warmupS ?? 0) * 1000;
  const seconds = Math.ceil(horizonMs / 1000);
  const offered = new Array<number>(seconds).fill(0);
  const completed = new Array<number>(seconds).fill(0);
  const perSecond = Array.from({ length: seconds }, () => new LatencyHistogram());
  const overall = new LatencyHistogram();

  const heap = new EventHeap<Event>();
  let now = 0;
  let events = 0;

  const schedule = (time: number, kind: number, at: number, request: Request | null, link: Link | null) =>
    heap.push(time, { kind, at, request, link });

  // -------------------------------------------------------------- arrivals --

  const rateOf = (sourceIndex: number, second: number): number => {
    const { part, baseRps } = sources[sourceIndex]!;
    const pattern = scenario.patterns?.[parts[part]!.node.id] ?? { shape: 'steady' as const, baseRps };
    return rateAt({ ...pattern, baseRps: pattern.baseRps ?? baseRps }, second) * scenario.loadMultiplier;
  };

  /**
   * The next arrival after `from`. The rate is held for each whole second, as the
   * flow engine holds it; a gap that would cross into the next second restarts at
   * the boundary with that second's rate, which is exact because the exponential
   * has no memory.
   */
  const scheduleArrival = (sourceIndex: number, from: number): void => {
    let t = from;
    while (t < horizonMs) {
      const second = Math.floor(t / 1000);
      const boundary = (second + 1) * 1000;
      const rate = rateOf(sourceIndex, second);
      if (rate > 0) {
        const next = t - Math.log(1 - rng()) * (1000 / rate);
        if (next < boundary) {
          if (next < horizonMs) schedule(next, ARRIVE, sourceIndex, null, null);
          return;
        }
      }
      t = boundary;
    }
  };

  // ------------------------------------------------------------- the parts --

  const grant = (p: number, waiting: Waiting): void => {
    const s = state[p]!;
    s.busy += 1;
    if (now >= warmupMs) {
      s.waits.add(now - waiting.since);
      s.busyMs += waiting.work;
    }
    schedule(now + waiting.work, WORK_DONE, p, waiting.request, null);
  };

  const enter = (request: Request, p: number, via: Link | null): void => {
    const part: Part = parts[p]!;
    const s = state[p]!;
    s.arrivals += 1;

    // Which calls this visit makes, decided on the way in. A part already on this
    // request's call chain is not called again: a drawn cycle is a loop, not a
    // request that never ends.
    const onChain = (to: number) => request.stack.some((f) => f.part === to);
    const calls: Link[] = [];
    if (part.routes) {
      const picked = pickWeighted(rng, part.out);
      if (picked && !onChain(picked.to)) calls.push(picked);
    } else {
      for (const link of part.out) {
        if (onChain(link.to)) continue;
        for (let n = callCount(rng, link.share); n > 0; n -= 1) calls.push(link);
      }
    }
    request.stack.push({ part: p, calls, next: 0, via });

    const work = part.sample(rng);
    const waiting: Waiting = { request, work, since: now };
    if (s.busy < part.servers) grant(p, waiting);
    else s.queue.push(waiting);
  };

  const workDone = (p: number, request: Request): void => {
    const s = state[p]!;
    s.busy -= 1;
    if (s.head < s.queue.length) {
      const next = s.queue[s.head]!;
      s.head += 1;
      if (s.head > 1024 && s.head * 2 > s.queue.length) {
        s.queue = s.queue.slice(s.head);
        s.head = 0;
      }
      grant(p, next);
    }
    callNext(request);
  };

  /** Make the next call this visit owes, or answer whoever called it. */
  const callNext = (request: Request): void => {
    const frame = request.stack[request.stack.length - 1]!;
    const link = frame.calls[frame.next];
    if (link) {
      frame.next += 1;
      schedule(now + link.halfRttMs, ENTER, link.to, request, link);
      return;
    }

    request.stack.pop();
    state[frame.part]!.completed += 1;
    if (frame.via) {
      schedule(now + frame.via.halfRttMs, REPLY, frame.part, request, null);
      return;
    }

    // Back at the source: the request is done.
    const second = Math.floor(now / 1000);
    if (second < seconds) {
      completed[second]! += 1;
      perSecond[second]!.add(now - request.startedAt);
    }
    if (request.startedAt >= warmupMs) overall.add(now - request.startedAt);
  };

  // -------------------------------------------------------------- the loop --

  sources.forEach((_, i) => scheduleArrival(i, 0));

  for (;;) {
    const next = heap.pop();
    if (!next || next.time >= horizonMs) break;
    now = next.time;
    events += 1;
    const event = next.value;

    switch (event.kind) {
      case ARRIVE: {
        offered[Math.floor(now / 1000)]! += 1;
        scheduleArrival(event.at, now);
        enter({ startedAt: now, stack: [] }, sources[event.at]!.part, null);
        break;
      }
      case ENTER:
        enter(event.request!, event.at, event.link);
        break;
      case WORK_DONE:
        workDone(event.at, event.request!);
        break;
      case REPLY:
        callNext(event.request!);
        break;
    }
  }

  // ------------------------------------------------------------ the answer --

  const measuredMs = Math.max(1, horizonMs - warmupMs);
  return {
    seed,
    events,
    ticks: offered.map((n, t) => ({
      t,
      offered: n,
      completed: completed[t]!,
      p50Ms: round(perSecond[t]!.percentile(0.5)),
      p99Ms: round(perSecond[t]!.percentile(0.99)),
    })),
    parts: parts.map((part, i) => {
      const s = state[i]!;
      const elastic = !Number.isFinite(part.servers);
      return {
        nodeId: part.node.id,
        arrivals: s.arrivals,
        completed: s.completed,
        servers: elastic ? 0 : part.servers,
        elastic,
        meanWaitMs: round(s.waits.mean, 4),
        waitP99Ms: round(s.waits.percentile(0.99)),
        utilization: elastic ? 0 : round(s.busyMs / (part.servers * measuredMs), 3),
      };
    }),
    completed: overall.count,
    meanResponseMs: round(overall.mean),
    p99ResponseMs: round(overall.percentile(0.99)),
    assumptions: model.assumptions,
  };
}
