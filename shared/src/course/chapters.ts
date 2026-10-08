import type { BlueprintLike, BlueprintNode } from '../blueprints.js';
import type { NodeAttrs } from '../types.js';
import type { Chapter, Step } from './types.js';

/**
 * Pocket Market: a small online shop that grows across the course. Every step is
 * one change to it, judged by the simulator. Words are kept short and plain.
 */

const X = 300;
const Y = 200;

const part = (key: string, type: BlueprintNode['type'], label: string, col: number, row: number, attrs?: NodeAttrs): BlueprintNode => ({
  key,
  type,
  label,
  annotation: '',
  at: { x: col * X, y: row * Y },
  ...(attrs ? { attrs } : {}),
});

const design = (name: string, nodes: BlueprintNode[], edges: [string, string][]): BlueprintLike => ({
  name,
  nodes,
  edges: edges.map(([from, to]) => ({ from, to, kind: 'sync' as const })),
  flows: [],
});

// ------------------------------------------------------------------ prologue --

const phone = (rps: number) => part('phone', 'client', 'Her phone', 0, 0, { trafficRps: rps });
const app = (attrs: NodeAttrs) => part('app', 'service', 'Shop app', 1, 0, attrs);
const db = (attrs: NodeAttrs = { vcpu: 1 }) => part('db', 'sql_db', 'Orders DB', 2, 0, attrs);

