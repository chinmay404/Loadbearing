import { describe, expect, it } from 'vitest';
import type { ChatTurn, GraphDSL, Problem } from '@loadbearing/shared';
import { buildCritiquePrompt } from './prompt.js';

const graph: GraphDSL = {
  nodes: [
    { id: 'api', type: 'service', label: 'Checkout API', annotation: '' },
    { id: 'db', type: 'sql_db', label: 'Postgres', annotation: '' },
  ],
  edges: [{ id: 'e1', from: 'api', to: 'db', kind: 'sync', label: 'write order' }],
  stickies: [],
  flows: [],
};

const problem: Problem = {
  id: 'l3-checkout',
  title: 'Flash-sale checkout',
  level: 3,
  domain: 'e-commerce',
  prompt: 'Buyers place orders during a sale.',
  functional: ['place an order'],
  nonFunctional: { peakRps: 900, p99Ms: 250 },
  constraints: ['team of 5'],
  concepts: ['idempotency'],
  expectedFlows: [],
  rubricHints: '',
  twists: [],
  scenarios: [],
};

describe('buildCritiquePrompt', () => {
  it('carries the conversation so far, oldest turn first', () => {
    const history: ChatTurn[] = [
      { role: 'me', text: 'Where does this break under retries?' },
      { role: 'ai', text: 'Ask what happens when the same charge is submitted twice.' },
    ];
    const { user, system } = buildCritiquePrompt(problem, graph, 'why?', [], '', history);

    expect(user).toContain('THE CONVERSATION SO FAR');
    expect(user).toContain('LEARNER: Where does this break under retries?');
    expect(user).toContain('YOU: Ask what happens when the same charge is submitted twice.');
    // The new question comes last, so a bare "why?" reads as following the answer
    // immediately above it.
    expect(user.indexOf('THE CONVERSATION SO FAR')).toBeLessThan(user.lastIndexOf('why?'));
    expect(system).toContain('one continuing conversation');
  });

  it('says nothing about a conversation on the first question', () => {
    const { user } = buildCritiquePrompt(problem, graph, 'Where is the SPOF?');
    expect(user).not.toContain('THE CONVERSATION SO FAR');
  });
});
