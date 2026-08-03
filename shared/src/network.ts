// What distance costs.
//
// Until now an edge was free: two boxes in one rack and two boxes on opposite
// sides of the planet contributed identically to a request's latency, which is
// zero. That made multi-region active-active the one architecture in the
// catalogue with no downside, and distance is the entire downside.
//
// The cost lands twice, which is the part worth understanding. It is added to the
// latency a reader sees — and, because a caller waiting on the wire is a caller
// holding a worker, it is also charged against the caller's concurrency in
// `engine.ts`. A synchronous cross-region call does not merely make one request
// slower; it costs the calling service throughput it never knew it had.
//
// The numbers are round. Same-AZ and cross-AZ come from provider documentation;
// the region pairs are measured. Anyone who disagrees can state a region on both
// ends and get the measured pair, or set the placement outright.

export type Placement = 'same-host' | 'same-az' | 'cross-az' | 'cross-region' | 'internet';

/** What an unannotated edge means: two boxes in one zone. */
export const DEFAULT_PLACEMENT: Placement = 'same-az';

/** Round-trip milliseconds by placement, before any region pair is consulted. */
export const PLACEMENT_RTT_MS: Record<Placement, number> = {
  /** Loopback or a unix socket. Not zero, but close enough that it rounds to it. */
  'same-host': 0.05,
  /** Within one availability zone. */
  'same-az': 0.5,
  /** Between zones in one region — provider-documented single-digit milliseconds. */
  'cross-az': 1,
  /** A client on the public internet reaching an edge. */
  internet: 40,
  /** Overridden by the measured pair whenever both ends name a region. */
  'cross-region': 70,
};

/**
 * Measured round-trip times between regions, milliseconds.
 *
 * A deliberately small starting set. Keys are sorted-and-joined so one entry
 * serves both directions: distance is symmetric, and storing it twice is an
 * invitation for the two halves to drift apart.
 */
export const REGION_RTT_MS: Record<string, number> = {
  'ap-southeast-1|eu-west-1': 175,
  'ap-southeast-1|us-east-1': 215,
  'eu-central-1|us-east-1': 90,
  'eu-west-1|us-east-1': 75,
  'eu-west-1|us-west-2': 130,
  'us-east-1|us-east-2': 12,
  'us-east-1|us-west-2': 62,
};

const pairKey = (a: string, b: string): string => [a, b].sort().join('|');

/** What placement two regions imply, when the edge itself does not say. */
export function inferPlacement(fromRegion?: string, toRegion?: string): Placement {
  if (!fromRegion || !toRegion) return DEFAULT_PLACEMENT;
  return fromRegion === toRegion ? 'same-az' : 'cross-region';
}

/**
 * Round-trip milliseconds for one hop.
 *
 * A stated region pair always beats the placement label. If both ends say
 * `us-east-1` they are not far apart however the edge is annotated, and if they
 * name different regions the measured distance is better than a generic 70. A
 * half-stated pair says nothing, so the label stands.
 */
export function rttMs(
  placement: Placement | undefined,
  fromRegion?: string,
  toRegion?: string,
): number {
  if (fromRegion && toRegion) {
    if (fromRegion === toRegion) return PLACEMENT_RTT_MS['same-az'];
    return REGION_RTT_MS[pairKey(fromRegion, toRegion)] ?? PLACEMENT_RTT_MS['cross-region'];
  }
  return PLACEMENT_RTT_MS[placement ?? DEFAULT_PLACEMENT];
}
