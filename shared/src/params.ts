// Which knobs a component actually has.
//
// One flat set of seven fields used to serve all 109 component types, which meant a
// managed load balancer offered a multi-AZ toggle — not a decision anyone makes about
// one — while an autoscaling group offered no scaling range at all, and a component
// somebody named themselves inherited whatever its base type happened to expose.
//
// So parameters hang off the family. A component only ever shows what applies to it,
// the engine reads the same fields, and the cost model reads them too — which is the
// point of stating a size rather than a capacity number: what a replica can serve and
// what it costs come from the same statement, so the two can never disagree.

import type { Family } from './families.js';
import { familyOf } from './families.js';
import type { ArchNodeType, NodeAttrs } from './types.js';

export type ParamKind = 'number' | 'toggle' | 'fraction';

/** Where a parameter sits in the inspector, so a long list reads as a short one. */
export type ParamGroup = 'traffic' | 'size' | 'scaling' | 'behaviour' | 'resilience' | 'money';

/**
 * The attributes a parameter control can actually edit.
 *
 * Every `ParamKind` is a number, a fraction or a toggle, so a `ParamSpec` can only
 * ever point at an attribute holding a number or a boolean. Saying so in the type
 * means a string-valued attribute — `region`, say — cannot be given a spec by
 * accident, and the inspector's field component keeps its narrow value type
 * without a cast at the call site.
 */
export type ParamKey = {
  [K in keyof NodeAttrs]-?: NonNullable<NodeAttrs[K]> extends number | boolean ? K : never;
}[keyof NodeAttrs];

export interface ParamSpec {
  key: ParamKey;
  label: string;
  /** One line on what it means, and what changes when you move it. */
  hint: string;
  kind: ParamKind;
  group: ParamGroup;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
}

const VCPU: ParamSpec = {
  key: 'vcpu',
  label: 'vCPU per replica',
  hint: 'The size of one instance. With service time this is where capacity comes from, and it is most of the bill.',
  kind: 'number',
  group: 'size',
  min: 0.25,
  step: 0.25,
};

const MEMORY: ParamSpec = {
  key: 'memoryGb',
  label: 'Memory per replica',
  hint: 'GB of RAM. Sizes the instance and, for a cache, decides how much fits before it starts evicting.',
  kind: 'number',
  group: 'size',
  unit: 'GB',
  min: 0.25,
  step: 0.25,
};

const SERVICE_TIME: ParamSpec = {
  key: 'latencyMs',
  label: 'Own work per request',
  hint: 'Milliseconds of its own processing, excluding waiting on anything else. Raising it lowers capacity: the same workers are held longer.',
  kind: 'number',
  group: 'behaviour',
  unit: 'ms',
  min: 0,
};

const CAPACITY: ParamSpec = {
  key: 'capacityRps',
  label: 'Capacity per replica',
  hint: 'Requests per second one replica serves. Leave empty to derive it from size and service time, which is the more honest way round.',
  kind: 'number',
  group: 'size',
  unit: 'rps',
  min: 0,
};

const REPLICAS: ParamSpec = {
  key: 'replicas',
  label: 'Replicas',
  hint: 'How many copies run. Fixed unless an autoscaling range says otherwise.',
  kind: 'number',
  group: 'scaling',
  min: 1,
  step: 1,
};

const AUTOSCALE_MIN: ParamSpec = {
  key: 'autoscaleMin',
  label: 'Autoscale floor',
  hint: 'Never fewer than this. The floor is what meets the first minute of a spike, because anything above it arrives late.',
  kind: 'number',
  group: 'scaling',
  min: 1,
  step: 1,
};

const AUTOSCALE_MAX: ParamSpec = {
  key: 'autoscaleMax',
  label: 'Autoscale ceiling',
  hint: 'Never more than this. Reached about a minute after the load asks for it; past the ceiling, traffic sheds.',
  kind: 'number',
  group: 'scaling',
  min: 1,
  step: 1,
};

