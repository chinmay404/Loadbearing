// Graduated pricing is easy to get backwards, and getting it backwards is not
// visible in the output — it just produces a wrong number that looks like a right
// one. So these check the band arithmetic against examples worked by hand.

import { describe, expect, it } from 'vitest';
import { costOfShape, costOfUnits, describeShape, monthlyCost, type PricingShape } from './pricing.js';

const flat = (usd: number) => [{ fromUnits: 0, usd }];

/** AWS-shaped egress: first 10TB dearer, then it steps down. */
const EGRESS = [
  { fromUnits: 0, usd: 0.09 },
  { fromUnits: 10_240, usd: 0.085 },
  { fromUnits: 51_200, usd: 0.07 },
];

describe('costOfUnits', () => {
  it('is nothing for nothing', () => {
    expect(costOfUnits(flat(0.09), 0)).toBe(0);
    expect(costOfUnits([], 100)).toBe(0);
    expect(costOfUnits(flat(0.09), -5)).toBe(0);
  });

  it('is a plain multiplication when there is one band', () => {
    expect(costOfUnits(flat(0.09), 1000)).toBeCloseTo(90, 6);
  });

  it('charges each band only for what falls inside it', () => {
    // 20,000 GB: 10,240 at $0.09, then 9,760 at $0.085.
    const expected = 10_240 * 0.09 + 9_760 * 0.085;
    expect(costOfUnits(EGRESS, 20_000)).toBeCloseTo(expected, 6);
  });

  it('does not apply the cheapest band retroactively to everything', () => {
    // The mistake worth guarding: 60,000 x $0.07 would be $4,200, and wrong.
    const graduated = 10_240 * 0.09 + (51_200 - 10_240) * 0.085 + (60_000 - 51_200) * 0.07;
    expect(costOfUnits(EGRESS, 60_000)).toBeCloseTo(graduated, 6);
    expect(costOfUnits(EGRESS, 60_000)).toBeGreaterThan(60_000 * 0.07);
  });

  it('stays inside the first band below its ceiling', () => {
    expect(costOfUnits(EGRESS, 5_000)).toBeCloseTo(5_000 * 0.09, 6);
  });

  it('does not care what order the bands arrive in', () => {
    expect(costOfUnits([...EGRESS].reverse(), 20_000)).toBeCloseTo(
      costOfUnits(EGRESS, 20_000),
      6,
    );
  });
});

describe('costOfShape', () => {
  it('reads the units its own kind bills in', () => {
    const perHour: PricingShape = { kind: 'per-hour', tiers: flat(0.192) };
    expect(costOfShape(perHour, { hours: 720 })).toBeCloseTo(138.24, 4);
    // Given the wrong unit it charges nothing rather than guessing.
    expect(costOfShape(perHour, { gbMonth: 720 })).toBe(0);
  });

  it('handles every one of the six', () => {
    const usage = {
      hours: 1,
      millionRequests: 1,
      gbMonth: 1,
      gbTransferred: 1,
      gbSeconds: 1,
      provisionedUnitHours: 1,
    };
    const shapes: PricingShape[] = [
      { kind: 'per-hour', tiers: flat(1) },
      { kind: 'per-million-requests', tiers: flat(2) },
      { kind: 'per-gb-month', tiers: flat(3) },
      { kind: 'per-gb-transferred', tiers: flat(4) },
      { kind: 'per-gb-second', tiers: flat(5) },
      { kind: 'per-provisioned-unit-hour', tiers: flat(6), unit: 'RCU' },
    ];
    for (const shape of shapes) expect(costOfShape(shape, usage)).toBeGreaterThan(0);
    expect(monthlyCost(shapes, usage)).toBeCloseTo(21, 6);
  });
});

describe('describeShape', () => {
  it('names the rate and says when it is graduated', () => {
    expect(describeShape({ kind: 'per-hour', tiers: flat(0.192) })).toBe('$0.192 an hour');
    expect(describeShape({ kind: 'per-gb-transferred', tiers: EGRESS })).toContain(
      'graduated over 3 bands',
    );
  });

  it('names the unit of a provisioned shape', () => {
    expect(
      describeShape({ kind: 'per-provisioned-unit-hour', tiers: flat(0.00013), unit: 'RCU' }),
    ).toContain('per RCU an hour');
  });
});
