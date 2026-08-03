// Real cloud offerings, bound to the boxes on the drawing.
//
// A binding LAYER over the neutral model, never a replacement for it. The drawing
// stays provider-neutral: a `sql_db` is a `sql_db`, every existing problem and
// blueprint keeps working, and someone who never picks a provider loses nothing.
// That default is the structural defence against this tool drifting from teaching
// architecture into teaching AWS configuration.
//
// Binding is deliberately the shallowest integration that could work. A SKU
// writes its values into the attributes the engine ALREADY reads — vcpu,
// memoryGb, maxConnections — and the engine learns nothing new. The realism comes
// from the values being real, not from new physics. Everything stays editable
// afterwards, because "pick db.r6g.2xlarge, then see what 8 vCPU and a 5,000
// connection ceiling do to your design" is the lesson, and locking the fields
// would remove the freeform sizing the teaching problems depend on.

import awsPrices from './data/aws-prices.json' with { type: 'json' };
import azurePrices from './data/azure-prices.json' with { type: 'json' };
import type { PricingShape } from './pricing.js';
import type { ArchNodeType, NodeAttrs } from './types.js';

export type Provider = 'aws' | 'azure' | 'gcp';
/** What a design is deployed on. `neutral` is the default and is today's tool. */
export type DeploymentTarget = 'neutral' | Provider;

export interface SkuLimits {
  maxConnections?: number;
  concurrency?: number;
  rateLimitRps?: number;
  iops?: number;
}

export interface Sku {
  /** Provider-prefixed and unambiguous: 'aws:rds-postgres:db.r6g.2xlarge:us-east-1'. */
  id: string;
  provider: Provider;
  /** Which offering, e.g. 'rds-postgres'. Decides what component types it fits. */
  service: string;
  display: string;
  region: string;
  vcpu?: number;
  memoryGb?: number;
  limits: SkuLimits;
  pricing: PricingShape[];
  measuredAt: string;
  confidence: 'measured' | 'documented' | 'estimate';
}

/**
 * Which component types each offering may be bound to.
 *
 * Held per SERVICE rather than per SKU: every `rds-postgres` instance class fits
 * exactly the same component types, and repeating that list across hundreds of
 * near-identical records would only invite the copies to drift apart.
 */
export const SERVICE_FITS: Record<string, readonly ArchNodeType[]> = {
  'rds-postgres': ['sql_db', 'read_replica', 'ledger_db'],
  'virtual-machines': ['service', 'monolith', 'vm', 'worker', 'custom'],
};

const RAW: readonly { skus: Record<string, unknown> }[] = [
  awsPrices as unknown as { skus: Record<string, unknown> },
  azurePrices as unknown as { skus: Record<string, unknown> },
];

function load(): Map<string, Sku> {
  const out = new Map<string, Sku>();
  for (const file of RAW) {
    for (const value of Object.values(file.skus)) {
      const sku = value as Sku;
      // A snapshot entry with no price is not an offering anyone can choose.
      if (!sku?.id || !Array.isArray(sku.pricing) || sku.pricing.length === 0) continue;
      out.set(sku.id, { ...sku, limits: sku.limits ?? {} });
    }
  }
  return out;
}

/** Every SKU the committed snapshots know about, by id. */
export const SKUS: ReadonlyMap<string, Sku> = load();

export const skuById = (id: string | undefined): Sku | undefined =>
  id === undefined ? undefined : SKUS.get(id);

/** Can this offering stand for this component? */
export function fits(sku: Sku, type: ArchNodeType): boolean {
  return (SERVICE_FITS[sku.service] ?? []).includes(type);
}

/**
 * What a learner may choose for this box, on this provider, in this region.
 *
 * Sorted by size then by name so the list reads like a menu rather than like a
 * hash order, and so the same call always returns the same list.
 */
export function choicesFor(
  type: ArchNodeType,
  provider: Provider,
  region?: string,
): Sku[] {
  return [...SKUS.values()]
    .filter(
      (sku) =>
        sku.provider === provider &&
        fits(sku, type) &&
        (region === undefined || sku.region === region),
    )
    .sort(
      (a, b) =>
        (a.vcpu ?? 0) - (b.vcpu ?? 0) ||
        (a.memoryGb ?? 0) - (b.memoryGb ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** An attribute a SKU filled in, and whether the author has since changed it. */
export interface BoundField {
  key: keyof NodeAttrs;
  fromSku: number;
  current: number | undefined;
  edited: boolean;
}

/**
 * The attributes this SKU implies. Applied over whatever is already there, so an
 * author's own numbers are never silently overwritten by a later re-bind.
 */
export function attrsFromSku(sku: Sku): Partial<NodeAttrs> {
  return {
    ...(sku.vcpu !== undefined ? { vcpu: sku.vcpu } : {}),
    ...(sku.memoryGb !== undefined ? { memoryGb: sku.memoryGb } : {}),
    ...(sku.limits.maxConnections !== undefined
      ? { maxConnections: sku.limits.maxConnections }
      : {}),
    ...(sku.limits.rateLimitRps !== undefined ? { rateLimitRps: sku.limits.rateLimitRps } : {}),
    ...(sku.limits.concurrency !== undefined ? { concurrency: sku.limits.concurrency } : {}),
    ...(sku.region ? { region: sku.region } : {}),
  };
}

/**
 * Bind a SKU to a component's attributes.
 *
 * Returns the new attributes AND which fields came from the SKU, so the inspector
 * can show where a number came from and mark it once somebody overrides it. A
 * number the learner cannot trace back is barely better than the guess it
 * replaced.
 */
export function bindSku(
  attrs: NodeAttrs | undefined,
  sku: Sku,
): { attrs: NodeAttrs; bound: BoundField[] } {
  const from = attrsFromSku(sku);
  const next: NodeAttrs = { ...(attrs ?? {}), ...from, sku: sku.id };
  const bound: BoundField[] = (Object.keys(from) as (keyof NodeAttrs)[])
    .filter((key) => typeof from[key] === 'number')
    .map((key) => ({
      key,
      fromSku: from[key] as number,
      current: next[key] as number | undefined,
      edited: false,
    }));
  return { attrs: next, bound };
}

/**
 * Which of a bound component's numbers no longer match the SKU it names.
 *
 * A design that says `db.t3.medium` and then quietly carries 64GB is lying to its
 * reader, so the divergence is reported rather than resolved.
 */
export function driftFrom(attrs: NodeAttrs | undefined): BoundField[] {
  const sku = skuById(attrs?.sku);
  if (!sku || !attrs) return [];
  const from = attrsFromSku(sku);
  return (Object.keys(from) as (keyof NodeAttrs)[])
    .filter((key) => typeof from[key] === 'number')
    .map((key) => ({
      key,
      fromSku: from[key] as number,
      current: attrs[key] as number | undefined,
      edited: attrs[key] !== from[key],
    }))
    .filter((f) => f.edited);
}