const CONCURRENCY: ParamSpec = {
  key: 'concurrency',
  label: 'Requests in flight per replica',
  hint: 'Threads, workers or connections. Derived from vCPU when empty. This is the ceiling a slow dependency eats into.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};

const TIMEOUT: ParamSpec = {
  key: 'timeoutMs',
  label: 'Caller gives up after',
  hint: 'A call slower than this fails rather than waits. Left empty, the caller is patient and only shedding causes loss.',
  kind: 'number',
  group: 'behaviour',
  unit: 'ms',
  min: 1,
};

const POOL_SIZE: ParamSpec = {
  key: 'poolSize',
  label: 'Connections held open',
  hint: 'The pool in front of the store. Callers needing more than this queue for a connection, not for the data.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};

const MAX_CONNECTIONS: ParamSpec = {
  key: 'maxConnections',
  label: 'Connections it accepts',
  hint: 'What the store itself allows. Fifty replicas holding twenty each exhaust a hundred without ever hitting a request limit.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};

const MULTI_AZ: ParamSpec = {
  key: 'multiAz',
  label: 'Spread across zones',
  hint: 'A second copy in another zone survives losing one. Roughly doubles the bill for this component.',
  kind: 'toggle',
  group: 'resilience',
};

const COST_OVERRIDE: ParamSpec = {
  key: 'monthlyCost',
  label: 'Override monthly cost',
  hint: 'Only if you know the real invoice. Left empty, cost is calculated from the size and the traffic.',
  kind: 'number',
  group: 'money',
  unit: '$/mo',
  min: 0,
};

const ELASTIC: ParamSpec = {
  key: 'elastic',
  label: 'Runs on a provider’s capacity',
  hint: 'You did not size this and cannot scale it — a hosted endpoint. Capacity stops being your constraint; their rate limit and their price take over.',
  kind: 'toggle',
  group: 'size',
};

const RATE_LIMIT: ParamSpec = {
  key: 'rateLimitRps',
  label: 'Their rate limit',
  hint: 'What the provider accepts before refusing you. This, not capacity, is what stops an elastic component.',
  kind: 'number',
  group: 'behaviour',
  unit: 'rps',
  min: 0,
};

const TRAFFIC_SOURCE: ParamSpec = {
  key: 'trafficRps',
  label: 'Traffic starts here',
  hint: 'Requests per second this originates. The load slider multiplies it. Without a source, nothing is offered.',
  kind: 'number',
  group: 'traffic',
  unit: 'rps',
  min: 0,
};

/**
 * Every family gets sizing, scaling and money; the rest is what genuinely differs.
 * Notably absent from `routing`: zone placement. A managed balancer or gateway is
 * redundant by construction — there is no switch for it, so offering one taught the
 * wrong thing about what a design controls.
 */
export const PARAMS_BY_FAMILY: Record<Family, ParamSpec[]> = {
  origin: [
    TRAFFIC_SOURCE,
    {
      key: 'timeoutMs',
      label: 'Client waits at most',
      hint: 'How long the caller holds on. Anything slower is a failure the user sees, however healthy the server thinks it is.',
      kind: 'number',
      group: 'behaviour',
      unit: 'ms',
      min: 1,
    },
  ],

  routing: [CAPACITY, SERVICE_TIME, REPLICAS, POOL_SIZE, COST_OVERRIDE],

  compute: [
    ELASTIC,
    VCPU,
    MEMORY,
    SERVICE_TIME,
    CAPACITY,
    REPLICAS,
    AUTOSCALE_MIN,
    AUTOSCALE_MAX,
    CONCURRENCY,
    RATE_LIMIT,
    TIMEOUT,
    MULTI_AZ,
    {
      key: 'pricePerMillion',
      label: 'Price per million calls',
      hint: 'For a hosted endpoint you are billed per call rather than per hour. Multiplied by the traffic actually served.',
      kind: 'number',
      group: 'money',
      unit: '$',
      min: 0,
      step: 0.5,
    },
    COST_OVERRIDE,
  ],

  datastore: [
    VCPU,
    MEMORY,
    {
      key: 'storageGb',
      label: 'Data held',
      hint: 'GB stored. The part of the bill that grows whether or not anyone reads it.',
      kind: 'number',
      group: 'size',
      unit: 'GB',
      min: 0,
    },
    {
      key: 'shards',
      label: 'Shards',
      hint: 'Partitions holding different data, so throughput multiplies. Not the same as replicas, which hold the same data.',
      kind: 'number',
      group: 'scaling',
      min: 1,
      step: 1,
    },
    SERVICE_TIME,
    CAPACITY,
    REPLICAS,
    MAX_CONNECTIONS,
    MULTI_AZ,
    COST_OVERRIDE,
  ],

  cache: [
    {
      key: 'memoryGb',
      label: 'Cache size',
      hint: 'GB of working set. Too small and the hit rate you assumed never materialises.',
      kind: 'number',
      group: 'size',
      unit: 'GB',
      min: 0.25,
      step: 0.25,
    },
    {
      key: 'cacheHitRate',
      label: 'Hit rate',
      hint: 'Share of reads answered without touching what is behind it. The store behind sees the rest — and all of it if this dies.',
      kind: 'fraction',
      group: 'behaviour',
      min: 0,
      max: 1,
      step: 0.05,
    },
    SERVICE_TIME,
    CAPACITY,
    REPLICAS,
    MULTI_AZ,
    COST_OVERRIDE,
  ],

  messaging: [
    {
      key: 'queueDepthMax',
      label: 'Backlog it can hold',
      hint: 'Messages buffered before it starts refusing. Deep enough to ride out a spike, or shallow enough to notice one.',
      kind: 'number',
      group: 'behaviour',
      min: 0,
      step: 100,
    },
    CAPACITY,
    SERVICE_TIME,
    REPLICAS,
    MULTI_AZ,
    COST_OVERRIDE,
  ],

  external: [
    SERVICE_TIME,
    {
      key: 'rateLimitRps',
      label: 'Their rate limit',
      hint: 'What they will accept before refusing you. Traffic above it is rejected at their door, not queued at yours.',
      kind: 'number',
      group: 'behaviour',
      unit: 'rps',
      min: 0,
    },
    {
      key: 'pricePerMillion',
      label: 'Price per million calls',
      hint: 'What they charge. Multiplied by the traffic the simulation actually sends, so cost moves with load.',
      kind: 'number',
      group: 'money',
      unit: '$',
      min: 0,
      step: 0.5,
    },
    TIMEOUT,
    COST_OVERRIDE,
  ],

  ai: [
    ELASTIC,
    RATE_LIMIT,
    SERVICE_TIME,
    {
      key: 'tokensPerRequest',
      label: 'Tokens per request',
      hint: 'In and out together. This is the unit an inference bill is actually measured in.',
      kind: 'number',
      group: 'size',
      min: 0,
      step: 100,
    },
    {
      key: 'pricePer1kTokens',
      label: 'Price per 1k tokens',
      hint: 'Blended in and out. With tokens per request and the simulated traffic, this is the monthly inference bill.',
      kind: 'number',
      group: 'money',
      unit: '$',
      min: 0,
      step: 0.001,
    },
    CONCURRENCY,
    CAPACITY,
    REPLICAS,
    TIMEOUT,
    COST_OVERRIDE,
  ],

  control: [COST_OVERRIDE],

  /**
   * A boundary is usually just drawing furniture. But the moment it is declared a
   * shared host it stops being decoration and becomes the machines the components
   * inside it run on — which needs a size, a replica count and a scaling range, since
   * those are now the limits everything inside is competing for.
   */
  boundary: [
    {
      key: 'sharedHost',
      label: 'Everything inside runs on this pool',
      hint: 'The components drawn inside share these machines and their limits, instead of each having capacity and a bill of its own.',
      kind: 'toggle',
      group: 'size',
    },
    VCPU,
    MEMORY,
    REPLICAS,
    AUTOSCALE_MIN,
    AUTOSCALE_MAX,
    MULTI_AZ,
    COST_OVERRIDE,
  ],
};

/** The parameters this component type offers, in inspector order. */
export function paramsFor(type: ArchNodeType): ParamSpec[] {
  return PARAMS_BY_FAMILY[familyOf(type)];
}

export const GROUP_LABEL: Record<ParamGroup, string> = {
  traffic: 'Traffic',
  size: 'What it is',
  scaling: 'How many',
  behaviour: 'How it behaves',
  resilience: 'When something fails',
  money: 'Money',
};

export const GROUP_ORDER: ParamGroup[] = [
  'traffic',
  'size',
  'scaling',
  'behaviour',
  'resilience',
  'money',
];
