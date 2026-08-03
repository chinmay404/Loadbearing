// The binding layer's job is to be honest about what it filled in and to stay out
// of the way otherwise, so these test the layering as much as the arithmetic: a
// neutral design must see none of this, and a bound one must be able to trace
// every number back.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  attrsFromSku,
  bindSku,
  choicesFor,
  driftFrom,
  fits,
  SERVICE_FITS,
  skuById,
  loadSkus,
  resetSkus,
  skusNow,
} from './skus.js';
import { costOfShape } from './pricing.js';
import { ARCH_NODE_TYPES } from './types.js';

const RDS = 'aws:rds-postgres:db.r6g.2xlarge:us-east-1';
const SMALL = 'aws:rds-postgres:db.t3.medium:us-east-1';

// The snapshots are loaded on demand so they stay out of the initial bundle.
beforeAll(async () => {
  await loadSkus();
});

describe('the snapshots load', () => {
  it('has SKUs from both providers', () => {
    const providers = new Set([...skusNow().values()].map((s) => s.provider));
    expect(providers.has('aws')).toBe(true);
    expect(providers.has('azure')).toBe(true);
  });

  it('gives every SKU a price, a region and a date', () => {
    for (const sku of skusNow().values()) {
      expect(sku.pricing.length, sku.id).toBeGreaterThan(0);
      expect(sku.region, sku.id).toBeTruthy();
      expect(sku.measuredAt, sku.id).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('only claims component types that exist', () => {
    const known = new Set<string>(ARCH_NODE_TYPES);
    for (const [service, types] of Object.entries(SERVICE_FITS)) {
      for (const t of types) expect(known.has(t), `${service} claims ${t}`).toBe(true);
    }
  });
});

describe('eligibility', () => {
  it('lets a Postgres instance class be a database', () => {
    expect(fits(skuById(RDS)!, 'sql_db')).toBe(true);
    expect(fits(skuById(RDS)!, 'read_replica')).toBe(true);
  });

  it('refuses to let it be a cache', () => {
    // The other half of "compatibility": you cannot buy a db.* class for Redis.
    expect(fits(skuById(RDS)!, 'cache')).toBe(false);
  });

  it('offers only what fits, on the right provider, sorted small to large', () => {
    const options = choicesFor('sql_db', 'aws', 'us-east-1');
    expect(options.length).toBeGreaterThan(10);
    expect(options.every((s) => s.provider === 'aws')).toBe(true);
    expect(options.every((s) => s.region === 'us-east-1')).toBe(true);
    const vcpus = options.map((s) => s.vcpu ?? 0);
    expect([...vcpus].sort((a, b) => a - b)).toEqual(vcpus);
  });

  it('offers nothing for a component no snapshot covers', () => {
    expect(choicesFor('llm', 'aws')).toEqual([]);
  });
});

describe('binding', () => {
  it('writes the real specs into the fields the engine already reads', () => {
    const { attrs } = bindSku({}, skuById(RDS)!);
    expect(attrs.vcpu).toBe(8);
    expect(attrs.memoryGb).toBe(64);
    expect(attrs.region).toBe('us-east-1');
    expect(attrs.sku).toBe(RDS);
  });

  it("carries AWS's documented connection ceiling", () => {
    // LEAST(DBInstanceClassMemory/9531392, 5000). 4GB gives 450; 64GB hits the cap.
    expect(bindSku({}, skuById(SMALL)!).attrs.maxConnections).toBe(450);
    expect(bindSku({}, skuById(RDS)!).attrs.maxConnections).toBe(5000);
  });

  it('keeps anything the SKU has no opinion about', () => {
    const { attrs } = bindSku({ latencyMs: 12, replicas: 3 }, skuById(RDS)!);
    expect(attrs.latencyMs).toBe(12);
    expect(attrs.replicas).toBe(3);
  });

  it('reports which fields it filled in, so the inspector can say where they came from', () => {
    const { bound } = bindSku({}, skuById(RDS)!);
    const keys = bound.map((b) => b.key).sort();
    expect(keys).toContain('vcpu');
    expect(keys).toContain('memoryGb');
    expect(keys).toContain('maxConnections');
  });
});

describe('drift', () => {
  it('sees nothing when the numbers still match the SKU', () => {
    const { attrs } = bindSku({}, skuById(RDS)!);
    expect(driftFrom(attrs)).toEqual([]);
  });

  it('reports a number the author has since changed', () => {
    // A design that says db.t3.medium and carries 64GB is lying to its reader.
    const { attrs } = bindSku({}, skuById(SMALL)!);
    const drifted = driftFrom({ ...attrs, memoryGb: 64 });
    expect(drifted.map((d) => d.key)).toEqual(['memoryGb']);
    expect(drifted[0]!.fromSku).toBe(4);
    expect(drifted[0]!.current).toBe(64);
  });

  it('sees nothing at all on an unbound component', () => {
    expect(driftFrom({ vcpu: 4 })).toEqual([]);
    expect(driftFrom(undefined)).toEqual([]);
  });
});

describe('what a bound instance costs', () => {
  it('prices a month of it from its own tier list', () => {
    const sku = skuById(RDS)!;
    const monthly = costOfShape(sku.pricing[0]!, { hours: 720 });
    // $0.899/hr x 720 = $647.28
    expect(monthly).toBeCloseTo(647.28, 2);
  });

  it('is dearer than the small one, which is the point of picking', () => {
    expect(costOfShape(skuById(RDS)!.pricing[0]!, { hours: 720 })).toBeGreaterThan(
      costOfShape(skuById(SMALL)!.pricing[0]!, { hours: 720 }),
    );
  });
});

describe('laziness', () => {
  it('serves nothing before the snapshots are asked for, without throwing', () => {
    resetSkus();
    expect(skusNow().size).toBe(0);
    expect(skuById(RDS)).toBeUndefined();
    expect(choicesFor('sql_db', 'aws')).toEqual([]);
    expect(driftFrom({ sku: RDS, memoryGb: 1 })).toEqual([]);
  });

  it('fetches once however many callers ask at the same time', async () => {
    resetSkus();
    const [a, b, c] = await Promise.all([loadSkus(), loadSkus(), loadSkus()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.size).toBeGreaterThan(100);
  });
});
