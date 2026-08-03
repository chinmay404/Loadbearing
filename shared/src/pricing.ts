// The six ways a cloud charges you.
//
// Cloud billing looks like hundreds of models and is in practice six shapes. That
// is the load-bearing simplification behind supporting three providers: `cost.ts`
// learns six formulas, and every service becomes DATA filling one of them. Adding
// DynamoDB or Cloud Run is then an ingest change, not a code change.
//
// Every shape carries a tier list rather than a flat rate. This is not optional
// sophistication — GCP's catalogue is explicitly graduated, and so are AWS egress
// and object storage. A flat-rate model silently reads tier one and is therefore
// wrong precisely where cost becomes the interesting question. A flat rate is a
// list of one, so the common case stays trivial.

/** A graduated price band. `fromUnits` is where this rate starts applying. */
export interface Tier {
  fromUnits: number;
  usd: number;
}

export type PricingShape =
  /** Instances, databases, anything billed for existing. */
  | { kind: 'per-hour'; tiers: Tier[] }
  /** Gateways, queues, object GETs. */
  | { kind: 'per-million-requests'; tiers: Tier[] }
  /** Disks, buckets, snapshots. */
  | { kind: 'per-gb-month'; tiers: Tier[] }
  /** Egress — the line that is largest on a media bill and absent from most models. */
  | { kind: 'per-gb-transferred'; tiers: Tier[] }
  /** Lambda, Cloud Functions: memory multiplied by time. */
  | { kind: 'per-gb-second'; tiers: Tier[] }
  /** DynamoDB capacity units, provisioned IOPS. */
  | { kind: 'per-provisioned-unit-hour'; tiers: Tier[]; unit: string };

export type PricingKind = PricingShape['kind'];

/** What a month of usage looks like, in the units the six shapes bill. */
export interface Usage {
  hours?: number;
  millionRequests?: number;
  gbMonth?: number;
  gbTransferred?: number;
  gbSeconds?: number;
  provisionedUnitHours?: number;
}

/** Hours in the month every bill here is expressed over. */
export const HOURS_PER_MONTH = 24 * 30;

const UNITS_OF: Record<PricingKind, keyof Usage> = {
  'per-hour': 'hours',
  'per-million-requests': 'millionRequests',
  'per-gb-month': 'gbMonth',
  'per-gb-transferred': 'gbTransferred',
  'per-gb-second': 'gbSeconds',
  'per-provisioned-unit-hour': 'provisionedUnitHours',
};

/**
 * Cost of `units`, charged **graduated**: each band's rate applies only to the
 * units that fall inside it.
 *
 * Graduated rather than flat-at-the-highest-band, because that is what every
 * provider here actually does — the first 10TB of egress stays at the first-10TB
 * price even after you pass it. Getting this backwards overcharges small
 * designs and undercharges large ones, in both cases most at the moment somebody
 * is trying to make a decision from the number.
 */
export function costOfUnits(tiers: readonly Tier[], units: number): number {
  const amount = Math.max(0, units);
  if (amount <= 0 || tiers.length === 0) return 0;

  const sorted = [...tiers].sort((a, b) => a.fromUnits - b.fromUnits);
  let total = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const from = Math.max(0, sorted[i]!.fromUnits);
    if (amount <= from) break;
    const to = i + 1 < sorted.length ? sorted[i + 1]!.fromUnits : Infinity;
    const inBand = Math.min(amount, to) - from;
    if (inBand > 0) total += inBand * sorted[i]!.usd;
  }
  return total;
}

/** What one pricing shape costs for a month of the usage given. */
export function costOfShape(shape: PricingShape, usage: Usage): number {
  const units = usage[UNITS_OF[shape.kind]] ?? 0;
  return costOfUnits(shape.tiers, units);
}

/** What a SKU's whole price list costs for a month of the usage given. */
export function monthlyCost(shapes: readonly PricingShape[], usage: Usage): number {
  return shapes.reduce((sum, shape) => sum + costOfShape(shape, usage), 0);
}

/** A one-line explanation of a shape, for the basis string the UI shows. */
export function describeShape(shape: PricingShape): string {
  const first = [...shape.tiers].sort((a, b) => a.fromUnits - b.fromUnits)[0];
  const rate = first ? `$${first.usd}` : 'no rate';
  const graduated = shape.tiers.length > 1 ? `, graduated over ${shape.tiers.length} bands` : '';
  switch (shape.kind) {
    case 'per-hour':
      return `${rate} an hour${graduated}`;
    case 'per-million-requests':
      return `${rate} per million requests${graduated}`;
    case 'per-gb-month':
      return `${rate} per GB stored a month${graduated}`;
    case 'per-gb-transferred':
      return `${rate} per GB moved${graduated}`;
    case 'per-gb-second':
      return `${rate} per GB-second${graduated}`;
    case 'per-provisioned-unit-hour':
      return `${rate} per ${shape.unit} an hour${graduated}`;
  }
}