const prologue: Chapter = {
  id: 'prologue',
  number: 0,
  title: 'What is a request?',
  promise: 'Follow one request from a phone to a database and back.',
  unlocks: ['client', 'service', 'sql_db'],
  steps: [
    {
      id: 'p-1',
      chapter: 'prologue',
      type: 'tune-dial',
      title: 'Room for ten friends',
      story: 'Ten friends open the shop at once. The app can only handle one request at a time.',
      task: 'Give the app more workers until no one is turned away.',
      start: design('p-1', [phone(10), app({ concurrency: 1, latencyMs: 100 }), db()], [
        ['phone', 'app'],
        ['app', 'db'],
      ]),
      parts: [],
      dials: [{ key: 'app', attr: 'concurrency', label: 'Workers', unit: '', min: 1, max: 8, step: 1 }],
      budget: 250,
      gates: [{ id: 'ten', label: '10 req/s · at most 1% lost', rps: 10, maxLostPct: 1 }],
      hints: {
        question: 'Each request takes about 100 ms. How many can one worker finish in a second?',
        concept: 'One worker finishes about 1 ÷ 0.1 s = 10 requests a second, and only if nothing else waits. More workers means more requests at the same time.',
      },
      lesson: 'Capacity is workers ÷ time per request. More workers, more requests per second.',
      solution: { set: [{ key: 'app', attrs: { concurrency: 3 } }] },
    },
    {
      id: 'p-2',
      chapter: 'prologue',
      type: 'fill-gap',
      title: 'Orders need a home',
      story: 'People can place orders, but the app forgets them when it restarts.',
      task: 'Add a database and connect the app to it.',
      start: design('p-2', [phone(5), app({ concurrency: 8, latencyMs: 100 })], [['phone', 'app']]),
      parts: ['sql_db'],
      budget: 250,
      gates: [
        {
          id: 'saved',
          label: 'Orders reach the database',
          rps: 5,
          maxLostPct: 1,
          reaches: { part: { type: 'sql_db' }, label: 'orders reach the database' },
        },
      ],
      hints: {
        question: 'Where does an order live after the app has answered?',
        concept: 'An app keeps things in memory only while it runs. A database writes them to disk, so they survive a restart.',
        ghost: { type: 'sql_db', label: 'Orders DB', between: ['app', 'app'] },
      },
      lesson: 'The app does the work. The database remembers it.',
      solution: { add: [{ key: 'db', type: 'sql_db', label: 'Orders DB', attrs: { vcpu: 1 } }], connect: [['app', 'db']] },
    },
    {
      id: 'p-3',
      chapter: 'prologue',
      type: 'fix-wiring',
      title: 'The phone talks to the database',
      story: 'To save time, the phone was wired straight to the database. Now every phone holds the database password.',
      task: 'Rewire it so the phone only talks to the app.',
      start: design('p-3', [phone(5), app({ concurrency: 8, latencyMs: 100 }), db()], [['phone', 'db']]),
      parts: [],
      budget: 250,
      clears: ['client-direct-to-datastore'],
      gates: [
        {
          id: 'via-app',
          label: 'Requests go through the app',
          rps: 5,
          maxLostPct: 1,
          reaches: { part: { key: 'app' }, label: 'requests go through the app' },
        },
      ],
      hints: {
        question: 'Who should be allowed to hold the database password?',
        concept: 'Anything a phone can do, anyone with the phone can do. The app sits in between and decides what each user may read and write.',
      },
      lesson: 'Phones talk to your app. Only your app talks to the database.',
      solution: { disconnect: [['phone', 'db']], connect: [['phone', 'app'], ['app', 'db']] },
    },
    {
      id: 'p-4',
      chapter: 'prologue',
      type: 'find-bottleneck',
      title: 'Who breaks first?',
      story: 'A post about the shop goes around. Traffic is about to jump to 60 requests a second.',
      task: 'Click the part you think fails first, then run it.',
      start: design('p-4', [phone(60), app({ concurrency: 4, latencyMs: 100 }), db()], [
        ['phone', 'app'],
        ['app', 'db'],
      ]),
      parts: [],
      predict: true,
      observe: true,
      budget: 250,
      gates: [{ id: 'jump', label: '60 req/s', rps: 60, maxLostPct: 1 }],
      hints: {
        question: 'Which part has the fewest workers for how long its requests take?',
        concept: 'The app has 4 workers and each request takes about 100 ms, so it tops out near 40 a second. The database can do far more.',
      },
      lesson: 'The weakest part sets the speed for everything. Find it before your users do.',
      solution: {},
    },
    {
      id: 'p-5',
      chapter: 'prologue',
      type: 'checkpoint',
      title: 'Her phone',
      story: 'Your friend wants to use the shop on her phone. Build the whole thing.',
      task: 'Add an app and a database so orders get saved.',
      start: design('p-5', [phone(10)], []),
      parts: ['service', 'sql_db'],
      budget: 250,
      clears: ['client-direct-to-datastore'],
      gates: [
        {
          id: 'one',
          label: 'One friend · nothing lost',
          rps: 1,
          maxLostPct: 0,
          reaches: { part: { type: 'sql_db' }, label: 'orders are saved' },
        },
        { id: 'ten', label: 'Ten friends · at most 1% lost · p99 under 300 ms', rps: 10, maxLostPct: 1, maxP99Ms: 300 },
      ],
      hints: {
        question: 'What does a request touch on its way from the phone to a saved order?',
        concept: 'Phone → app → database. The phone asks, the app works, the database remembers.',
        ghost: { type: 'service', label: 'Shop app', between: ['phone', 'phone'] },
      },
      lesson: 'A request is a dot that travels, waits and comes back. Every box adds time, and every box has a limit.',
      solution: {
        add: [
          { key: 'app', type: 'service', label: 'Shop app' },
          { key: 'db', type: 'sql_db', label: 'Orders DB', attrs: { vcpu: 1 } },
        ],
        connect: [
          ['phone', 'app'],
          ['app', 'db'],
        ],
      },
    },
  ],
};

// ----------------------------------------------------------------- chapter 1 --

/** One box that renders pages slowly: 8 workers per vCPU, 400 ms a page. */
const shop = (rps: number, vcpu: number) => [
  part('users', 'client', 'Shoppers', 0, 0, { trafficRps: rps }),
  part('app', 'service', 'Shop app', 1, 0, { vcpu, latencyMs: 400 }),
  part('db', 'sql_db', 'Orders DB', 2, 0, { vcpu: 1 }),
];
const shopWires: [string, string][] = [
  ['users', 'app'],
  ['app', 'db'],
];

