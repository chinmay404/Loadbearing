// The bill, and whether it moves when the design does.
//
// Cost used to be a number you typed, which meant it never changed when you added
// replicas, doubled storage or spread a database across zones. The whole value of
// calculating it is that it responds — so most of these tests are of the form "change
// one thing, check the money moved in the right direction and by the right amount".

import { describe, expect, it } from 'vitest';
import { costOfNode, costReport, RATES, SECONDS_PER_MONTH } from './cost.js';
import type { ArchNodeType, GraphNode, NodeAttrs } from './types.js';

const node = (id: string, type: ArchNodeType, attrs: NodeAttrs = {}): GraphNode => ({
  id,
  type,
  label: id,
  annotation: '',
  attrs,
});

describe('what you provision', () => {
  it('prices compute by the size of an instance, times how many', () => {
    // 2 vCPU and 4GB is 2*12 + 4*3.5 = $38 a month, times three replicas.
    const line = costOfNode(node('api', 'service', { vcpu: 2, memoryGb: 4 }), 0, 3);
    expect(line.totalUsd).toBeCloseTo(114, 1);
    expect(line.basis).toContain('2 vCPU');
  });

  it('doubles for a second zone, because that is what it costs', () => {
    const single = costOfNode(node('db', 'sql_db', { vcpu: 4, memoryGb: 16, storageGb: 200 }), 0, 1);
    const spread = costOfNode(
      node('db', 'sql_db', { vcpu: 4, memoryGb: 16, storageGb: 200, multiAz: true }),
      0,
      1,
    );
    expect(spread.totalUsd).toBeCloseTo(single.totalUsd * 2, 1);
    expect(spread.basis).toContain('two zones');
  });

  it('charges for data held whether or not anyone reads it', () => {
    const small = costOfNode(node('db', 'sql_db', { vcpu: 2, memoryGb: 8, storageGb: 100 }), 0, 1);
    const large = costOfNode(node('db', 'sql_db', { vcpu: 2, memoryGb: 8, storageGb: 1100 }), 0, 1);
    expect(large.totalUsd - small.totalUsd).toBeCloseTo(1000 * RATES.storageGbMonth, 1);
  });

  it('bills each shard, because each one is another instance', () => {
    const one = costOfNode(node('db', 'nosql_db', { vcpu: 2, memoryGb: 8, storageGb: 0 }), 0, 1);
    const four = costOfNode(
      node('db', 'nosql_db', { vcpu: 2, memoryGb: 8, storageGb: 0, shards: 4 }),
      0,
      1,
    );
    expect(four.totalUsd).toBeCloseTo(one.totalUsd * 4, 1);
  });

  it('prices a cache by memory, which is the expensive kind', () => {
    const line = costOfNode(node('redis', 'cache', { memoryGb: 8 }), 0, 2);
    expect(line.totalUsd).toBeCloseTo(8 * RATES.cacheGbMonth * 2, 1);
  });

  it('charges nothing for a client, which is not yours to run', () => {
    const line = costOfNode(node('web', 'client', { trafficRps: 500 }), 500, 1);
    expect(line.totalUsd).toBe(0);
    expect(line.basis).toContain('not yours to run');
  });
});

describe('what you use', () => {
  const rps = 100;
  const millions = (rps * SECONDS_PER_MONTH) / 1_000_000;

  it('bills a third party per call, at the price they charge', () => {
    const line = costOfNode(node('psp', 'payment_gateway', { pricePerMillion: 40 }), rps, 1);
    expect(line.usageUsd).toBeCloseTo(millions * 40, 0);
    expect(line.fixedUsd).toBe(0);
  });

  it('bills inference by tokens, which is how it is actually sold', () => {
    const line = costOfNode(
      node('model', 'llm', { tokensPerRequest: 1000, pricePer1kTokens: 0.004 }),
      1,
      1,
    );
    // One request a second, a thousand tokens each, at $0.004 per thousand.
    expect(line.usageUsd).toBeCloseTo(SECONDS_PER_MONTH * 0.004, 0);
  });

  it('says so rather than reporting zero when the price is unknown', () => {
    const line = costOfNode(node('psp', 'third_party'), rps, 1);
    expect(line.usageUsd).toBe(0);
    expect(line.basis).toContain('set one to see it');
  });

  it('moves with the traffic, which is the point', () => {
    const quiet = costOfNode(node('q', 'queue'), 10, 1);
    const busy = costOfNode(node('q', 'queue'), 1000, 1);
    // Proportional, to within the cent each line is rounded to.
    expect(busy.usageUsd / quiet.usageUsd).toBeCloseTo(100, 1);
  });

  it('bills the traffic that arrived, not the traffic that was offered', () => {
    // A saturated component refuses most of what is sent; you are not billed for
    // requests nobody served. The caller passes served rps for exactly this reason.
    const served = costOfNode(node('q', 'queue'), 50, 1);
    const offered = costOfNode(node('q', 'queue'), 500, 1);
    expect(served.usageUsd).toBeLessThan(offered.usageUsd);
  });
});

describe('an author who knows the real invoice', () => {
  it('can override the calculation, and it is marked as theirs', () => {
    const line = costOfNode(node('api', 'service', { vcpu: 64, monthlyCost: 12 }), 1000, 3);
    expect(line.totalUsd).toBe(36);
    expect(line.overridden).toBe(true);
    expect(line.basis).toContain('stated as');
  });
});

describe('the whole bill', () => {
  const nodes = [
    node('web', 'client', { trafficRps: 200 }),
    node('lb', 'load_balancer'),
    node('api', 'service', { vcpu: 2, memoryGb: 4 }),
    node('db', 'sql_db', { vcpu: 4, memoryGb: 16, storageGb: 500, multiAz: true }),
  ];

  it('separates what you pay to exist from what you pay to serve', () => {
    const report = costReport(
      nodes,
      new Map([['web', 200], ['lb', 200], ['api', 200], ['db', 200]]),
      new Map([['api', 4]]),
    );

    expect(report.fixedUsd).toBeGreaterThan(0);
    expect(report.usageUsd).toBeGreaterThan(0);
    expect(report.totalUsd).toBeCloseTo(report.fixedUsd + report.usageUsd, 1);
    expect(report.lines.length).toBe(4);
  });

  it('grows when the design scales out', () => {
    const traffic = new Map([['web', 200], ['lb', 200], ['api', 200], ['db', 200]]);
    const small = costReport(nodes, traffic, new Map([['api', 1]]));
    const large = costReport(nodes, traffic, new Map([['api', 20]]));
    expect(large.totalUsd).toBeGreaterThan(small.totalUsd);
  });

  it('gives every line a reason a person can argue with', () => {
    const report = costReport(nodes, new Map(), new Map());
    for (const line of report.lines) expect(line.basis.length).toBeGreaterThan(10);
  });
});
