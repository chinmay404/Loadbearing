// What "default" actually is.
//
// Every empty box in the inspector said `default`, which tells the reader
// precisely nothing. A learner looking at a VM saw "vCPU: default" and had no way
// to know whether that meant 1, 2 or 64 — and the number matters, because it is
// what the capacity and the bill are both computed from. "Leave it empty and
// something sensible happens" is a reasonable design; refusing to say what the
// sensible thing IS is not.
//
// This resolves the same fallbacks the engine and the cost model use, from the
// same constants, so the placeholder cannot drift away from the behaviour. Where a
// default is DERIVED from other attributes — concurrency from vCPU, a timeout from
// service time — the current attributes are passed in, so the hint updates as the
// component is sized rather than reporting a figure that stopped being true three
// edits ago.

import { DEFAULT_CAPACITY, DEFAULT_CACHE_HIT_RATE, DEFAULT_LATENCY, DEFAULT_QUEUE_DEPTH_MAX } from './components.js';
import { DEFAULT_MEMORY_GB, DEFAULT_STORAGE_GB, DEFAULT_VCPU } from './cost.js';
import { concurrencyFor } from './engine.js';
import { familyOf } from './families.js';
import type { ArchNodeType, NodeAttrs } from './types.js';

/**
 * The value a field falls back to, or undefined when there genuinely is none.
 *
 * Undefined is a real answer, not a gap: an autoscaling ceiling has no default
 * because a component without one simply does not autoscale, and inventing a
 * number to display would be worse than admitting there isn't one.
 */
export function defaultFor(
  type: ArchNodeType,
  key: keyof NodeAttrs,
  attrs?: NodeAttrs,
): number | boolean | undefined {
  const family = familyOf(type);
  // A synthetic node, so the derived helpers see the sizing the author has set.
  const node = { id: '', type, label: '', annotation: '', attrs: attrs ?? {} };

  switch (key) {
    case 'capacityRps': {
      const capacity = DEFAULT_CAPACITY[type];
      return Number.isFinite(capacity) ? capacity : undefined;
    }
    case 'latencyMs':
      return DEFAULT_LATENCY[type];
    case 'replicas':
      return 1;
    case 'vcpu':
      return DEFAULT_VCPU[family] || undefined;
    case 'memoryGb':
      return DEFAULT_MEMORY_GB[family] || undefined;
    case 'storageGb':
      return family === 'datastore' ? DEFAULT_STORAGE_GB : undefined;
    case 'shards':
      return 1;
    case 'concurrency':
      // Derived: from vCPU once sized, from the catalogue until then.
      return Math.round(concurrencyFor(node));
    case 'cacheHitRate':
      return family === 'cache' ? DEFAULT_CACHE_HIT_RATE : undefined;
    case 'queueDepthMax':
      return family === 'messaging' ? DEFAULT_QUEUE_DEPTH_MAX : undefined;
    case 'multiAz':
    case 'elastic':
    case 'sharedHost':
      return false;
    // No default that means anything. An unset autoscale ceiling is not "some
    // number" — it is a component that does not autoscale, and an unset rate limit
    // is a provider that has not refused you yet.
    case 'autoscaleMin':
    case 'autoscaleMax':
    case 'rateLimitRps':
    case 'timeoutMs':
    case 'trafficRps':
    case 'monthlyCost':
    case 'pricePerMillion':
    case 'pricePer1kTokens':
    case 'tokensPerRequest':
    case 'workingSetGb':
    case 'poolSize':
    case 'maxConnections':
      return undefined;
    default:
      return undefined;
  }
}

/**
 * What to show in an empty field: the number it will use, or a word for why there
 * isn't one.
 *
 * Kept next to `defaultFor` rather than in the client because the phrasing is a
 * statement about the model's behaviour, and the two should change together.
 */
export function placeholderFor(
  type: ArchNodeType,
  key: keyof NodeAttrs,
  attrs?: NodeAttrs,
): string {
  const value = defaultFor(type, key, attrs);
  if (value === undefined) {
    switch (key) {
      case 'autoscaleMin':
      case 'autoscaleMax':
        return 'no autoscaling';
      case 'rateLimitRps':
        return 'no limit';
      case 'timeoutMs':
        return 'caller waits';
      case 'trafficRps':
        return 'not a source';
      case 'monthlyCost':
        return 'calculated';
      default:
        return 'none';
    }
  }
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  // Big round numbers are easier to recognise than to count the digits of.
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value * 100) / 100);
}
