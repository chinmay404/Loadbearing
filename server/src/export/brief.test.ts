import { describe, expect, it } from 'vitest';
import type { GraphDSL, Problem } from '@loadbearing/shared';
import { buildImplementationBrief } from './brief.js';

const graph: GraphDSL = {
  nodes: [
    { id: 'client', type: 'client', label: 'Shopper app', annotation: '' },
    {
      id: 'api',
      type: 'service',
      label: 'Checkout API',
      annotation: 'Idempotency key stored with the result in the same transaction.',
      attrs: { capacityRps: 400, replicas: 3, latencyMs: 45 },
    },
    { id: 'q', type: 'queue', label: 'Order Events', annotation: 'Bounded, consumers idempotent.' },
    { id: 'dlq', type: 'dead_letter_queue', label: 'Dead Letters', annotation: 'Alarmed on depth > 0.' },
    { id: 'db', type: 'sql_db', label: 'Postgres', annotation: 'System of record.', attrs: { capacityRps: 900 } },
    { id: 'stripe', type: 'payment_gateway', label: 'Stripe', annotation: 'Charge with the same key.' },
  ],
  edges: [
    { id: 'e1', from: 'client', to: 'api', kind: 'sync', label: 'POST /checkout' },
    { id: 'e2', from: 'api', to: 'db', kind: 'sync', label: 'write order' },
    { id: 'e3', from: 'api', to: 'stripe', kind: 'sync', label: 'charge' },
    { id: 'e4', from: 'api', to: 'q', kind: 'async', label: 'order placed' },
    { id: 'e5', from: 'q', to: 'dlq', kind: 'async', label: 'after retries' },
  ],
  stickies: [],
  flows: [
    {
      id: 'f1',
      name: 'checkout write path',
      kind: 'write',
      steps: ['client', 'api', 'db'],
      rps: 300,
      description: 'A buyer places an order.',
    },
  ],
};

const problem: Problem = {
  id: 'l3-checkout',
  title: 'Flash-sale checkout',
  level: 3,
  domain: 'e-commerce',
  prompt: 'Buyers place orders during a sale.',
  functional: ['place an order', 'charge the card'],
  nonFunctional: { peakRps: 900, p99Ms: 250 },
  constraints: ['team of 5', '$6k/mo'],
  concepts: ['idempotency'],
  expectedFlows: ['checkout write path'],
  rubricHints: 'Hunt for a double charge.',
  twists: [],
  scenarios: [
    {
      id: 'spike',
      name: 'Sale spike',
      description: '10x traffic',
      rpsMultiplier: 10,
      killNodes: [],
      thirdPartyLatencyMs: 0,
      passCriteria: 'No order is charged twice.',
    },
  ],
};

describe('buildImplementationBrief', () => {
  const { markdown } = buildImplementationBrief({ graph, problem });

  it('states the context, requirements and hard constraints', () => {
    expect(markdown).toContain('Flash-sale checkout');
    expect(markdown).toContain('Buyers place orders during a sale.');
    expect(markdown).toContain('peakRps: 900');
    expect(markdown).toContain('team of 5');
  });

  it('lists each component with its type and its sizing', () => {
    expect(markdown).toContain('### Checkout API  `service`');
    expect(markdown).toContain('400 rps per instance');
    expect(markdown).toContain('3 instances');
  });

  it('carries each component annotation through as the mechanism to build', () => {
    expect(markdown).toContain('Idempotency key stored with the result in the same transaction.');
  });

  it('spells out request paths as numbered, ordered steps with ids', () => {
    expect(markdown).toContain('### checkout write path (write, 300 rps)');
    expect(markdown).toMatch(/1\. Shopper app `client`/);
    expect(markdown).toMatch(/3\. Postgres `db`/);
  });

  it('derives invariants from the connection kinds and the components used', () => {
    expect(markdown).toContain('is asynchronous');
    expect(markdown).toMatch(/third party carries a timeout/);
    expect(markdown).toMatch(/dead-letter queue is alarmed/);
    expect(markdown).toMatch(/Queue consumers are idempotent/);
  });

  it('reports the capacity the design assumes', () => {
    expect(markdown).toContain('## Capacity the design assumes');
    expect(markdown).toMatch(/\$\d+\/month/);
  });

  it('names the known gaps rather than letting an agent silently fix them', () => {
    expect(markdown).toContain('## Known gaps in this design');
    // This design has no auth and no observability; both are real findings.
    expect(markdown.toLowerCase()).toMatch(/auth|observability/);
  });

  it('produces acceptance checks from the flows and the load scenarios', () => {
    expect(markdown).toContain('## Acceptance');
    expect(markdown).toContain('`checkout write path` completes end to end at 300 rps');
    expect(markdown).toContain('No order is charged twice.');
  });

  it('embeds the graph as JSON so an agent need not parse the prose', () => {
    const json = markdown.slice(markdown.indexOf('```json') + 7, markdown.lastIndexOf('```'));
    const parsed = JSON.parse(json) as GraphDSL;
    expect(parsed.nodes.map((n) => n.id)).toContain('api');
    expect(parsed.flows[0]!.steps).toEqual(['client', 'api', 'db']);
  });

  it('works without a problem sheet, and says the diagram is the requirement', () => {
    const { markdown: bare } = buildImplementationBrief({ graph, problem: undefined });
    expect(bare).toContain('No problem sheet was attached');
    expect(bare).toContain('### Checkout API  `service`');
  });

  it('asks for the assumption to be stated when flows are missing', () => {
    const { markdown: noFlows } = buildImplementationBrief({
      graph: { ...graph, flows: [] },
      problem,
    });
    expect(noFlows).toContain('No flows were declared');
  });

  it('flags a component with no annotation instead of inventing its behaviour', () => {
    expect(markdown).toContain('No mechanism was written on this component');
  });
});
