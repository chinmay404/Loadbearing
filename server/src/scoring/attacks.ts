// Attacks the coach proposes, checked against the drawing before they are believed.
//
// The failure mode this exists to prevent is specific and it has already happened
// once, to hand-written content: a scenario that names a component the sheet does not
// have kills nothing, slows nothing, runs clean, and reports a pass. Three of the
// bank's own gates were doing exactly that until a test caught them.
//
// A model will produce that mistake far more readily than a person will. So nothing
// here trusts a name: every component a scenario mentions is resolved against the
// graph, and an attack left with no lever at all is dropped rather than shipped as a
// gate that cannot fail.

import { resolveKillIds, unmatchedDegradations, type Degradation, type GraphDSL } from '@loadbearing/shared';

/** A scenario the coach devised, plus what the engine will actually do with it. */
export interface Attack {
  id: string;
  name: string;
  description: string;
  /** What it expects to break. Stated before the run, so it can be wrong. */
  hypothesis: string;
  rpsMultiplier: number;
  killNodes: string[];
  degrade: Degradation[];
  thirdPartyLatencyMs: number;
  passCriteria: string;
  /**
   * Components it named that are not on the sheet.
   *
   * Surfaced rather than hidden: a name that missed is the difference between "your
   * design survived this" and "nothing happened", and the learner is owed the
   * distinction.
   */
  unresolved: string[];
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const slug = (v: string, fallback: string): string => {
  const out = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
};

/**
 * One degradation, kept only if it asks for something the engine can do.
 *
 * A degradation with a node but no effect is the subtlest version of the void
 * scenario: it resolves, it looks configured, and it changes nothing.
 */
function readDegradation(raw: unknown): Degradation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const node = str(o.node);
  if (!node) return null;

  const d: Degradation = { node };
  if (typeof o.addMs === 'number' && o.addMs > 0) d.addMs = clamp(o.addMs, 1, 60_000);
  if (typeof o.latencyMultiple === 'number' && o.latencyMultiple > 1) {
    d.latencyMultiple = clamp(o.latencyMultiple, 1.1, 200);
  }
  if (typeof o.capacityMultiple === 'number' && o.capacityMultiple >= 0 && o.capacityMultiple < 1) {
    d.capacityMultiple = o.capacityMultiple;
  }
  if (typeof o.hitRate === 'number' && o.hitRate >= 0 && o.hitRate <= 1) d.hitRate = o.hitRate;

  const asks = d.addMs ?? d.latencyMultiple ?? d.capacityMultiple ?? d.hitRate;
  return asks === undefined ? null : d;
}

/**
 * The model's answer, reduced to attacks that will actually do something.
 *
 * Dropped, in order of how quietly they would have failed: an attack with no lever at
 * all; one whose only lever is a name the sheet does not contain; one that is a
 * duplicate of another. What survives is annotated with the names that missed, so the
 * UI can say "this ran, minus the part about Cassandra" instead of implying otherwise.
 */
export function validateAttacks(raw: unknown, graph: GraphDSL, limit = 4): Attack[] {
  const list = Array.isArray((raw as { attacks?: unknown })?.attacks)
    ? ((raw as { attacks: unknown[] }).attacks)
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];

  const out: Attack[] = [];
  const seen = new Set<string>();

  for (const [i, item] of list.entries()) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;

    const name = str(o.name) || `Attack ${i + 1}`;
    const id = slug(str(o.id) || name, `attack-${i + 1}`);
    if (seen.has(id)) continue;

    const wantedKills = (Array.isArray(o.killNodes) ? o.killNodes : []).filter(
      (k): k is string => typeof k === 'string' && k.trim() !== '',
    );
    // Resolved with the same matcher the engine uses, so what is reported as
    // resolvable is exactly what will be killed.
    const resolvedKills = resolveKillIds(graph, wantedKills);
    const missedKills = wantedKills.filter(
      (k) =>
        !graph.nodes.some(
          (n) => n.id.toLowerCase() === k.toLowerCase() || n.label.toLowerCase() === k.toLowerCase(),
        ),
    );

    const wantedDegrade = (Array.isArray(o.degrade) ? o.degrade : [])
      .map(readDegradation)
      .filter((d): d is Degradation => d !== null);
    const missedDegrade = unmatchedDegradations(graph, wantedDegrade);
    const liveDegrade = wantedDegrade.filter((d) => !missedDegrade.includes(d.node));

    const rpsMultiplier = clamp(num(o.rpsMultiplier, 1), 0, 1000);
    const thirdPartyLatencyMs = clamp(num(o.thirdPartyLatencyMs, 0), 0, 60_000);

    // Does anything remain that the engine will act on?
    const hasLever =
      rpsMultiplier > 1 ||
      resolvedKills.length > 0 ||
      liveDegrade.length > 0 ||
      (thirdPartyLatencyMs > 0 && graph.nodes.some((n) => n.type === 'third_party'));
    if (!hasLever) continue;

    seen.add(id);
    out.push({
      id,
      name,
      description: str(o.description),
      hypothesis: str(o.hypothesis),
      rpsMultiplier,
      // The resolved ids, not the names: nothing downstream should have to match again.
      killNodes: resolvedKills,
      degrade: liveDegrade,
      thirdPartyLatencyMs,
      passCriteria: str(o.passCriteria) || 'Traffic keeps completing and no flow breaks.',
      unresolved: [...new Set([...missedKills, ...missedDegrade])],
    });
    if (out.length >= limit) break;
  }

  return out;
}
