# Provider environment: real SKUs, real limits, real bills

Design, 2026-08-03. Depends on `2026-08-03-engine-realism-design.md`.

## Why this comes second

The engine-realism spec adds connection pools, dependency occupancy and a
catalogue with provenance. This spec makes those mechanisms concrete by binding
each component to a real cloud offering.

The order matters. A `maxConnections` limit is only interesting once something
models connection demand; an instance's vCPU count is only interesting once
capacity derives from occupancy. Bind SKUs to an engine that ignores both and
you have a pricing calculator, not a simulator.

## What is wrong today

`cost.ts` states its own limitation plainly: the rates are "approximate,
provider-neutral and rounded… not a quote". A component is sized in abstract
vCPU and gigabytes, and priced at a flat blended rate.

Three consequences:

- **The real walls are invisible.** Lambda's 1,000 concurrent executions, API
  Gateway's 10,000 requests per second, DynamoDB's 3,000 reads per partition,
  and a Postgres instance's connection ceiling are the limits real systems
  actually hit. None of them exist in the model.
- **The bill is not recognisable.** Someone reviewing a system they own cannot
  compare the tool's number to their invoice, so the cost dimension of the
  review is advisory at best.
- **Sizing is unconstrained.** You can specify 3.5 vCPU. No cloud sells that.

## Approach

A **binding layer over the neutral model**, never a replacement.

The drawing stays provider-neutral: a `sql_db` remains a `sql_db`, and every
existing problem, blueprint and stored design keeps working untouched. A design
may optionally declare a deployment target, and a component may optionally bind
to a concrete SKU. Unbound components fall back to the generic catalogue from the
engine-realism spec.

This preserves what the tool is for. Loadbearing teaches architecture, not
procurement; a learner who never picks a provider must lose nothing.

### The six pricing shapes

The central simplification. Cloud billing looks like hundreds of models and is
in practice six:

```ts
type PricingShape =
  | { kind: 'per-hour';                  usd: number }
  | { kind: 'per-million-requests';      usd: number }
  | { kind: 'per-gb-month';              usd: number }
  | { kind: 'per-gb-transferred';        usd: number }
  | { kind: 'per-gb-second';             usd: number }
  | { kind: 'per-provisioned-unit-hour'; usd: number; unit: string };
```

`cost.ts` implements six formulas. Every service is then *data* filling one or
more of them. This is what makes full coverage across three providers a data
problem rather than three hundred special cases, and it is the load-bearing
decision in this design.

### The SKU record

```ts
interface Sku {
  id: string;                    // 'aws:rds-postgres:db.r6g.2xlarge'
  provider: 'aws' | 'azure' | 'gcp';
  service: string;               // 'rds-postgres'
  display: string;               // 'db.r6g.2xlarge'
  vcpu?: number;
  memoryGb?: number;
  networkGbps?: number;
  limits: {
    maxConnections?: number;
    concurrency?: number;
    rateLimitRps?: number;
    iops?: number;
  };
  pricing: PricingShape[];
  region: string;
  measuredAt: string;
  confidence: 'measured' | 'documented' | 'estimate';
}
```

Which component types a SKU may bind to is a property of its **service**, not of
each individual SKU — every `rds-postgres` instance class fits exactly the same
component types. So `fitsTypes` lives on the service entry in `services.json`,
and a SKU inherits it. Putting it on the SKU would repeat the same list across
hundreds of near-identical records and invite them to drift apart.

`id` is provider-prefixed so it is unambiguous and can be validated on load. A
design carrying a SKU id that no longer exists in the snapshot degrades to
unbound with a visible warning, rather than failing.

### Binding

`GraphDSL` gains `target?: 'neutral' | 'aws' | 'azure' | 'gcp'` and a default
`region`. `NodeAttrs` gains `sku?: string`.

Binding a SKU **writes its values into the existing attributes** — `vcpu`,
`memoryGb`, `maxConnections`, `rateLimitRps`, `concurrency` — and records that
they came from the SKU. The learner may edit any of them; the Inspector shows
the origin and marks the field as edited when it diverges.

This is deliberately the shallowest possible integration. The engine gains no new
mechanism from this spec: every SKU-derived value lands in a field the engine
already reads. The realism comes from the values being real, not from new physics.

### Service mapping

`data/services.json` maps component types to each provider's offering:

```json
{
  "sql_db": { "aws": "rds-postgres", "azure": "azure-db-postgres", "gcp": "cloud-sql-postgres" },
  "cache":  { "aws": "elasticache-redis", "azure": "azure-cache-redis", "gcp": "memorystore-redis" }
}
```

Only types with a distinct managed offering need a row. The rest — most compute
types — fall back to generic virtual machine SKUs, which is also what they are in
reality.

