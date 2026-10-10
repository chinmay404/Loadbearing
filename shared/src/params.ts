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
  label: 'vCPU (instance type)',
  hint: 'vCPUs of the instance type or task size, e.g. m7g.large = 2. Most of the bill.',
  kind: 'number',
  group: 'size',
  min: 0.25,
  step: 0.25,
};

const MEMORY: ParamSpec = {
  key: 'memoryGb',
  label: 'Memory (GiB)',
  hint: 'Memory of the instance type or task size.',
  kind: 'number',
  group: 'size',
  unit: 'GB',
  min: 0.25,
  step: 0.25,
};

const SERVICE_TIME: ParamSpec = {
  key: 'latencyMs',
  label: 'Processing time (p50)',
  hint: 'Measured, not set: median time your code spends per request, excluding waits.',
  kind: 'number',
  group: 'behaviour',
  unit: 'ms',
  min: 0,
};

const CAPACITY: ParamSpec = {
  key: 'capacityRps',
  label: 'Max requests/sec per instance',
  hint: 'Measured in a load test, not set in AWS. Leave empty to derive it from size and processing time.',
  kind: 'number',
  group: 'size',
  unit: 'rps',
  min: 0,
};

const REPLICAS: ParamSpec = {
  key: 'replicas',
  label: 'Desired capacity',
  hint: 'How many instances run (ASG desired capacity, ECS desired count).',
  kind: 'number',
  group: 'scaling',
  min: 1,
  step: 1,
};

const AUTOSCALE_MIN: ParamSpec = {
  key: 'autoscaleMin',
  label: 'Minimum capacity',
  hint: 'Auto Scaling minimum. This is what meets the first minute of a spike.',
  kind: 'number',
  group: 'scaling',
  min: 1,
  step: 1,
};

const AUTOSCALE_MAX: ParamSpec = {
  key: 'autoscaleMax',
  label: 'Maximum capacity',
  hint: 'Auto Scaling maximum. New instances arrive about a minute late.',
  kind: 'number',
  group: 'scaling',
  min: 1,
  step: 1,
};

const CPU_MS: ParamSpec = {
  key: 'cpuMs',
  label: 'CPU time per request',
  hint: 'Measured, not set: CPU% ÷ requests per second.',
  kind: 'number',
  group: 'behaviour',
  unit: 'ms',
  min: 0.01,
  step: 0.01,
};

const LATENCY_P99: ParamSpec = {
  key: 'latencyP99Ms',
  label: 'Processing time (p99)',
  hint: 'Measured, not set: the slowest 1% of requests.',
  kind: 'number',
  group: 'behaviour',
  unit: 'ms',
  min: 0.01,
};

