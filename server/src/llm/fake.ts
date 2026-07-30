/**
 * Canned responses for the `fake` provider, so the full loop (draw → review →
 * twist → mastery) can be exercised offline and in tests without a key. Shape
 * matters here, not insight: it must survive validateScore unchanged.
 */

const FAKE_SCORE = {
  overall: 64,
  dimensions: {
    requirements: { score: 7, max: 10, notes: 'Offline stub: the drawn components cover the main capabilities, but nothing was verified against the numbers.' },
    scalability: { score: 6, max: 10, notes: 'Offline stub: no real capacity reasoning was performed.' },
    reliability: { score: 5, max: 10, notes: 'Offline stub: retry and idempotency behaviour was not assessed.' },
    data_consistency: { score: 6, max: 10, notes: 'Offline stub: consistency requirements were not checked per data class.' },
    security: { score: 6, max: 10, notes: 'Offline stub: the auth boundary was not assessed.' },
    cost_simplicity: { score: 7, max: 10, notes: 'Offline stub: overengineering was not judged.' },
  },
  critical_failures: [
    {
      title: 'This is the offline stub, not a real review',
      detail:
        'The grader model is set to the offline stub, so these numbers are placeholders. Open Settings and point ArchDojo at Anthropic, Groq, DeepSeek, OpenAI or a local Ollama server to get a real review of this design.',
      concept: 'observability',
      severity: 'high',
    },
  ],
  spofs: ['Not assessed — offline stub.'],
  missing: ['A real grader model. Configure one in Settings.'],
  good_calls: ['You drew a design and declared flows, which is what the reviewer reads.'],
  socratic_questions: [
    'Which component saturates first as load grows, and what is your evidence?',
    'If your primary datastore fails over mid-write, what does the client see?',
  ],
  concept_scores: { observability: 0.5, 'capacity-estimation': 0.5, spof: 0.4 },
  model_answer_summary:
    'The offline stub cannot produce a model answer. Configure a real provider in Settings to see how a strong engineer would solve this problem, including the capacity math and the mechanisms that matter.',
  verdict_teaching: [
    {
      component: 'Grader model',
      why: 'Real feedback requires a model that can read your diagram and reason about the constraints.',
      breaks_without: 'You get placeholder scores that teach nothing.',
      rejected_alt: 'Hard-coded rule checks — they cannot judge trade-offs or annotations.',
    },
  ],
  canvas_markup: [],
  suggested_additions: [],
  flow_reviews: [],
};

const FAKE_CRITIQUE = {
  answer:
    'The grader model is set to the **offline stub**, so I cannot actually read your diagram. Open Settings and configure a provider (Anthropic, Groq, DeepSeek, OpenAI, OpenRouter or a local Ollama) to ask real questions about this design.',
  canvas_markup: [],
  suggested_additions: [],
};

const FAKE_PROBLEM = {
  id: 'l2-stub-generated-problem',
  title: 'Offline stub problem',
  level: 2,
  domain: 'devtools',
  prompt:
    'This placeholder problem exists so problem generation can be exercised without a grader model. Configure a real provider in Settings to generate problems that target your weakest concepts. A generated problem normally arrives with real traffic numbers, hard constraints and load scenarios.',
  functional: ['Serve a read API', 'Store user records', 'Expose health checks'],
  nonFunctional: { peakRps: 500, p99Ms: 200, dataGrowth: '10GB/year' },
  constraints: ['team of 2', 'cloud budget $200/mo'],
  concepts: ['caching', 'spof', 'capacity-estimation', 'observability'],
  expectedFlows: ['user profile read', 'profile update write'],
  rubricHints:
    'Placeholder problem from the offline stub. Watch for a cache with no invalidation story and a single database instance presented as highly available.',
  twists: [
    'Traffic grows 20x overnight after a launch — keep p99 under 200ms on the same budget.',
    'The single database instance must survive an availability-zone loss.',
  ],
  scenarios: [
    {
      id: 'stub-ramp',
      name: '20x ramp',
      description: 'Push twenty times the baseline load through every flow.',
      rpsMultiplier: 20,
      killNodes: [],
      thirdPartyLatencyMs: 0,
      passCriteria: 'No flow drops more than 1% of its offered traffic.',
    },
    {
      id: 'stub-kill-cache',
      name: 'Cache dies',
      description: 'Take the cache offline and see whether reads still complete.',
      rpsMultiplier: 5,
      killNodes: ['cache'],
      thirdPartyLatencyMs: 0,
      passCriteria: 'Reads keep serving from the database, slower but not broken.',
    },
  ],
};

/** Routes a fake call by inspecting the prompt the caller built. */
export function fakeResponseFor(system: string, _user: string): string {
  if (system.includes('author system-design interview problems')) return JSON.stringify(FAKE_PROBLEM);
  if (system.includes('sitting next to a learner at a whiteboard')) return JSON.stringify(FAKE_CRITIQUE);
  if (system.includes('connectivity probe')) return 'pong';
  return JSON.stringify(FAKE_SCORE);
}
