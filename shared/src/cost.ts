// What this design costs a month, calculated rather than typed.
//
// Cost used to be a number you entered, which meant it never moved when you added
// replicas, doubled your storage or spread a database across zones — and a design
// could be simultaneously cheap and fast because someone had typed both. Here it comes
// from the same parameters the engine reads, so the two can never disagree.
//
// Two halves. What you PROVISION is billed whether or not anyone shows up: instances,
// storage, zone redundancy. What you USE is billed per request, and comes from the
// traffic the simulation actually carried — so turning the load slider up moves the
// bill, which is the connection the tool exists to teach.
//
// The rates are approximate, provider-neutral and rounded. They are the right order of
// magnitude for a major cloud in 2026 and are not a quote; anyone who knows their real
// invoice can override a component outright.

import { familyOf, type Family } from './families.js';
import { inferPlacement, type Placement } from './network.js';
import type { GraphEdge, GraphNode } from './types.js';

/** Rounded, provider-neutral, and deliberately not a quote. */
export const RATES = {
  /** Per vCPU-month for ordinary compute. */
  vcpuMonth: 12,
  /** Per GB-month of RAM on an instance. */
  memoryGbMonth: 3.5,
  /** Per GB-month of durable storage. */
  storageGbMonth: 0.12,
  /** Per GB-month of in-memory cache, which is dearer than disk by a lot. */
  cacheGbMonth: 14,
  /** A managed router: the flat part, before traffic. */
  routerMonth: 22,
  /** A control-plane component nobody sizes: observability, a secret manager. */
  controlMonth: 40,
  /** Per million requests through a managed queue or stream. */
  messagingPerMillion: 0.4,
  /** Per million requests through a managed router. */
  routingPerMillion: 0.6,
  /** Managed datastores carry an operator premium over raw compute. */
  managedDatastoreMultiplier: 1.35,
} as const;

/**
 * Dollars per GB moved, by how far it goes.
 *
 * Bandwidth was the dimension this module had no concept of, which let a design
 * stream terabytes to the public internet for nothing. On a real invoice for
 * anything media-heavy this is routinely the biggest single line — and it is the
 * one that punishes a chatty cross-zone design in a way no request count shows.
 *
 * Traffic inside a zone is free everywhere worth naming. Everything else is not.
 */
export const EGRESS_USD_PER_GB: Record<Placement, number> = {
  'same-host': 0,
  'same-az': 0,
  'cross-az': 0.01,
  'cross-region': 0.02,
  internet: 0.09,
};

/** Data a datastore holds when nobody has said, GB. */
export const DEFAULT_STORAGE_GB = 100;

/** Seconds in the month this bill covers. */
export const SECONDS_PER_MONTH = 60 * 60 * 24 * 30;

export interface CostLine {
  nodeId: string;
  label: string;
  /** Billed whether or not traffic arrives. */
  fixedUsd: number;
  /** Billed per request, from the traffic the run actually carried. */
  usageUsd: number;
  totalUsd: number;
  /** How the number was reached, in words, so it can be argued with. */
  basis: string;
  /** True when the author overrode the calculation with a real invoice figure. */
  overridden: boolean;
}

export interface CostReport {
  lines: CostLine[];
  fixedUsd: number;
  usageUsd: number;
  totalUsd: number;
}

const round = (v: number): number => Math.round(v * 100) / 100;
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

/** Sizing defaults, so a component nobody has sized still costs something sane. */
export const DEFAULT_VCPU: Record<Family, number> = {
  origin: 0,
  routing: 0,
  compute: 2,
  datastore: 4,
  cache: 0,
  messaging: 0,
  external: 0,
  ai: 0,
  control: 0,
  boundary: 0,
};

export const DEFAULT_MEMORY_GB: Record<Family, number> = {
  origin: 0,
  routing: 0,
  compute: 4,
  datastore: 16,
  cache: 4,
  messaging: 0,
  external: 0,
  ai: 0,
  control: 0,
  boundary: 0,
};

/**
 * What one component costs, given how much traffic reached it and how many replicas
 * it settled at.
 *
 * `rps` is the load the simulation carried, not the load that was offered: you are not
 * billed for requests a saturated component refused.
 */