### Region

`region` already exists on `NodeAttrs` from the engine-realism spec, where it
selects cross-region RTT. Here it also selects the price. One field, two uses,
which is correct: distance and cost are both consequences of where a thing runs.

## Compatibility

Two distinct checks, both requested.

**SKU eligibility.** Each SKU declares `fitsTypes`. An RDS instance class cannot
bind to a cache. Enforced at bind time in the UI and re-validated on load.

**Provider-specific topology rules**, added to `compatibility.ts` and firing only
when a target is set. The existing 22 rules are provider-neutral and stay that
way. New rules include:

- A serverless function calling a relational database with no connection pooler
  or proxy between them. Each invocation opens its own connection; concurrent
  executions multiply against the instance's connection ceiling. With both ends
  bound this rule can state the arithmetic rather than the principle.
- A cache bound to a single-node offering while the design claims zone
  redundancy.
- A managed offering bound below the size its stated traffic requires, where the
  provider documents a hard throughput limit.

Rules cite the provider documentation that supports them, matching the citation
discipline the playbook already follows.

## Ingestion

`scripts/ingest/infracost.ts` queries the Cloud Pricing API — roughly three
million prices across the three providers — and **emits a filtered snapshot**:
only services named in `services.json`, only SKU families on an allowlist, only
the configured regions. The repository holds a few hundred kilobytes rather than
the whole catalogue.

`scripts/ingest/aws-quotas.ts` reads `list-aws-default-service-quotas` for real
limits. Azure and GCP publish quotas far less uniformly; where no machine
readable source exists, limits are hand-entered from provider documentation and
carry `confidence: 'documented'`. That unevenness is surfaced in the UI, not
smoothed over — a learner should be able to see that the AWS numbers are better
grounded than the GCP ones.

Derived limits are computed rather than copied where the provider publishes a
formula. Postgres on RDS, for instance, documents
`max_connections = LEAST(memory_bytes / 9531392, 5000)`, so every instance class
gets a correct ceiling from one rule instead of a hand-typed table.

Every snapshot carries its fetch date, and the UI displays "prices as of" beside
any cost total derived from bound SKUs. Prices go stale; pretending otherwise
would be the same failure this whole effort exists to correct.

## Delivery order

All three providers are the destination. The build order is AWS first, behind a
provider-generic interface, then Azure and GCP added as data through unchanged
code.

The reason is not scope reduction — it is that a wrong interface discovered after
one provider costs a refactor, and discovered after three costs three. AWS goes
first specifically because its quotas are the best documented, so the interface
is designed against the richest case rather than the poorest.

Phase A: pricing shapes, SKU record, binding UI, AWS compute and data services.
Phase B: remaining AWS managed services, provider-specific compatibility rules.
Phase C: Azure and GCP.

Phase C is "as data" for pricing and SKUs, which flow through unchanged code.
It is **not** purely data for compatibility: the topology rules added in Phase B
encode AWS-specific behaviour, and Azure and GCP need their own — Cloud Run's
concurrency model and Azure Functions' plan tiers fail differently from Lambda's.
Each provider therefore carries its own rule set, written against its own
documentation, sharing only the rule framework.

## Testing

- Each pricing shape is unit-tested against a hand-worked example taken from the
  provider's own pricing page, cited in the test.
- Binding is tested as a pure function: SKU plus component type in, attribute set
  out, including the edited-field case.
- A snapshot-integrity test asserts every SKU has at least one pricing shape, a
  region, a fetch date, and at least one entry in `fitsTypes`.
- An unknown SKU id must degrade to unbound with a warning rather than throw.
- Every existing problem, blueprint and test must pass unchanged with
  `target: 'neutral'`, which is the default. This is the guard on the whole
  design: if the neutral path moves at all, the layering is wrong.

## Risks

**Staleness.** A committed price snapshot is out of date the day after it is
taken. Mitigated by displaying the date wherever a bound cost is shown, and by
keeping re-ingestion a single scripted command. Not fully solvable, and should
not be presented as if it were.

**Uneven quota coverage.** AWS's limits are machine-readable; Azure's and GCP's
largely are not. The confidence tier makes this visible rather than hiding it
behind a uniform-looking interface.

**Mapping is human work.** Roughly 110 component types against three providers,
though most collapse into generic compute. There is no way to automate the
judgement of which offering corresponds to which abstraction, and a wrong mapping
is worse than none because it looks authoritative.

**Scope pressure on the teaching frame.** The more concrete the provider layer
becomes, the more the tool risks teaching AWS configuration instead of
architecture. The neutral default is the structural defence: a learner who never
picks a target sees exactly the tool that exists today.
