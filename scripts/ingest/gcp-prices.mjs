// GCP Cloud Billing Catalog -> a committed snapshot.
//
//   GOOGLE_API_KEY=... node scripts/ingest/gcp-prices.mjs
//
// ⚠ NEVER RUN. Unlike the Azure and AWS scripts, whose output is committed in
// `shared/src/data/`, this one has never been executed — it needs an API key
// nobody has supplied yet. It is written against Google's published API shape
// rather than against a response anybody has seen, so treat the field names below
// as a starting point and expect the first real run to correct them. There is no
// `gcp-prices.json` for exactly this reason: an empty or invented snapshot would
// be worse than an absent one, because the tests would go green over it.
//
// The two scripts that HAVE run both wrote clean, well-formed, plausible files
// containing prices wrong by a factor of five. Assume this one would too, and
// check the first output by hand against the pricing page.
//
// GCP's model, which is why this needs two calls rather than one:
//   1. /v1/services            -> service ids, e.g. Compute Engine is 6F81-5844-456A
//   2. /v1/services/{id}/skus  -> the priced meters within it
//
// Its `pricingExpression` is explicitly graduated: `tieredRates` carries a
// `startUsageAmount` and a price per tier. That is the clearest confirmation that
// modelling prices as tier lists rather than flat rates was the right call —
// flattening a GCP SKU to its first tier reads the free tier as the whole price.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'shared', 'src', 'data', 'gcp-prices.json');
const BASE = 'https://cloudbilling.googleapis.com/v1';

const KEY = process.env.GOOGLE_API_KEY;
const REGIONS = ['us-east1', 'europe-west1'];
/** Compute Engine. Confirm against /v1/services rather than trusting this. */
const WANTED_SERVICES = ['Compute Engine'];

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.replace(KEY, '***')}`);
  return res.json();
}

async function pagedList(url, field) {
  const items = [];
  let token = '';
  do {
    const page = await getJson(`${url}${url.includes('?') ? '&' : '?'}pageToken=${token}`);
    items.push(...(page[field] ?? []));
    token = page.nextPageToken ?? '';
  } while (token);
  return items;
}

/**
 * A GCP `pricingExpression` into the tier list the rest of the app speaks.
 *
 * `units` and `nanos` are separate fields and both count: $0.021811 arrives as
 * units "0", nanos 21811000. Reading only `units` silently prices everything
 * under a dollar at zero.
 */
function toTiers(expression) {
  return (expression?.tieredRates ?? [])
    .map((tier) => {
      const units = Number(tier.unitPrice?.units ?? 0);
      const nanos = Number(tier.unitPrice?.nanos ?? 0);
      return { fromUnits: Number(tier.startUsageAmount ?? 0), usd: units + nanos / 1e9 };
    })
    .sort((a, b) => a.fromUnits - b.fromUnits);
}

async function main() {
  if (!KEY) {
    console.error(
      'GOOGLE_API_KEY is not set.\n' +
        'Create a key in a GCP project with the Cloud Billing API enabled, then:\n' +
        '  GOOGLE_API_KEY=... node scripts/ingest/gcp-prices.mjs\n' +
        'The key is read from the environment and never written to the snapshot.',
    );
    process.exit(1);
  }

  const services = await pagedList(`${BASE}/services?key=${KEY}`, 'services');
  const wanted = services.filter((s) => WANTED_SERVICES.includes(s.displayName));
  if (wanted.length === 0) {
    throw new Error(
      `None of ${WANTED_SERVICES.join(', ')} found among ${services.length} services. ` +
        `Google renames these; list them and pick by hand rather than guessing.`,
    );
  }

  const skus = {};
  for (const service of wanted) {
    const rows = await pagedList(`${BASE}/${service.name}/skus?key=${KEY}`, 'skus');
    for (const row of rows) {
      const region = (row.serviceRegions ?? []).find((r) => REGIONS.includes(r));
      if (!region) continue;
      // Preemptible is GCP's spot, and is a fraction of on-demand. The Azure
      // script's hardest bug was exactly this class of thing.
      if (/preemptible|spot|commitment/i.test(row.description ?? '')) continue;

      const tiers = toTiers(row.pricingInfo?.[0]?.pricingExpression);
      if (tiers.length === 0) continue;

      const id = `gcp:${service.displayName.toLowerCase().replace(/\s+/g, '-')}:${row.skuId}:${region}`;
      skus[id] = {
        id,
        provider: 'gcp',
        service: service.displayName,
        display: row.description ?? row.skuId,
        region,
        limits: {},
        pricing: [{ kind: 'per-hour', tiers }],
        measuredAt: new Date().toISOString().slice(0, 7),
        confidence: 'documented',
      };
    }
  }

  const snapshot = {
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: 'GCP Cloud Billing Catalog API (cloudbilling.googleapis.com)',
    note: 'On-demand only; preemptible and committed-use rows excluded. Regenerate with scripts/ingest/gcp-prices.mjs.',
    // Code-unit order, not localeCompare: collation varies with Node's ICU build.
    skus: Object.fromEntries(
      Object.entries(skus).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`wrote ${Object.keys(skus).length} SKUs to ${OUT}`);
  console.log('UNVERIFIED: check a few of these against cloud.google.com/pricing before committing.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