export function costOfNode(
  node: GraphNode,
  rps: number,
  replicas: number,
  /** The pool this runs on, when it is not its own machines. */
  host?: GraphNode,
): CostLine {
  const label = node.label;
  const family = familyOf(node.type);
  const override = node.attrs?.monthlyCost;
  const copies = Math.max(1, replicas);
  const requestsPerMonth = Math.max(0, rps) * SECONDS_PER_MONTH;
  const millions = requestsPerMonth / 1_000_000;
  const azMultiplier = node.attrs?.multiAz ? 2 : 1;

  if (typeof override === 'number' && override >= 0) {
    const fixed = round(override * copies);
    return {
      nodeId: node.id,
      label,
      fixedUsd: fixed,
      usageUsd: 0,
      totalUsd: fixed,
      basis: `stated as $${override}/month per replica, times ${copies}`,
      overridden: true,
    };
  }

  let fixed = 0;
  let usage = 0;
  let basis = '';

  // A process on somebody else's machines has no machines of its own. The pool it runs
  // on is billed once, for its real size; billing each stage inside it as well counted
  // the same hardware six times and made a pipeline look six times more expensive than
  // the workers it actually runs on.
  if (host) {
    const perCall = num(node.attrs?.pricePerMillion, 0);
    usage = millions * perCall;
    return {
      nodeId: node.id,
      label,
      fixedUsd: 0,
      usageUsd: round(usage),
      totalUsd: round(usage),
      basis: `runs on ${host.label}, which carries the cost of the machines`,
      overridden: false,
    };
  }

  switch (family) {
    case 'compute': {
      // An elastic endpoint is billed for what you call, not for what you run.
      if (node.attrs?.elastic) {
        const perCall = num(node.attrs?.pricePerMillion, 0);
        usage = millions * perCall;
        basis = perCall
          ? `${round(millions)}M calls a month at $${perCall} per million, on the provider's capacity`
          : 'hosted by a provider, with no price per call given — set one to see the bill';
        break;
      }
      const vcpu = num(node.attrs?.vcpu, DEFAULT_VCPU.compute);
      const memory = num(node.attrs?.memoryGb, DEFAULT_MEMORY_GB.compute);
      const perReplica = vcpu * RATES.vcpuMonth + memory * RATES.memoryGbMonth;
      fixed = perReplica * copies * azMultiplier;
      basis = `${copies} x (${vcpu} vCPU + ${memory}GB) at $${RATES.vcpuMonth}/vCPU and $${RATES.memoryGbMonth}/GB${azMultiplier > 1 ? ', doubled for two zones' : ''}`;
      break;
    }
    case 'datastore': {
      const vcpu = num(node.attrs?.vcpu, DEFAULT_VCPU.datastore);
      const memory = num(node.attrs?.memoryGb, DEFAULT_MEMORY_GB.datastore);
      const storage = num(node.attrs?.storageGb, DEFAULT_STORAGE_GB);
      const instances = copies * Math.max(1, num(node.attrs?.shards, 1));
      const perInstance =
        (vcpu * RATES.vcpuMonth + memory * RATES.memoryGbMonth) * RATES.managedDatastoreMultiplier;
      fixed = (perInstance * instances + storage * RATES.storageGbMonth) * azMultiplier;
      basis = `${instances} instance${instances === 1 ? '' : 's'} of ${vcpu} vCPU and ${memory}GB, plus ${storage}GB stored${azMultiplier > 1 ? ', doubled for two zones' : ''}`;
      break;
    }
    case 'cache': {
      const memory = num(node.attrs?.memoryGb, DEFAULT_MEMORY_GB.cache);
      fixed = memory * RATES.cacheGbMonth * copies * azMultiplier;
      basis = `${copies} x ${memory}GB in memory at $${RATES.cacheGbMonth}/GB${azMultiplier > 1 ? ', doubled for two zones' : ''}`;
      break;
    }
    case 'messaging': {
      usage = millions * RATES.messagingPerMillion;
      basis = `${round(millions)}M messages a month at $${RATES.messagingPerMillion} per million`;
      break;
    }
    case 'routing': {
      fixed = RATES.routerMonth * copies;
      usage = millions * RATES.routingPerMillion;
      basis = `$${RATES.routerMonth}/month plus ${round(millions)}M requests at $${RATES.routingPerMillion} per million`;
      break;
    }
    case 'external': {
      const price = num(node.attrs?.pricePerMillion, 0);
      usage = millions * price;
      basis = price
        ? `${round(millions)}M calls a month at $${price} per million`
        : 'no price given for their calls, so nothing is counted — set one to see it';
      break;
    }
    case 'ai': {
      const tokens = num(node.attrs?.tokensPerRequest, 0);
      const per1k = num(node.attrs?.pricePer1kTokens, 0);
      usage = (requestsPerMonth * tokens) / 1000 * per1k;
      basis =
        tokens && per1k
          ? `${round(millions)}M requests x ${tokens} tokens at $${per1k} per 1k`
          : 'no tokens or price given, so inference is not counted — set both to see the bill';
      break;
    }
    case 'control': {
      fixed = RATES.controlMonth;
      basis = `about $${RATES.controlMonth}/month for something that runs beside the system`;
      break;
    }
    case 'boundary': {
      // A plain boundary is drawing furniture. One declared a shared host is the
      // machines everything inside it runs on, and it carries their whole bill.
      if (!node.attrs?.sharedHost) {
        basis = 'a boundary on the drawing — it runs nothing and costs nothing';
        break;
      }
      const vcpu = num(node.attrs?.vcpu, DEFAULT_VCPU.compute);
      const memory = num(node.attrs?.memoryGb, DEFAULT_MEMORY_GB.compute);
      fixed = (vcpu * RATES.vcpuMonth + memory * RATES.memoryGbMonth) * copies * azMultiplier;
      basis = `a pool of ${copies} x (${vcpu} vCPU + ${memory}GB) running everything inside it${azMultiplier > 1 ? ', doubled for two zones' : ''}`;
      break;
    }
    case 'origin':
      basis = 'costs you nothing — it is not yours to run';
      break;
  }

  return {
    nodeId: node.id,
    label,
    fixedUsd: round(fixed),
    usageUsd: round(usage),
    totalUsd: round(fixed + usage),
    basis,
    overridden: false,
  };
}

