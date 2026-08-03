// AWS RDS prices and instance specs -> a committed snapshot.
//
//   node scripts/ingest/aws-prices.mjs
//
// Public bulk offer files, no credentials. Same rules as the Azure script: run by
// hand, review the diff, commit the output, never wire it into CI.
//
// WHY CSV AND WHY RDS
//
// The bulk catalogue is published as both JSON and CSV per service per region.
// The EC2 region index is 480MB of JSON — it will defeat JSON.parse and there is
// no streaming parser here to reach for without taking a dependency. The CSV is
// line-oriented, so it streams in constant memory with no parser at all, and RDS
// is 18MB of it.
//
// RDS first because it is where this engine's new mechanisms actually bite: a
// database instance class carries a vCPU count, a memory size, AND a documented
// connection ceiling derived from that memory. That last one is the input to the
// pool-exhaustion model, and it is the difference between "your database is
// fine, look at the request rate" and "your fifty Lambdas need 1,000 connections
// and it accepts 450".

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'shared', 'src', 'data', 'aws-prices.json');

const REGIONS = ['us-east-1', 'eu-west-1'];
const OFFER = 'AmazonRDS';

/**
 * Postgres' connection ceiling on RDS, which AWS publishes as a formula over the
 * instance's memory rather than as a table:
 *
 *   max_connections = LEAST({DBInstanceClassMemory/9531392}, 5000)
 *
 * Computing it from the formula rather than copying a table means every instance
 * class gets a correct answer, including ones added after this was written.
 */
export function maxConnectionsFor(memoryGb) {
  if (!(memoryGb > 0)) return undefined;
  const bytes = memoryGb * 1024 ** 3;
  return Math.min(Math.floor(bytes / 9_531_392), 5000);
}

/** "16 GiB" -> 16. "1024 MiB" -> 1. Anything else -> undefined. */
function parseMemoryGb(raw) {
  const m = /^([\d.,]+)\s*(GiB|MiB)$/i.exec((raw ?? '').trim());
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return /mib/i.test(m[2]) ? n / 1024 : n;
}

/**
 * A CSV line into fields, honouring quotes and doubled quotes.
 *
 * Written out rather than pulled in because the alternative is a dependency in an
 * ingest script whose entire output is reviewed by hand anyway.
 */
function splitCsv(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/** Stream a URL line by line, so an 18MB file costs 18MB of bandwidth and no more memory. */
async function* lines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function fetchRegion(region, skus) {
  const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${OFFER}/current/${region}/index.csv`;
  process.stdout.write(`streaming ${OFFER} / ${region} ... `);

  let header = null;
  let seen = 0;
  let kept = 0;

  for await (const line of lines(url)) {
    // The file opens with a handful of metadata rows before the real header.
    if (!header) {
      if (line.startsWith('"SKU","OfferTermCode"')) header = splitCsv(line);
      continue;
    }
    seen += 1;
    const row = splitCsv(line);
    if (row.length !== header.length) continue;
    const get = (name) => row[header.indexOf(name)] ?? '';

    // On-demand Postgres, single-AZ, no BYOL — one price per instance class.
    if (get('TermType') !== 'OnDemand') continue;
    if (get('Product Family') !== 'Database Instance') continue;
    if (get('Database Engine') !== 'PostgreSQL') continue;
    if (get('Deployment Option') !== 'Single-AZ') continue;
    if (get('License Model') !== 'No license required') continue;
    if (get('Unit') !== 'Hrs') continue;

    const instance = get('Instance Type');
    const usd = Number(get('PricePerUnit'));
    if (!instance || !(usd > 0)) continue;

    const vcpu = Number(get('vCPU'));
    const memoryGb = parseMemoryGb(get('Memory'));
    const id = `aws:rds-postgres:${instance}:${region}`;

    // Every remaining row for one instance class should be the same price. If two
    // disagree, a dimension is being collapsed that should not be.
    const existing = skus[id];
    if (existing) {
      const prior = existing.pricing[0].tiers[0].usd;
      if (Math.abs(prior - usd) > 1e-9) {
        throw new Error(
          `${id}: two different on-demand prices ($${prior} and $${usd}). ` +
            `Some dimension is being merged that should not be — check the filters.`,
        );
      }
      continue;
    }

    kept += 1;
    skus[id] = {
      id,
      provider: 'aws',
      service: 'rds-postgres',
      display: instance,
      region,
      ...(Number.isFinite(vcpu) && vcpu > 0 ? { vcpu } : {}),
      ...(memoryGb !== undefined ? { memoryGb } : {}),
      limits: {
        ...(maxConnectionsFor(memoryGb) !== undefined
          ? { maxConnections: maxConnectionsFor(memoryGb) }
          : {}),
      },
      pricing: [{ kind: 'per-hour', tiers: [{ fromUnits: 0, usd }] }],
      measuredAt: new Date().toISOString().slice(0, 7),
      confidence: 'documented',
    };
  }

  process.stdout.write(`${seen} rows, ${kept} instance classes\n`);
}

async function main() {
  const skus = {};
  for (const region of REGIONS) await fetchRegion(region, skus);

  const snapshot = {
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: 'AWS Price List bulk offers (pricing.us-east-1.amazonaws.com), unauthenticated',
    note:
      'RDS PostgreSQL, on-demand, single-AZ, no BYOL. maxConnections is computed from ' +
      "AWS's documented formula LEAST(DBInstanceClassMemory/9531392, 5000) rather than copied. " +
      'Regenerate with scripts/ingest/aws-prices.mjs.',
    // Code-unit order, not localeCompare: collation varies with the ICU data Node
    // was built with, and a committed artefact must sort the same way everywhere.
    skus: Object.fromEntries(
      Object.entries(skus).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`wrote ${Object.keys(skus).length} SKUs to ${OUT}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