const chapter1: Chapter = {
  id: 'ch1',
  number: 1,
  title: 'One box, one problem',
  promise: 'What one machine can carry, and what happens when it stops.',
  unlocks: [],
  steps: [
    {
      id: '1-1',
      chapter: 'ch1',
      type: 'find-bottleneck',
      title: 'Twenty at once',
      story: '100 people found the shop on a forum. One evening, 20 arrive in the same second.',
      task: 'Click the part you think fails first, then run it.',
      start: design('1-1', shop(20, 1), shopWires),
      parts: [],
      predict: true,
      observe: true,
      budget: 400,
      gates: [{ id: 'forum', label: '20 req/s', rps: 20, maxLostPct: 1 }],
      hints: {
        question: 'Which part spends the longest on each request?',
        concept: 'The app takes 400 ms a page. With 8 workers that is about 20 pages a second, and the forum sends just over that.',
      },
      lesson: 'A slow page uses up workers. Twenty a second is already too much for one small box.',
      solution: {},
    },
    {
      id: '1-2',
      chapter: 'ch1',
      type: 'tune-dial',
      title: 'A bigger box',
      story: 'The forum crowd is turned away at the door.',
      task: 'Make the app bigger until 20 req/s gets through.',
      start: design('1-2', shop(20, 1), shopWires),
      parts: [],
      dials: [{ key: 'app', attr: 'vcpu', label: 'Size', unit: 'vCPU', min: 1, max: 8, step: 1 }],
      budget: 400,
      gates: [{ id: 'forum', label: 'Forum spike · 20 req/s · at most 1% lost', rps: 20, maxLostPct: 1 }],
      hints: {
        question: 'How many workers does each vCPU add?',
        concept: 'Each vCPU runs about 8 requests at the same time. At 400 ms each, one vCPU carries about 20 a second.',
      },
      lesson: 'You can buy capacity: a bigger box runs more requests at once.',
      solution: { set: [{ key: 'app', attrs: { vcpu: 2 } }] },
    },
    {
      id: '1-3',
      chapter: 'ch1',
      type: 'tune-dial',
      title: 'Same speed, smaller bill',
      story: 'It works, but someone picked the biggest box on the menu.',
      task: 'Make it as small as you can while 20 req/s still passes.',
      start: design('1-3', shop(20, 8), shopWires),
      parts: [],
      dials: [{ key: 'app', attr: 'vcpu', label: 'Size', unit: 'vCPU', min: 1, max: 8, step: 1 }],
      budget: 160,
      gates: [{ id: 'forum', label: 'Forum spike · 20 req/s · at most 1% lost', rps: 20, maxLostPct: 1 }],
      hints: {
        question: 'What is the smallest size that still passed in the last step?',
        concept: 'You pay for every vCPU all month, busy or not. The right size is the smallest one that passes, plus a little room.',
      },
      lesson: 'Bigger always works, and always costs. The skill is picking the smallest box that passes.',
      solution: { set: [{ key: 'app', attrs: { vcpu: 2 } }] },
    },
    {
      id: '1-4',
      chapter: 'ch1',
      type: 'kill-switch',
      title: 'When the box dies',
      story: 'Ten seconds into a busy evening, the app crashes.',
      task: 'Run it and watch what happens to the shop.',
      start: design('1-4', shop(10, 2), shopWires),
      parts: [],
      observe: true,
      budget: 400,
      gates: [{ id: 'crash', label: 'App crashes at 10 s', rps: 10, horizonS: 30, kill: { key: 'app', atS: 10 }, maxLostPct: 1 }],
      hints: {
        question: 'Where can a request go when the only app is gone?',
        concept: 'One of anything is a single point of failure. When it stops, everything behind it stops too.',
      },
      lesson: 'One box is one point of failure. Bigger does not help when it is off.',
      solution: {},
    },
    {
      id: '1-5',
      chapter: 'ch1',
      type: 'checkpoint',
      title: 'The forum post',
      story: 'The forum post is back on the front page. Get through the evening on a small budget.',
      task: 'Size the app and the database so both runs pass under budget.',
      start: design('1-5', shop(5, 1), shopWires),
      parts: [],
      dials: [
        { key: 'app', attr: 'vcpu', label: 'App size', unit: 'vCPU', min: 1, max: 8, step: 1 },
        { key: 'db', attr: 'vcpu', label: 'Database size', unit: 'vCPU', min: 1, max: 8, step: 1 },
      ],
      budget: 160,
      gates: [
        { id: 'quiet', label: 'Quiet day · 5 req/s · at most 0.5% lost', rps: 5, maxLostPct: 0.5 },
        { id: 'spike', label: 'Forum spike · 20 req/s · at most 1% lost', rps: 20, maxLostPct: 1 },
      ],
      hints: {
        question: 'Which of the two parts was the one that broke at 20 req/s?',
        concept: 'Only grow the part that is actually full. Growing the database here costs money and changes nothing.',
      },
      lesson: 'Capacity is workers ÷ time. You can buy workers, but one box is still one box.',
      solution: { set: [{ key: 'app', attrs: { vcpu: 2 } }] },
    },
  ],
};

