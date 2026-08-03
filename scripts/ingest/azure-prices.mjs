// Azure retail prices -> a committed snapshot.
//
// Run by hand, never in CI and never at request time. The engine's whole
// credibility rests on a given commit producing identical numbers offline and
// forever; a pipeline that refreshed prices automatically would quietly break
// that. The output is reviewed and committed like any other source change.
//
//   node scripts/ingest/azure-prices.mjs
//
// Azure is the first of the three because it needs no credentials at all, so the
// snapshot shape, the tier handling and the filtering can all be settled before
// any secret handling exists. AWS and GCP follow the shape this establishes.
//
// WHAT THE API ACTUALLY RETURNS, which is not quite what the docs suggest:
//
//   * 1,000 items a page, with `NextPageLink` until exhausted.
//   * The same SKU appears several times over, and `type` alone does not separate
//     them. Spot and Low Priority meters are BOTH typed Consumption, so filtering
//     on type leaves three prices for one machine — for a D4s v5 in East US:
//     $0.0384 spot, $0.0405 low priority and $0.192 on demand. They have to be
//     told apart by meterName. Getting this wrong does not fail loudly; it
//     silently prices the fleet at a fifth of what it costs.
//   * Separately there is a Windows and a Linux product for most VM sizes. Take
//     the one whose productName does not say Windows — a Windows licence is not
//     the price of the machine.
//   * `tierMinimumUnits` is the graduated-pricing field. It is 0 for every VM
//     meter, but it is emphatically not 0 across the whole catalogue, which is
//     why the snapshot models a tier list rather than a flat rate.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'shared', 'src', 'data', 'azure-prices.json');

/** Only what the component catalogue can actually use. */
const REGIONS = ['eastus', 'westeurope'];
const SERVICES = ['Virtual Machines'];

/** The instance families worth offering, rather than all several hundred. */
const SKU_ALLOWLIST = /^Standard_(B|D|E|F)\d+[a-z]*s?_v[45]$/;

async function page(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchAll(filter) {
  let url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
  const items = [];
  while (url) {
    const body = await page(url);
    items.push(...body.Items);
    url = body.NextPageLink ?? null;
  }
  return items;
}

/**
 * One price per SKU, as a tier list.
 *
 * A flat rate is a single tier starting at zero, so the common case stays trivial
 * while graduated meters — which Azure, AWS egress and GCP all have — survive
 * intact instead of being flattened to whatever the first tier happened to be.
 */
function toTiers(rows, id) {
  const tiers = rows
    .map((r) => ({ fromUnits: r.tierMinimumUnits ?? 0, usd: r.retailPrice }))
    .sort((a, b) => a.fromUnits - b.fromUnits);

  // Two tiers starting at the same point are not tiers. It means the filtering
  // above let two different meters for one SKU through — a spot price beside an
  // on-demand one, say — and the snapshot would carry whichever happened to sort
  // first. Refuse rather than write a plausible wrong number.
  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i].fromUnits <= tiers[i - 1].fromUnits) {
      throw new Error(
        `${id}: ${tiers.length} prices with non-increasing tier boundaries ` +
          `(${tiers.map((t) => `${t.fromUnits}:$${t.usd}`).join(', ')}). ` +
          `Two meters are being merged as if they were one; tighten the filter.`,
      );
    }
  }
  return tiers;
}

async function main() {
  const skus = {};

  for (const service of SERVICES) {
    for (const region of REGIONS) {
      const filter = `serviceName eq '${service}' and armRegionName eq '${region}'`;
      process.stdout.write(`fetching ${service} / ${region} ... `);
      const items = await fetchAll(filter);
      process.stdout.write(`${items.length} meters\n`);

      const wanted = items.filter(
        (i) =>
          i.type === 'Consumption' &&
          // Spot and Low Priority are also 'Consumption'. Only the meter name
          // separates them, and they are a fifth of the on-demand price.
          !/\b(spot|low priority)\b/i.test(i.meterName ?? '') &&
          // Cloud Services (classic) meters share the SKU name and are a
          // different product at a different price — 'Dadsv5 Series Cloud
          // Services' at $0.78 beside the actual VM at $0.412. Require the
          // product to say it is a virtual machine rather than merely not say
          // it is something else.
          /^Virtual Machines\b/.test(i.productName ?? '') &&
          // A Windows licence is not the price of the machine.
          !/windows/i.test(i.productName ?? '') &&
          typeof i.armSkuName === 'string' &&
          SKU_ALLOWLIST.test(i.armSkuName),
      );

      const byName = new Map();
      for (const item of wanted) {
        const key = `azure:vm:${item.armSkuName}:${region}`;
        (byName.get(key) ?? byName.set(key, []).get(key)).push(item);
      }

      for (const [id, rows] of byName) {
        const first = rows[0];
        skus[id] = {
          id,
          provider: 'azure',
          service: 'virtual-machines',
          display: first.armSkuName,
          region,
          pricing: [{ kind: 'per-hour', tiers: toTiers(rows, id) }],
          measuredAt: new Date().toISOString().slice(0, 7),
          confidence: 'documented',
        };
      }
    }
  }

  const snapshot = {
    // Stamped so a reader can see how stale this is without checking git.
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: 'Azure Retail Prices API (prices.azure.com), unauthenticated',
    note: 'Consumption meters only, Linux, allowlisted general-purpose families. Regenerate with scripts/ingest/azure-prices.mjs.',
    // Sorted so a re-run with unchanged prices produces a zero-line diff.
    //
    // Code-unit order, NOT localeCompare: collation depends on the ICU data the
    // running Node was built with, so two people regenerating this from the same
    // prices could produce two different files. A committed artefact has to sort
    // the same way everywhere.
    skus: Object.fromEntries(
      Object.entries(skus).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`wrote ${Object.keys(skus).length} SKUs to ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