const CONCURRENCY: ParamSpec = {
  key: 'concurrency',
  label: 'Max concurrent requests per instance',
  hint: 'Worker threads or processes per instance (e.g. Gunicorn workers). Derived from vCPU when empty.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};

const TIMEOUT: ParamSpec = {
  key: 'timeoutMs',
  label: 'Client timeout',
  hint: 'A call slower than this fails instead of waiting.',
  kind: 'number',
  group: 'behaviour',
  unit: 'ms',
  min: 1,
};

const POOL_SIZE: ParamSpec = {
  key: 'poolSize',
  label: 'Connection pool size',
  hint: 'Connections kept open to the store; callers beyond this wait.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};

const MAX_CONNECTIONS: ParamSpec = {
  key: 'maxConnections',
  label: 'max_connections',
  hint: 'The database parameter-group limit on open connections.',
  kind: 'number',
  group: 'behaviour',
  min: 1,
  step: 1,
};

const MULTI_AZ: ParamSpec = {
  key: 'multiAz',
  label: 'Multi-AZ',
  hint: 'A standby in a second Availability Zone. Roughly doubles the bill.',
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
  label: 'Serverless / fully managed',
  hint: 'AWS runs the capacity; its quota and price are your limits, not instance size.',
  kind: 'toggle',
  group: 'size',
};

const RATE_LIMIT: ParamSpec = {
  key: 'rateLimitRps',
  label: 'Service quota (requests/sec)',
  hint: 'Requests per second the provider accepts before throttling you.',
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

  routing: [CAPACITY, SERVICE_TIME, LATENCY_P99, REPLICAS, POOL_SIZE, COST_OVERRIDE],

  compute: [
    ELASTIC,
    VCPU,
    MEMORY,
    SERVICE_TIME,
    CPU_MS,
    LATENCY_P99,
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
      label: 'Allocated storage (GiB)',
      hint: 'Storage provisioned for the database; billed whether or not it is read.',
      kind: 'number',
      group: 'size',
      unit: 'GB',
      min: 0,
    },
    {
      key: 'shards',
      label: 'Shards (partitions)',
      hint: 'Partitions holding different data, so throughput multiplies. Not read replicas.',
      kind: 'number',
      group: 'scaling',
      min: 1,
      step: 1,
    },
    SERVICE_TIME,
    CPU_MS,
    LATENCY_P99,
    CAPACITY,
    { ...REPLICAS, label: 'Instances (writer + read replicas)', hint: 'Copies holding the same data: one writer, the rest read replicas.' },
    MAX_CONNECTIONS,
    MULTI_AZ,
    COST_OVERRIDE,
  ],

  cache: [
    {
      key: 'memoryGb',
      label: 'Node memory (GiB)',
      hint: 'Memory of the cache node type, e.g. cache.r7g.large = 13 GiB.',
      kind: 'number',
      group: 'size',
      unit: 'GB',
      min: 0.25,
      step: 0.25,
    },
    {
      key: 'workingSetGb',
      label: 'Working set',
      hint: 'GB of distinct data actually being asked for. With the cache size, this caps the hit rate you can really get.',
      kind: 'number',
      group: 'size',
      unit: 'GB',
      min: 0,
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
    LATENCY_P99,
    CAPACITY,
    { ...REPLICAS, label: 'Nodes', hint: 'Cache nodes in the cluster (primary plus replicas).' },
    MULTI_AZ,
    COST_OVERRIDE,
  ],

  messaging: [
    {
      key: 'queueDepthMax',
      label: 'Max backlog (messages)',
      hint: 'Messages buffered before it starts refusing new ones.',
      kind: 'number',
      group: 'behaviour',
      min: 0,
      step: 100,
    },
    CAPACITY,
    SERVICE_TIME,
    { ...REPLICAS, label: 'Shards / partitions', hint: 'Kinesis shards or Kafka partitions. SQS scales itself, so leave it at 1.' },
    MULTI_AZ,
    COST_OVERRIDE,
  ],

  external: [
    SERVICE_TIME,
    LATENCY_P99,
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
    CPU_MS,
    LATENCY_P99,
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

/**
 * Managed services whose real settings differ from their family's. AWS runs and
 * scales these, so there is no instance count or per-instance capacity to choose —
 * only what the service itself lets you configure.
 */
export const PARAMS_BY_TYPE: Partial<Record<ArchNodeType, ParamSpec[]>> = {
  load_balancer: [
    {
      ...CAPACITY,
      label: 'LCU capacity reservation',
      hint: 'AWS scales a load balancer itself. Set this only to model capacity reserved before a known spike.',
      group: 'scaling',
    },
    { ...TIMEOUT, label: 'Idle timeout', hint: 'A connection idle longer than this is closed (default 60s).' },
    COST_OVERRIDE,
  ],
  api_gateway: [
    {
      ...CAPACITY,
      label: 'Throttling rate limit',
      hint: 'Steady requests/sec before callers get 429s. AWS default: 10,000 per account per Region.',
      group: 'behaviour',
    },
    { ...TIMEOUT, label: 'Integration timeout', hint: 'A backend slower than this returns 504 (default 29s).' },
    COST_OVERRIDE,
  ],
  cdn: [COST_OVERRIDE],
  dns: [COST_OVERRIDE],
  geo_router: [COST_OVERRIDE],
  waf: [COST_OVERRIDE],
};

/** The parameters this component type offers, in inspector order. */
export function paramsFor(type: ArchNodeType): ParamSpec[] {
  return PARAMS_BY_TYPE[type] ?? PARAMS_BY_FAMILY[familyOf(type)];
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