/**
 * The whole bill. `served` and `replicas` come from the run, keyed by node id — cost
 * follows the traffic that actually arrived, so a design that sheds half its load is
 * not billed for the half it refused.
 */
/**
 * What each component pays for data leaving it, by node id.
 *
 * Billed to the sending side, which is who a cloud actually invoices. The volume
 * on a connection is taken from what the RECEIVING end served, divided between
 * its inbound connections — exact whenever something has one caller, which is
 * most things, and approximate rather than invented otherwise. Working the other
 * way round would need the engine's normalised routing shares, and the cost model
 * has no business re-deriving those.
 */
export function egressByNode(
  edges: readonly GraphEdge[],
  nodes: readonly GraphNode[],
  served: Map<string, number>,
): Map<string, { usd: number; gb: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inboundCount = new Map<string, number>();
  for (const e of edges) inboundCount.set(e.to, (inboundCount.get(e.to) ?? 0) + 1);

  const out = new Map<string, { usd: number; gb: number }>();
  for (const e of edges) {
    const payloadKb = e.payloadKb;
    if (typeof payloadKb !== 'number' || !(payloadKb > 0)) continue;
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;

    const rps = (served.get(e.to) ?? 0) / Math.max(1, inboundCount.get(e.to) ?? 1);
    if (rps <= 0) continue;

    const placement: Placement =
      e.placement ?? inferPlacement(from.attrs?.region, to.attrs?.region);
    const rate = EGRESS_USD_PER_GB[placement];
    if (!(rate > 0)) continue;

    const gb = (rps * SECONDS_PER_MONTH * payloadKb) / (1024 * 1024);
    const prev = out.get(e.from) ?? { usd: 0, gb: 0 };
    out.set(e.from, { usd: prev.usd + gb * rate, gb: prev.gb + gb });
  }
  return out;
}

export function costReport(
  nodes: readonly GraphNode[],
  served: Map<string, number>,
  replicas: Map<string, number>,
  /** Which pool each component runs on, for the ones that do not own their machines. */
  hostedBy?: Map<string, string>,
  /** Connections, so data leaving a component can be billed. */
  edges: readonly GraphEdge[] = [],
): CostReport {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const egress = egressByNode(edges, nodes, served);

  const lines = nodes.map((n) => {
    const line = costOfNode(
      n,
      served.get(n.id) ?? 0,
      replicas.get(n.id) ?? 1,
      hostedBy ? byId.get(hostedBy.get(n.id) ?? '') : undefined,
    );
    const moved = egress.get(n.id);
    // An overridden line is somebody's real invoice, which already includes their
    // bandwidth. Adding ours on top would double-count it.
    if (!moved || moved.usd <= 0 || line.overridden) return line;
    return {
      ...line,
      usageUsd: round(line.usageUsd + moved.usd),
      totalUsd: round(line.totalUsd + moved.usd),
      basis: `${line.basis}, plus ${round(moved.gb)}GB/month leaving it`,
    };
  });

  return {
    lines,
    fixedUsd: round(lines.reduce((sum, l) => sum + l.fixedUsd, 0)),
    usageUsd: round(lines.reduce((sum, l) => sum + l.usageUsd, 0)),
    totalUsd: round(lines.reduce((sum, l) => sum + l.totalUsd, 0)),
  };
}
