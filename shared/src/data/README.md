# Snapshots

Generated files. Do not hand-edit — re-run the script and commit the diff.

These exist so the engine can use real numbers without giving up the property
that makes it trustworthy: a given commit produces identical results, offline,
forever. Fetching prices at request time would break determinism, the free
scenario gates, and the grader's licence to treat engine output as fact. So
ingestion is a manual step whose output is reviewed like any other source change.

**Nothing here runs in CI.** A pipeline that refreshed prices automatically would
silently reintroduce exactly the problem this design avoids.

## Files

| file | script | auth | last shape check |
| --- | --- | --- | --- |
| `azure-prices.json` | `scripts/ingest/azure-prices.mjs` | none | 2026-08-03 |

Planned, following the shape Azure established: `aws-prices` (public bulk offers,
fetched **per region** — the whole EC2 file is gigabytes), `aws-quotas`
(`list-aws-default-service-quotas`, needs IAM), `gcp-prices` (Cloud Billing
Catalog, needs an API key). Credentials are read from the local environment and
never committed.

## Licences

Only sources whose terms permit redistribution are vendored here.

- **Azure Retail Prices API** — public and unauthenticated, no key or agreement
  required to read. Vendored.
- **benchANT** — the best available source for datastore throughput and p95
  latency, and **not vendored**: it is CC BY-NC-SA, which does not compose with
  this repository's Apache-2.0 licence. It may be used as a cited calibration
  reference in `catalog.ts`, with attribution, never as bulk data.
- **ClickBench** — Apache-2.0. Vendorable when the analytical-store numbers are
  sourced.

## What the Azure API actually returns

Recorded because two of these cost real debugging time and neither fails loudly.

- 1,000 items per page, `NextPageLink` until exhausted. East US alone is ~16,000
  meters for Virtual Machines.
- **Spot and Low Priority meters are also typed `Consumption`.** Filtering on
  `type` alone leaves three prices for one machine — a D4s v5 in East US is
  $0.0384 spot, $0.0405 low priority, $0.192 on demand. Only `meterName`
  separates them. Get this wrong and the fleet is priced at a fifth of reality.
- **Cloud Services (classic) meters share the SKU name.** `Dadsv5 Series Cloud
  Services` at $0.78 sits beside the actual VM at $0.412, and its product name
  contains neither "Windows" nor anything else obvious. The filter requires
  `productName` to *start with* `Virtual Machines` rather than merely not match an
  exclusion list.
- `tierMinimumUnits` is the graduated-pricing field. It is 0 for every VM meter,
  but not across the wider catalogue, which is why the snapshot models a tier list
  rather than a flat rate.

The ingest script refuses to write a SKU whose tier boundaries are not strictly
increasing. Two prices both starting at zero means two different meters are being
merged as one, and that guard is what caught both bugs above.
