// The phase 1 speed gate for the request engine
// (docs/superpowers/specs/2026-10-10-request-engine-design.md, section 8):
// 7,000 rps for 60 s on the reference stack must finish in under 5 s.
//
//   npm run build:shared && node scripts/bench-des.mjs
//
// The topology and service times are loadtest/engine/compare.mjs's measured
// stack. At 7,000 rps that stack is past its knee (~6,250 rps of Node CPU), and
// until phase 3 bounds the queues an overloaded part queues without limit, so the
// parts are given enough cores not to saturate: this measures how fast events are
// handled, not where the stack breaks (des/reality.test.ts does that). The cache
// is drawn as a 20% call through to Postgres, which is what its 80% hit rate is.

import { runDes } from '../shared/dist/index.js';

const RPS = Number(process.argv[2] ?? 7000);
const SECONDS = Number(process.argv[3] ?? 60);
const RUNS = 3;
const BUDGET_MS = 5000;

const part = (id, type, latencyMs, vcpu) => ({ id, type, label: id, annotation: '', attrs: { latencyMs, vcpu } });
const edge = (from, to, share) => ({ id: `${from}-${to}`, from, to, kind: 'sync', label: '', placement: 'same-host', share });

const graph = {
  nodes: [
    { id: 'client', type: 'client', label: 'k6', annotation: '', attrs: { trafficRps: RPS } },
    part('nginx', 'reverse_proxy', 0.8, 16),
    part('app', 'service', 0.41, 16),
    part('redis', 'sql_db', 0.34, 16),
    part('pg', 'sql_db', 0.65, 16),
  ],
  edges: [edge('client', 'nginx'), edge('nginx', 'app'), edge('app', 'redis'), edge('redis', 'pg', 0.2)],
  stickies: [],
  flows: [],
};
const scenario = { id: 'bench', name: 'bench', horizonS: SECONDS, loadMultiplier: 1 };

const times = [];
let result;
for (let i = 0; i < RUNS; i += 1) {
  const start = performance.now();
  result = runDes(graph, scenario, { seed: i + 1 });
  times.push(performance.now() - start);
}

const best = Math.min(...times);
const requests = result.ticks.reduce((sum, t) => sum + t.offered, 0);
console.log(`${RPS} rps × ${SECONDS} s: ${requests.toLocaleString()} requests, ${result.events.toLocaleString()} events (${(result.events / requests).toFixed(1)} per request)`);
console.log(`runs: ${times.map((t) => `${(t / 1000).toFixed(2)} s`).join(', ')}  best ${(best / 1000).toFixed(2)} s  ≈ ${((result.events / best) * 1000 / 1e6).toFixed(2)} M events/s`);
console.log(`p50 ${result.ticks[30].p50Ms} ms  p99 ${result.p99ResponseMs} ms  heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
console.log(best < BUDGET_MS ? `PASS: under the ${BUDGET_MS / 1000} s budget` : `FAIL: over the ${BUDGET_MS / 1000} s budget`);
process.exitCode = best < BUDGET_MS ? 0 : 1;