// ----------------------------------------------------------------- chapter 2 --

/** Two copies of the shop app, a balancer that may or may not be wired in front. */
const pair = (rps: number, lb: NodeAttrs = {}) => [
  part('users', 'client', 'Shoppers', 0, 0.5, { trafficRps: rps }),
  part('lb', 'load_balancer', 'Load balancer', 1, 0.5, lb),
  part('a', 'service', 'Shop app A', 2, 0, { vcpu: 2, latencyMs: 400 }),
  part('b', 'service', 'Shop app B', 2, 1, { vcpu: 2, latencyMs: 400 }),
  part('db', 'sql_db', 'Orders DB', 3, 0.5, { vcpu: 2 }),
];
const pairWired: [string, string][] = [
  ['users', 'lb'],
  ['lb', 'a'],
  ['lb', 'b'],
  ['a', 'db'],
  ['b', 'db'],
];

const chapter2: Chapter = {
  id: 'ch2',
  number: 2,
  title: 'Two of everything',
  promise: 'Why a second copy only helps when something sends traffic to it.',
  unlocks: ['load_balancer'],
  steps: [
    {
      id: '2-1',
      chapter: 'ch2',
      type: 'fill-gap',
      title: 'Two boxes, no front door',
      story: 'You bought a second app box. It sits there doing nothing, because shoppers only know the first one.',
      task: 'Put a load balancer in front so both boxes get traffic.',
      start: design(
        '2-1',
        [
          part('users', 'client', 'Shoppers', 0, 0.5, { trafficRps: 50 }),
          part('a', 'service', 'Shop app A', 2, 0, { vcpu: 2, latencyMs: 400 }),
          part('b', 'service', 'Shop app B', 2, 1, { vcpu: 2, latencyMs: 400 }),
          part('db', 'sql_db', 'Orders DB', 3, 0.5, { vcpu: 2 }),
        ],
        [
          ['users', 'a'],
          ['a', 'db'],
          ['b', 'db'],
        ],
      ),
      parts: ['load_balancer'],
      budget: 400,
      uses: [{ type: 'load_balancer', label: 'Traffic goes through a load balancer' }],
      clears: ['lb-without-backends'],
      gates: [{ id: 'busy', label: '50 req/s · at most 1% lost', rps: 50, maxLostPct: 1 }],
      hints: {
        question: 'How does a shopper reach box B today?',
        concept: 'A load balancer is the one address shoppers know. It hands each request to one of the boxes behind it.',
        ghost: { type: 'load_balancer', label: 'Load balancer', between: ['users', 'a'] },
      },
      lesson: 'A second box only helps when something sends traffic to it.',
      solution: {
        add: [{ key: 'lb', type: 'load_balancer', label: 'Load balancer' }],
        disconnect: [['users', 'a']],
        connect: [
          ['users', 'lb'],
          ['lb', 'a'],
          ['lb', 'b'],
        ],
      },
    },
    {
      id: '2-2',
      chapter: 'ch2',
      type: 'kill-switch',
      title: 'Lose a box, keep the shop',
      story: 'Box A crashes ten seconds into the evening rush. Box B is plugged into nothing.',
      task: 'Wire box B in so the shop stays up after A dies.',
      start: design('2-2', pair(30), [
        ['users', 'lb'],
        ['lb', 'a'],
        ['a', 'db'],
        ['b', 'db'],
      ]),
      parts: [],
      budget: 400,
      clears: ['lb-without-backends'],
      gates: [
        {
          id: 'after',
          label: 'Box A dies at 10 s · shop still up at the end',
          rps: 30,
          horizonS: 60,
          kill: { key: 'a', atS: 10 },
          window: 'end',
          maxLostPct: 1,
        },
      ],
      hints: {
        question: 'Where can the load balancer send traffic when A is gone?',
        concept: 'The balancer checks its boxes every few seconds. When one stops answering, it sends everything to the ones still alive.',
      },
      lesson: 'Two of something only becomes backup when a health check can move the traffic.',
      solution: { connect: [['lb', 'b']] },
    },
    {
      id: '2-3',
      chapter: 'ch2',
      type: 'tune-dial',
      title: 'Notice faster',
      story: 'The shop survives a crash, but shoppers see errors for half a minute first.',
      task: 'Make the balancer check its boxes more often.',
      start: design('2-3', pair(30, { healthCheckS: 30 }), pairWired),
      parts: [],
      dials: [{ key: 'lb', attr: 'healthCheckS', label: 'Check every', unit: 's', min: 1, max: 30, step: 1 }],
      budget: 400,
      gates: [
        {
          id: 'minute',
          label: 'Box A dies · at most 5% lost in the next minute',
          rps: 30,
          horizonS: 70,
          kill: { key: 'a', atS: 10 },
          window: 'after-kill',
          maxLostPct: 5,
        },
      ],
      hints: {
        question: 'For how long does the balancer keep sending traffic to a dead box?',
        concept: 'Until the next health check, half the requests still go to the dead box and are lost. A shorter check means fewer lost requests.',
      },
      lesson: 'Backup is only as fast as the check that notices the failure.',
      solution: { set: [{ key: 'lb', attrs: { healthCheckS: 5 } }] },
    },
    {
      id: '2-4',
      chapter: 'ch2',
      type: 'find-bottleneck',
      title: 'The next wall',
      story: 'Two boxes carry the evening. Next month, the shop expects 120 requests a second.',
      task: 'Click the part you think fails first, then run it.',
      start: design('2-4', pair(120), pairWired),
      parts: [],
      predict: true,
      observe: true,
      budget: 500,
      gates: [{ id: 'next', label: '120 req/s', rps: 120, maxLostPct: 1 }],
      hints: {
        question: 'Two boxes of 2 vCPU each: how many pages a second is that together?',
        concept: 'Each box does about 40 pages a second at 400 ms a page. Two boxes do about 80. The database has plenty of room.',
      },
      lesson: 'More boxes behind a balancer is how apps grow. Next, the database becomes the wall.',
      solution: {},
    },
    {
      id: '2-5',
      chapter: 'ch2',
      type: 'checkpoint',
      title: 'Deploy at lunch',
      story: 'You ship fixes at lunch, one box at a time. Shoppers should never notice.',
      task: 'Wire in both boxes, tune the health check, and stay under budget.',
      start: design('2-5', pair(35, { healthCheckS: 30 }), [
        ['users', 'a'],
        ['a', 'db'],
        ['b', 'db'],
      ]),
      parts: [],
      dials: [{ key: 'lb', attr: 'healthCheckS', label: 'Check every', unit: 's', min: 1, max: 30, step: 1 }],
      budget: 400,
      clears: ['lb-without-backends'],
      gates: [
        { id: 'deploy-a', label: 'Restart box A at lunch · at most 3% lost', rps: 35, horizonS: 60, kill: { key: 'a', atS: 10, forS: 20 }, maxLostPct: 3 },
        { id: 'deploy-b', label: 'Restart box B at lunch · at most 3% lost', rps: 35, horizonS: 60, kill: { key: 'b', atS: 10, forS: 20 }, maxLostPct: 3 },
        { id: 'peak', label: 'Evening peak · 70 req/s · at most 1% lost', rps: 70, maxLostPct: 1 },
      ],
      hints: {
        question: 'During a restart, how much traffic can one box carry alone?',
        concept: 'A rolling deploy restarts one box while the other carries everything. It only works if one box can hold the load, and the balancer notices quickly.',
      },
      lesson: 'Two of something is not backup until a health check moves the traffic. Test it with a deploy, not a disaster.',
      solution: {
        disconnect: [['users', 'a']],
        connect: [
          ['users', 'lb'],
          ['lb', 'a'],
          ['lb', 'b'],
        ],
        set: [{ key: 'lb', attrs: { healthCheckS: 2 } }],
      },
    },
  ],
};

export const COURSE: Chapter[] = [prologue, chapter1, chapter2];

export const STEP_BY_ID: Record<string, Step> = Object.fromEntries(COURSE.flatMap((c) => c.steps.map((s) => [s.id, s])));
