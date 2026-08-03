// Integrity of the generated snapshots.
//
// These files are not hand-written, so the risk is not a typo — it is a scraper
// that silently starts collecting the wrong thing. Both bugs found while building
// the Azure script produced a well-formed file full of plausible wrong prices: a
// spot rate where an on-demand rate belonged, and a Cloud Services meter standing
// in for a virtual machine. Neither would have failed a schema check.
//
// So these assert the properties that a wrong-but-plausible snapshot violates.

import { describe, expect, it } from 'vitest';
import azure from './azure-prices.json' with { type: 'json' };

describe('azure price snapshot', () => {
  const skus = Object.values(azure.skus as Record<string, AzureSku>);

  interface Tier {
    fromUnits: number;
    usd: number;
  }
  interface AzureSku {
    id: string;
    provider: string;
    service: string;
    display: string;
    region: string;
    pricing: { kind: string; tiers: Tier[] }[];
    measuredAt: string;
    confidence: string;
  }

  it('says when it was taken, because a price snapshot goes stale', () => {
    expect(azure.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(azure.source).toContain('prices.azure.com');
  });

  it('is not empty', () => {
    expect(skus.length).toBeGreaterThan(100);
  });

  it('gives every SKU a region, a price and a date', () => {
    for (const sku of skus) {
      expect(sku.region, sku.id).toBeTruthy();
      expect(sku.measuredAt, sku.id).toMatch(/^\d{4}-\d{2}$/);
      expect(sku.pricing.length, sku.id).toBeGreaterThan(0);
    }
  });

  it('has strictly increasing tier boundaries', () => {
    // Two prices starting at the same point means two meters were merged as one.
    for (const sku of skus) {
      for (const shape of sku.pricing) {
        for (let i = 1; i < shape.tiers.length; i += 1) {
          expect(shape.tiers[i]!.fromUnits, sku.id).toBeGreaterThan(
            shape.tiers[i - 1]!.fromUnits,
          );
        }
      }
    }
  });

  it('contains no spot prices masquerading as on-demand', () => {
    // Spot is roughly a fifth of on-demand. Nothing in an allowlisted general
    // purpose family costs under half a cent an hour at list price, so anything
    // that cheap means the filter regressed.
    for (const sku of skus) {
      for (const shape of sku.pricing) {
        for (const tier of shape.tiers) {
          expect(tier.usd, `${sku.id} is suspiciously cheap`).toBeGreaterThan(0.005);
        }
      }
    }
  });

  it('prices a known machine at its published on-demand rate', () => {
    // A canary. If Azure reprices this, the test fails and somebody re-runs the
    // script deliberately rather than discovering the drift months later.
    const d4s = (azure.skus as Record<string, AzureSku>)['azure:vm:Standard_D4s_v5:eastus'];
    expect(d4s).toBeDefined();
    expect(d4s!.pricing[0]!.tiers[0]!.usd).toBeCloseTo(0.192, 3);
  });

  it('keys every SKU by the id it carries, sorted', () => {
    const keys = Object.keys(azure.skus);
    expect(keys).toEqual([...keys].sort());
    for (const [key, sku] of Object.entries(azure.skus as Record<string, AzureSku>)) {
      expect(sku.id).toBe(key);
    }
  });
});
