// "Start here": the beginner ladder. One idea per sheet, a handful of boxes, small
// round numbers, and nothing a newcomer has to look up — every technical word on
// the sheet is in its glossary. Each topic is a Basics sheet and a Step up that
// adds one pressure the Basics answer cannot take, then hands on to the full
// problem on the same topic. ladder.test.ts holds the answer key and proves both.

import type { Problem, ProblemDiagram } from '@loadbearing/shared';
import { COL, diagram, ROW } from './diagrams.js';

const SERVICES = ['service', 'monolith', 'serverless_fn'] as const;

/** A Step up starts from the Basics answer, drawn, so the learner builds on it. */
function leftYou(graph: Omit<ProblemDiagram, 'caption' | 'name'>): ProblemDiagram {
  return diagram('Where the Basics sheet left you', graph);
}

const RPS = { term: 'requests per second (rps)', meaning: 'how many times each second someone asks your system to do something.' };
const APP_SERVER = { term: 'app server', meaning: 'the program that runs your code and answers requests from the app or website.' };
const DATABASE = { term: 'database', meaning: 'where your data is kept in an organised, searchable way, so it survives restarts.' };

export const STARTER_SHEETS: Problem[] = [
  // ------------------------------------------------------------ photo upload ----
  {
    id: 'l1-start-photo-upload-basics',
    title: 'Photo Upload: Basics',
    level: 1,
    domain: 'social',
    track: { topic: 'photo-upload', stage: 'basics', next: 'l1-start-photo-upload-step-up' },
    learn: "Photos belong in object storage, not on the app server's disk or in a database.",
    prompt:
      "You are building a small photo-sharing app. People pick a photo on their phone and upload it, and later they and their friends look at it. At the busiest time of day about 20 photos are uploaded and 100 are viewed every second, and each photo is about 3MB. The first idea was to save photos on the app server's own disk, but that disk fills up and is wiped if the server is replaced. Design where the photos go, and how they get there and back.",
    functional: [
      'Upload a photo and get back an id for it',
      'Show a photo by its id',
      'Keep every photo safe even if an app server is replaced',
    ],
    nonFunctional: { uploadRps: 20, viewRps: 100, photoSize: '3MB each' },
    constraints: ['One developer, so keep it to a handful of boxes'],
    concepts: ['blob-storage', 'capacity-estimation'],
    expectedFlows: ['upload a photo', 'view a photo'],
    flowPlans: [
      { name: 'upload a photo', kind: 'write', rps: 20, plain: 'A user picks a photo and sends it to your app, which stores it.', mustReach: [['blob_store']] },
      { name: 'view a photo', kind: 'read', rps: 100, plain: 'Someone opens the app and a stored photo is fetched and shown.', mustReach: [['blob_store']] },
    ],
    hints: [
      {
        text: "Where should the photo files live? Not on the app server's disk — it can be wiped. Look for a storage box made for files.",
        ghost: { type: 'blob_store', label: 'Photo storage', annotation: 'object storage, one file per photo id' },
      },
      {
        text: 'Who receives the upload from the phone? Draw the user, then the app server they talk to, with an arrow from the user to it.',
        ghost: { type: 'service', label: 'App server', annotation: 'receives uploads and saves them to photo storage' },
      },
      { text: 'Connect the app server to the photo storage with an arrow, so it can save and fetch photos.' },
      { text: 'Open the Flows tab: both requests should now show a path. Press "Use this" on each, then run load.' },
    ],
    glossary: [
      { term: 'object storage', meaning: 'a service built to keep files cheaply and safely, like a giant hard drive you reach over the internet (for example Amazon S3).' },
      APP_SERVER,
      RPS,
    ],
    rubricHints:
      'This sheet teaches one idea: photo files go to object storage (blob store), not the app server disk and not a database column. Reward a design with a client, an app server and a blob store wired together. Treat photos stored in a SQL database or on local disk as the one real mistake, and explain why in plain words.',
    twists: ['A photo goes viral and is viewed 1,500 times a second — that is the Step up sheet.'],
    scenarios: [
      {
        id: 'busy-evening',
        name: 'Busy evening',
        description: 'Everyone uploads and scrolls after dinner: twice the usual traffic.',
        rpsMultiplier: 2,
        passCriteria: 'Uploads and views keep working with almost nothing dropped.',
      },
    ],
  },
  {
    id: 'l1-start-photo-upload-step-up',
    title: 'Photo Upload: Step Up',
    level: 1,
    domain: 'social',
    track: { topic: 'photo-upload', stage: 'step-up', next: 'l1-image-upload-service' },
    learn: 'Serve popular files from a CDN, and do slow work like making thumbnails in the background.',
    prompt:
      'Your photo app is growing: photos are now viewed 1,500 times a second, and one app server can only answer about 500 requests a second. About 9 in 10 views are of photos someone looked at in the last hour. Every upload also needs a small thumbnail, which takes a second or two to make, and nobody should wait for it. Keep uploads quick, keep viewing fast for everyone, and make the thumbnails without slowing anyone down.',
    functional: [
      'Upload a photo quickly',
      'Make a thumbnail for every upload without making the user wait',
      'Show photos fast, even very popular ones',
    ],
    nonFunctional: { uploadRps: 40, viewRps: 1500, repeatViews: 'about 90%', thumbnailTime: '1-2 seconds each' },
    constraints: ['Still a small team: add only what the numbers need'],
    concepts: ['cdn', 'queue-backpressure', 'blob-storage'],
    expectedFlows: ['upload a photo', 'view a photo', 'make a thumbnail'],
    flowPlans: [
      { name: 'upload a photo', kind: 'write', rps: 40, plain: 'A user sends a photo; your app server stores it.', mustReach: [[...SERVICES], ['blob_store']] },
      { name: 'view a photo', kind: 'read', rps: 1500, plain: 'Someone looks at a photo; popular ones are answered by the CDN.', mustReach: [['cdn'], ['blob_store']] },
      { name: 'make a thumbnail', kind: 'async', rps: 40, plain: 'After an upload, a background worker makes a small version of the photo.', mustReach: [['queue'], ['worker']] },
    ],
    hints: [
      {
        text: '1,500 views a second is three times what one app server can answer. Most views are of the same photos — what could keep a copy of them close to users?',
        ghost: { type: 'cdn', label: 'CDN', annotation: 'keeps copies of popular photos close to users' },
      },
      { text: 'Put the CDN between the user and your app server: draw User → CDN → App server. Then select the CDN and set its hit rate to 90% in the Inspector — 9 in 10 views are answered by the CDN and never reach your server.' },
      {
        text: 'Making a thumbnail takes a second or two. Instead of making it while the user waits, the app server can drop a note in a queue and answer straight away.',
        ghost: { type: 'queue', label: 'Resize queue', annotation: 'one message per uploaded photo' },
      },
      {
        text: 'A worker takes notes off the queue and makes the thumbnails. Connect App server → queue with an async arrow, then queue → worker → photo storage.',
        ghost: { type: 'worker', label: 'Resizer', annotation: 'makes a thumbnail for each message' },
      },
    ],
    glossary: [
      { term: 'CDN', meaning: 'content delivery network: computers around the world that keep copies of your files, so users get them from somewhere close and fast.' },
      { term: 'queue', meaning: 'a waiting line for jobs: one part of the system adds a job, another part picks it up later.' },
      { term: 'worker', meaning: 'a program that does background jobs from a queue, so users do not wait for them.' },
      { term: 'async', meaning: 'short for asynchronous: "start it now, finish it later" — the caller does not wait for the result.' },
      { term: 'hit rate', meaning: 'the share of requests a cache or CDN answers by itself, e.g. 90% means 9 in 10.' },
    ],
    rubricHints:
      'This sheet teaches two ideas: popular files are served from a CDN in front of the app, and slow work (thumbnails) goes on a queue for a worker instead of the upload request. Reward a CDN in front of the app server and a queue plus worker for thumbnails. Flag thumbnails made inside the upload request, and 1,500 views a second sent straight to one app server.',
    twists: ['Moderation lands: no photo may be shown until an automatic check has passed it.'],
    scenarios: [
      {
        id: 'viral-photo',
        name: 'A photo goes viral',
        description: 'A celebrity shares a photo and views climb 20% above the usual peak.',
        rpsMultiplier: 1.2,
        passCriteria: 'Views and uploads keep working with almost nothing dropped.',
      },
    ],
    diagram: leftYou({
      nodes: [
        { key: 'u', type: 'client', label: 'User', annotation: 'phone app', at: { x: 0, y: 0 } },
        { key: 'app', type: 'service', label: 'App server', annotation: 'receives uploads, serves photos', at: { x: COL, y: 0 } },
        { key: 'store', type: 'blob_store', label: 'Photo storage', annotation: 'object storage, one file per photo id', at: { x: COL * 2, y: 0 } },
      ],
      edges: [
        { from: 'u', to: 'app', kind: 'sync' },
        { from: 'app', to: 'store', kind: 'sync' },
      ],
      flows: [],
    }),
  },

  // ----------------------------------------------------------------- AI chat ----
  {
    id: 'l1-start-ai-chat-basics',
    title: 'AI Chat: Basics',
    level: 1,
    domain: 'ai-platform',
    track: { topic: 'ai-chat', stage: 'basics', next: 'l1-start-ai-chat-step-up' },
    learn: 'A chat app is an app server calling an LLM, and the LLM is the slow, expensive part.',
    prompt:
      'You are adding a help chat to a website: a user types a question and an AI model writes the answer. At the busiest time about 6 questions arrive every second. The AI model (an LLM) takes a few seconds to answer, can only work on about 20 questions a second, and charges you for every one. You also want to keep each conversation so a user can come back to it. Design how a question travels to the model and back.',
    functional: [
      'A user sends a question and gets an AI-written answer',
      'Each conversation is saved so the user can come back to it',
    ],
    nonFunctional: { questionRps: 6, llmLimit: 'about 20 questions a second', answerTime: 'a few seconds' },
    constraints: ['Pay only for the model calls you need'],
    concepts: ['llm-cost-control', 'capacity-estimation'],
    expectedFlows: ['send a chat message'],
    flowPlans: [
      { name: 'send a chat message', kind: 'write', rps: 6, plain: 'A user asks a question; your app server asks the LLM and returns the answer.', mustReach: [['llm']] },
    ],
    hints: [
      {
        text: 'The user should never talk to the AI model directly — your secret key would be exposed. Who sits in between?',
        ghost: { type: 'service', label: 'App server', annotation: 'holds the model key, calls the LLM' },
      },
      {
        text: 'Add the model itself and connect the app server to it.',
        ghost: { type: 'llm', label: 'LLM', annotation: 'writes the answer; slow and paid per call' },
      },
      {
        text: 'Where does the conversation history live, so it survives a restart? Connect a database to the app server.',
        ghost: { type: 'sql_db', label: 'Chat history', annotation: 'one row per message' },
      },
      { text: 'Check the numbers: 6 questions a second, the model handles about 20. Run load at 2× and see if it still fits.' },
    ],
    glossary: [
      { term: 'LLM', meaning: 'large language model: the AI that reads text and writes an answer (for example Claude or GPT).' },
      APP_SERVER,
      DATABASE,
    ],
    rubricHints:
      'This sheet teaches one idea: the client talks to an app server, which calls the LLM, and the LLM is slow, limited and paid per call. Reward client → app server → LLM with conversation history in a database. Flag a client calling the LLM directly (it leaks the API key) as the one real mistake.',
    twists: ['A launch brings 50 questions a second, many of them the same — that is the Step up sheet.'],
    scenarios: [
      {
        id: 'lunch-rush',
        name: 'Lunch rush',
        description: 'Twice the usual number of questions arrive over lunch.',
        rpsMultiplier: 2,
        passCriteria: 'Every question still gets an answer.',
      },
    ],
  },
  {
    id: 'l1-start-ai-chat-step-up',
    title: 'AI Chat: Step Up',
    level: 1,
    domain: 'ai-platform',
    track: { topic: 'ai-chat', stage: 'step-up', next: 'l6-llm-gateway-cost-latency' },
    learn: 'When the same questions repeat, cache the answers so the LLM is only asked once, and cap how fast anyone can ask.',
    prompt:
      'Your help chat launched and now gets 50 questions a second, but the AI model can only handle about 20 a second. Looking at the logs, about 8 in 10 questions are ones the model has already answered, like "how do I reset my password". One user also wrote a script that asks hundreds of questions a minute. Keep every user answered without asking the model more than it can take.',
    functional: [
      'Answer every question, even at 50 a second',
      'Do not pay the model twice for the same question',
      'Stop one user from flooding the system',
    ],
    nonFunctional: { questionRps: 50, llmLimit: 'about 20 questions a second', repeatedQuestions: 'about 80%' },
    constraints: ['The model budget stays the same as before the launch'],
    concepts: ['caching', 'llm-cost-control', 'rate-limiting'],
    expectedFlows: ['send a chat message'],
    flowPlans: [
      { name: 'send a chat message', kind: 'write', rps: 50, plain: 'A user asks a question; a repeated one is answered from the cache, a new one goes to the LLM.', mustReach: [['llm']] },
    ],
    hints: [
      {
        text: '50 questions a second, but the model takes about 20. If 8 in 10 are repeats, what could remember answers it has already given?',
        ghost: { type: 'prompt_cache', label: 'Answer cache', annotation: 'same question → stored answer' },
      },
      { text: 'Put the cache between the app server and the LLM: App server → Answer cache → LLM. Only questions it has not seen reach the model.' },
      {
        text: 'Someone is scripting hundreds of questions a minute. What sits at the front door and says "slow down"?',
        ghost: { type: 'rate_limiter', label: 'Rate limiter', annotation: 'at most 10 questions a minute per user' },
      },
      { text: 'Do the sum: with 80% answered from the cache, how many questions a second reach the model? Run load to check.' },
    ],
    glossary: [
      { term: 'cache', meaning: 'a fast memory of answers you already worked out, so you do not have to work them out again.' },
      { term: 'rate limiter', meaning: 'a gatekeeper that lets each user make only so many requests in a time window.' },
      { term: 'hit rate', meaning: 'the share of requests the cache can answer by itself, e.g. 80% means 8 in 10.' },
    ],
    rubricHints:
      'This sheet teaches caching repeated LLM answers and rate limiting per user. Reward a cache placed between the app server and the LLM (so misses go to the model) and a rate limiter at the front. Flag a design where all 50 questions a second reach a model that handles 20, and explain the sum.',
    twists: ['Answers must now be personalised with the user\'s account details, so identical questions no longer have identical answers.'],
    scenarios: [
      {
        id: 'launch-day',
        name: 'Launch day',
        description: '50 questions a second arrive, most of them repeats.',
        rpsMultiplier: 1,
        passCriteria: 'Every question is answered; the model is not asked more than it can handle.',
      },
      {
        id: 'twice-as-busy',
        name: 'Busier than planned',
        description: 'Traffic comes in 50% above the launch estimate.',
        rpsMultiplier: 1.5,
        passCriteria: 'Every question is still answered.',
      },
    ],
    diagram: leftYou({
      nodes: [
        { key: 'u', type: 'client', label: 'User', annotation: 'website chat box', at: { x: 0, y: 0 } },
        { key: 'app', type: 'service', label: 'App server', annotation: 'holds the model key, calls the LLM', at: { x: COL, y: 0 } },
        { key: 'llm', type: 'llm', label: 'LLM', annotation: 'about 20 questions a second', at: { x: COL * 2, y: 0 } },
        { key: 'db', type: 'sql_db', label: 'Chat history', annotation: 'one row per message', at: { x: COL, y: ROW } },
      ],
      edges: [
        { from: 'u', to: 'app', kind: 'sync' },
        { from: 'app', to: 'llm', kind: 'sync' },
        { from: 'app', to: 'db', kind: 'sync' },
      ],
      flows: [],
    }),
  },

  // ------------------------------------------------------------ product page ----
  {
    id: 'l1-start-product-page-basics',
    title: 'Product Page: Basics',
    level: 1,
    domain: 'e-commerce',
    track: { topic: 'product-page', stage: 'basics', next: 'l1-start-product-page-step-up' },
    learn: 'A product page is read from a database through an app server, and reads far outnumber writes.',
    prompt:
      'You run a small online shop with 5,000 products. Shoppers open product pages about 200 times a second at the busiest time, while the shop team changes a price about 5 times a second. Every page shows the name, picture link, price and whether it is in stock. Design where the product information lives and how a page gets it.',
    functional: [
      'Show a product page with name, price and stock',
      'Let the shop team change a price',
      'A changed price shows up on the page',
    ],
    nonFunctional: { viewRps: 200, priceChangeRps: 5, products: '5,000' },
    constraints: ['One developer and a small budget'],
    concepts: ['schema-design', 'capacity-estimation'],
    expectedFlows: ['view a product', 'change a price'],
    flowPlans: [
      { name: 'view a product', kind: 'read', rps: 200, plain: 'A shopper opens a product page; the app server reads it from the database.', mustReach: [['sql_db']] },
      { name: 'change a price', kind: 'write', rps: 5, plain: 'Someone on the shop team saves a new price.', mustReach: [['sql_db']] },
    ],
    hints: [
      {
        text: 'Product details need to be kept somewhere safe and easy to look up. Which box keeps organised data?',
        ghost: { type: 'sql_db', label: 'Products DB', annotation: 'one row per product: name, price, stock' },
      },
      {
        text: 'Shoppers do not talk to the database directly. Add the app server they talk to.',
        ghost: { type: 'service', label: 'App server', annotation: 'builds the product page from the database' },
      },
      { text: 'Draw User → App server → Products DB. Both requests use that same path.' },
      { text: 'Notice the numbers: 200 reads for every 5 writes. Remember that — it is what the Step up is about.' },
    ],
    glossary: [DATABASE, APP_SERVER, { term: 'read / write', meaning: 'a read looks at data without changing it; a write changes it.' }],
    rubricHints:
      'This sheet teaches one idea: product data lives in a database behind an app server, and the workload is read-heavy (40 reads per write). Reward client → app server → SQL database with both flows. A good answer notices the read/write ratio. Do not ask for caching here; that is the next sheet.',
    twists: ['A sale brings 2,400 page views a second — that is the Step up sheet.'],
    scenarios: [
      {
        id: 'sale-day',
        name: 'Sale day',
        description: 'A small sale doubles the number of shoppers.',
        rpsMultiplier: 2,
        passCriteria: 'Product pages and price changes keep working.',
      },
    ],
  },
  {
    id: 'l1-start-product-page-step-up',
    title: 'Product Page: Step Up',
    level: 1,
    domain: 'e-commerce',
    track: { topic: 'product-page', stage: 'step-up', next: 'l1-read-heavy-product-api' },
    learn: 'Put a cache in front of the database for reads, and run several app servers behind a load balancer.',
    prompt:
      'Your shop is popular: product pages are now opened 2,400 times a second, and a big sale next month will add half again. The database can answer about 3,000 reads a second, and one app server about 500 requests a second. Most shoppers look at the same few hundred products. Keep pages fast during the sale, and make sure a changed price still shows up within a minute.',
    functional: [
      'Show product pages fast, even during the sale',
      'A changed price shows up within a minute',
      'Keep working if traffic is 50% above the estimate',
    ],
    nonFunctional: { viewRps: 2400, priceChangeRps: 10, databaseLimit: 'about 3,000 reads a second' },
    constraints: ['No new kind of database — keep the one you have'],
    concepts: ['caching', 'load-balancing', 'capacity-estimation'],
    expectedFlows: ['view a product', 'change a price'],
    flowPlans: [
      { name: 'view a product', kind: 'read', rps: 2400, plain: 'A shopper opens a page; popular products come from the cache.', mustReach: [['cache'], ['sql_db']] },
      { name: 'change a price', kind: 'write', rps: 10, plain: 'The shop team saves a new price; the cached copy must be refreshed.', mustReach: [['sql_db']] },
    ],
    hints: [
      {
        text: 'At 3,600 reads a second during the sale, the database (about 3,000) would be overwhelmed. Most reads are for the same products — what could remember them?',
        ghost: { type: 'cache', label: 'Product cache', annotation: 'copy of each product for 60s; cleared on price change' },
      },
      { text: 'Put the cache between the app server and the database: App server → Product cache → Products DB. Only cache misses reach the database.' },
      {
        text: 'One app server answers about 500 requests a second. How many do you need for 3,600? Put a load balancer in front and set the app server\'s instance count in the Inspector.',
        ghost: { type: 'load_balancer', label: 'Load balancer', annotation: 'spreads shoppers across app servers' },
      },
      { text: 'A stale price is a real problem. Write on the cache box how long it keeps a copy (for example 60 seconds) and that a price change clears it.' },
    ],
    glossary: [
      { term: 'cache', meaning: 'a fast copy of data kept close by, so you do not ask the database every time.' },
      { term: 'load balancer', meaning: 'a traffic director that spreads incoming requests across several servers.' },
      { term: 'TTL', meaning: 'time to live: how long a cached copy is kept before it is thrown away and fetched again.' },
      { term: 'instances', meaning: 'identical copies of the same server running side by side to share the work.' },
    ],
    rubricHints:
      'This sheet teaches a read cache in front of the database (cache-aside or read-through, with a TTL and invalidation on price change) and scaling app servers behind a load balancer. Reward the cache on the read path with a stated TTL and invalidation story, and enough app server instances for 3,600 rps. Flag a cache with no expiry or invalidation (stale prices forever).',
    twists: ['Legal now needs a corrected price visible everywhere within 5 seconds, not 60.'],
    scenarios: [
      {
        id: 'big-sale',
        name: 'The big sale',
        description: 'Shoppers arrive at 1.5× the usual peak for the whole afternoon.',
        rpsMultiplier: 1.5,
        passCriteria: 'Pages keep loading with almost nothing dropped; the database is not overwhelmed.',
      },
    ],
    diagram: leftYou({
      nodes: [
        { key: 'u', type: 'client', label: 'User', annotation: 'shopper\'s browser', at: { x: 0, y: 0 } },
        { key: 'app', type: 'service', label: 'App server', annotation: 'builds the product page', at: { x: COL, y: 0 } },
        { key: 'db', type: 'sql_db', label: 'Products DB', annotation: 'one row per product', at: { x: COL * 2, y: 0 } },
      ],
      edges: [
        { from: 'u', to: 'app', kind: 'sync' },
        { from: 'app', to: 'db', kind: 'sync' },
      ],
      flows: [],
    }),
  },

  // ---------------------------------------------------------------- stay up ----
  {
    id: 'l1-start-stay-up-basics',
    title: "Don't Fall Over: Basics",
    level: 1,
    domain: 'e-commerce',
    track: { topic: 'stay-up', stage: 'basics', next: 'l1-start-stay-up-step-up' },
    learn: 'Run two of everything that matters: two app servers behind a load balancer.',
    prompt:
      'Your shop runs on one app server, which answers about 500 requests a second. Shoppers send about 300 a second normally and twice that at rush hour. Last week the server crashed and the whole shop was down for an hour. Design the shop so that one server dying, or a rush hour, does not take it down.',
    functional: [
      'Shoppers can browse the shop',
      'The shop keeps working if one app server dies',
      'The shop keeps working at rush hour',
    ],
    nonFunctional: { viewRps: 300, rushHour: '2× normal', serverLimit: 'about 500 requests a second each' },
    constraints: ['Keep the one database you have'],
    concepts: ['load-balancing', 'spof'],
    expectedFlows: ['view the shop'],
    flowPlans: [
      { name: 'view the shop', kind: 'read', rps: 300, plain: 'A shopper browses; the load balancer picks one of your app servers.', mustReach: [['sql_db']] },
    ],
    hints: [
      { text: 'One server is a single point of failure: if it dies, everything dies. How many do you need so one can die?' },
      {
        text: 'With two servers, something has to decide which one each shopper goes to.',
        ghost: { type: 'load_balancer', label: 'Load balancer', annotation: 'sends each request to a healthy server' },
      },
      { text: 'Draw User → Load balancer, then Load balancer → App server A and Load balancer → App server B, and both servers → Shop DB.' },
      { text: 'Rush hour is 600 requests a second. Can one server take that? Can two?' },
    ],
    glossary: [
      { term: 'single point of failure', meaning: 'one part that takes the whole system down when it breaks.' },
      { term: 'load balancer', meaning: 'a traffic director that spreads incoming requests across several servers and skips broken ones.' },
      APP_SERVER,
    ],
    rubricHints:
      'This sheet teaches one idea: remove the single point of failure in the app tier with two app servers behind a load balancer. Reward two app servers behind a load balancer, both connected to the database. Point out (gently, once) that the database is still a single point of failure — that is the Step up.',
    twists: ['The database server dies — that is the Step up sheet.'],
    scenarios: [
      {
        id: 'rush-hour',
        name: 'Rush hour',
        description: 'Twice the usual number of shoppers arrive at once.',
        rpsMultiplier: 2,
        passCriteria: 'The shop keeps answering with almost nothing dropped.',
      },
    ],
  },
  {
    id: 'l1-start-stay-up-step-up',
    title: "Don't Fall Over: Step Up",
    level: 1,
    domain: 'e-commerce',
    track: { topic: 'stay-up', stage: 'step-up', next: 'l2-autoscaled-campaign-tier' },
    learn: 'Keep a live copy of the database ready, so the shop keeps working when the main one fails.',
    prompt:
      'Your two app servers mean one can die without anyone noticing. But last night the database server failed, and with nothing to fall back on the whole shop was down until it was repaired. Shoppers send about 300 requests a second. Design the data side so that losing the main database does not take the shop down.',
    functional: [
      'Shoppers can browse even if the main database fails',
      'No product data is lost when the main database fails',
    ],
    nonFunctional: { viewRps: 300, recoveryGoal: 'browsing keeps working within seconds' },
    constraints: ['Use the same database product; just run more copies of it'],
    concepts: ['replication', 'spof'],
    expectedFlows: ['view the shop'],
    flowPlans: [
      { name: 'view the shop', kind: 'read', rps: 300, plain: 'A shopper browses; reads come from the main database or its copy.', mustReach: [['sql_db', 'read_replica']] },
    ],
    hints: [
      { text: 'The database is now the single point of failure. What if a second database always had a fresh copy of the data?' },
      {
        text: 'Add a copy of the database and connect the main one to it with a replication arrow, so every change is copied over.',
        ghost: { type: 'read_replica', label: 'Shop DB replica', annotation: 'live copy of Shop DB, takes reads' },
      },
      { text: 'Connect both app servers to the replica too, so they can read from it when the main database is gone.' },
      { text: 'Run the "Database lost" test: browsing should keep working.' },
    ],
    glossary: [
      { term: 'replica', meaning: 'a live copy of a database that is kept up to date automatically.' },
      { term: 'replication', meaning: 'copying every change from the main database to its replicas as it happens.' },
      { term: 'failover', meaning: 'switching to a backup when the main thing fails.' },
    ],
    rubricHints:
      'This sheet teaches one idea: remove the database single point of failure with a replica kept up to date by replication, which can serve reads (and be promoted) when the primary fails. Reward a replica connected by replication and reachable from the app servers. Mention, in plain words, that a replica is slightly behind the primary.',
    twists: ['Writes (orders) must also keep working when the main database fails, not only browsing.'],
    scenarios: [
      {
        id: 'database-lost',
        name: 'Database lost',
        description: 'The main database server fails during normal traffic.',
        rpsMultiplier: 1,
        killNodes: ['sql_db'],
        passCriteria: 'Shoppers can still browse; nothing is left broken.',
      },
    ],
    diagram: leftYou({
      nodes: [
        { key: 'u', type: 'client', label: 'User', annotation: 'shopper\'s browser', at: { x: 0, y: ROW / 2 } },
        { key: 'lb', type: 'load_balancer', label: 'Load balancer', annotation: '', at: { x: COL, y: ROW / 2 } },
        { key: 'a', type: 'service', label: 'App server A', annotation: 'shop app', at: { x: COL * 2, y: 0 } },
        { key: 'b', type: 'service', label: 'App server B', annotation: 'shop app', at: { x: COL * 2, y: ROW } },
        { key: 'db', type: 'sql_db', label: 'Shop DB', annotation: 'the only database', at: { x: COL * 3, y: ROW / 2 } },
      ],
      edges: [
        { from: 'u', to: 'lb', kind: 'sync' },
        { from: 'lb', to: 'a', kind: 'sync' },
        { from: 'lb', to: 'b', kind: 'sync' },
        { from: 'a', to: 'db', kind: 'sync' },
        { from: 'b', to: 'db', kind: 'sync' },
      ],
      flows: [],
    }),
  },

  // --------------------------------------------------------- background work ----
  {
    id: 'l1-start-background-work-basics',
    title: "Don't Make Users Wait: Basics",
    level: 1,
    domain: 'identity',
    track: { topic: 'background-work', stage: 'basics', next: 'l1-start-background-work-step-up' },
    learn: 'Do slow side jobs, like sending email, in the background with a queue and a worker.',
    prompt:
      'When someone signs up for your app, you save their account and send them a welcome email. About 30 people sign up every second at the busiest time. The email service usually answers in under a second, but sometimes takes several seconds, and right now the sign-up page just spins until it does. Design sign-up so it is always fast, and the welcome email still goes out.',
    functional: [
      'Create the account and confirm sign-up straight away',
      'Send every new user a welcome email',
    ],
    nonFunctional: { signupRps: 30, emailServiceTime: 'usually under 1s, sometimes several seconds' },
    constraints: ['Use the email service you already pay for'],
    concepts: ['queue-backpressure', 'timeout-retry'],
    expectedFlows: ['sign up', 'send the welcome email'],
    flowPlans: [
      { name: 'sign up', kind: 'write', rps: 30, plain: 'A new user signs up; the account is saved and they are told straight away.', mustReach: [['sql_db']] },
      { name: 'send the welcome email', kind: 'async', rps: 30, plain: 'In the background, a worker sends the welcome email.', mustReach: [['queue'], ['worker']] },
    ],
    hints: [
      { text: 'The user is waiting for the email service, but they do not need the email to finish signing up. Could the email happen afterwards?' },
      {
        text: 'A queue lets the app server say "send this later" and answer the user at once. Connect App server → queue with an async arrow.',
        ghost: { type: 'queue', label: 'Email queue', annotation: 'one message per new user' },
      },
      {
        text: 'Something has to take messages off the queue and actually send the email.',
        ghost: { type: 'worker', label: 'Email worker', annotation: 'sends one welcome email per message' },
      },
      { text: 'Connect Email worker → Email service. Then run the "Slow email" test: sign-up should stay fast.' },
    ],
    glossary: [
      { term: 'queue', meaning: 'a waiting line for jobs: one part adds a job, another picks it up later.' },
      { term: 'worker', meaning: 'a program that does background jobs from a queue.' },
      { term: 'async', meaning: '"start it now, finish it later" — the caller does not wait for the result.' },
      { term: 'p99', meaning: 'the time within which 99 out of 100 requests finish; the slow tail users notice.' },
    ],
    rubricHints:
      'This sheet teaches one idea: move slow, non-essential work (the welcome email) off the request path with a queue and a worker. Reward sign-up writing to the database synchronously and handing the email to a queue consumed by a worker. Flag the app server calling the email service synchronously as the one real mistake.',
    twists: ['Sign-ups jump to 200 a second at launch, and the email service starts failing — that is the Step up sheet.'],
    scenarios: [
      {
        id: 'slow-email',
        name: 'Slow email service',
        description: 'The email service takes 3 extra seconds to answer.',
        rpsMultiplier: 1,
        thirdPartyLatencyMs: 3000,
        passCriteria: 'Sign-up stays fast (p99 under 400ms) even while email is slow.',
        pass: { maxP99Ms: 400 },
      },
    ],
  },
  {
    id: 'l1-start-background-work-step-up',
    title: "Don't Make Users Wait: Step Up",
    level: 1,
    domain: 'identity',
    track: { topic: 'background-work', stage: 'step-up', next: 'l1-signup-email-verification' },
    learn: 'When background work piles up, add workers; when a job keeps failing, park it in a failed-jobs queue.',
    prompt:
      'Your app is launching and sign-ups jump to 200 a second, twice that in the first hour. One email worker can send about 300 emails a second, so the queue is starting to pile up. The email service also fails now and then, and some emails were lost. Keep sign-up fast, get every welcome email out, and make sure a failing email is retried instead of lost.',
    functional: [
      'Keep sign-up fast at launch traffic',
      'Every welcome email is eventually sent',
      'An email that keeps failing is kept for someone to look at, not lost',
    ],
    nonFunctional: { signupRps: 200, launchPeak: '2× for the first hour', workerLimit: 'about 300 emails a second each' },
    constraints: ['Keep the email service and the queue you already have'],
    concepts: ['timeout-retry', 'queue-backpressure', 'degradation'],
    expectedFlows: ['sign up', 'send the welcome email'],
    flowPlans: [
      { name: 'sign up', kind: 'write', rps: 200, plain: 'A new user signs up and is told straight away.', mustReach: [['sql_db']] },
      { name: 'send the welcome email', kind: 'async', rps: 200, plain: 'Workers send the welcome emails, retrying ones that fail.', mustReach: [['queue'], ['worker']] },
    ],
    hints: [
      { text: '400 sign-ups a second at peak means 400 emails a second, but one worker sends about 300. How many workers do you need? Set the worker\'s instance count in the Inspector.' },
      { text: 'When the email service fails, the worker should try again after a short wait — and wait a bit longer each time. Write that on the worker box.' },
      {
        text: 'An email that fails five times in a row should not be retried forever. Where does it go?',
        ghost: { type: 'dead_letter_queue', label: 'Failed jobs', annotation: 'emails that failed 5 times, for a person to check' },
      },
      { text: 'Connect Email worker → Failed jobs with an async arrow, then run both tests.' },
    ],
    glossary: [
      { term: 'retry with backoff', meaning: 'trying a failed job again, waiting longer after each failure (1s, 2s, 4s…).' },
      { term: 'dead-letter queue', meaning: 'a separate queue for jobs that kept failing, so they are kept and can be looked at instead of lost.' },
      { term: 'instances', meaning: 'identical copies of the same worker running side by side to share the work.' },
    ],
    rubricHints:
      'This sheet teaches scaling queue consumers to match the arrival rate, retrying failed jobs with backoff, and a dead-letter queue for jobs that keep failing. Reward enough worker instances for 400 emails a second, a stated retry policy, and a DLQ. Flag infinite retries and silently dropped emails.',
    twists: ['Each user must get exactly one welcome email, even when a worker crashes halfway through sending.'],
    scenarios: [
      {
        id: 'launch-signups',
        name: 'Launch hour',
        description: 'Sign-ups run at twice the launch estimate for an hour.',
        rpsMultiplier: 2,
        passCriteria: 'Sign-up keeps working with almost nothing dropped.',
      },
      {
        id: 'email-down',
        name: 'Email service down',
        description: 'The email service stops answering entirely.',
        rpsMultiplier: 1,
        killNodes: ['email_provider'],
        passCriteria: 'Sign-up itself stays fast (p99 under 400ms) while emails wait.',
        pass: { maxP99Ms: 400 },
      },
    ],
    diagram: leftYou({
      nodes: [
        { key: 'u', type: 'client', label: 'User', annotation: 'sign-up page', at: { x: 0, y: 0 } },
        { key: 'app', type: 'service', label: 'App server', annotation: 'saves the account, queues the email', at: { x: COL, y: 0 } },
        { key: 'db', type: 'sql_db', label: 'Users DB', annotation: 'one row per user', at: { x: COL * 2, y: 0 } },
        { key: 'q', type: 'queue', label: 'Email queue', annotation: 'one message per new user', at: { x: COL, y: ROW } },
        { key: 'w', type: 'worker', label: 'Email worker', annotation: 'sends welcome emails', at: { x: COL * 2, y: ROW } },
        { key: 'em', type: 'email_provider', label: 'Email service', annotation: 'sometimes slow, sometimes down', at: { x: COL * 3, y: ROW } },
      ],
      edges: [
        { from: 'u', to: 'app', kind: 'sync' },
        { from: 'app', to: 'db', kind: 'sync' },
        { from: 'app', to: 'q', kind: 'async' },
        { from: 'q', to: 'w', kind: 'sync' },
        { from: 'w', to: 'em', kind: 'sync' },
      ],
      flows: [],
    }),
  },

  // ------------------------------------------------------------- short links ----
  {
    id: 'l1-start-short-links-basics',
    title: 'Short Links: Basics',
    level: 1,
    domain: 'devtools',
    track: { topic: 'short-links', stage: 'basics', next: 'l1-start-short-links-step-up' },
    learn: 'A short link is a tiny lookup: save a code once, then read it on every click.',
    prompt:
      'You are building a link shortener: someone pastes a long web address and gets back a short one like sho.rt/abc123. When anyone opens the short link, they are sent on to the long address. About 10 links are created and 150 are opened every second. Design where the links are kept and how opening one works.',
    functional: [
      'Create a short code for a long web address',
      'Opening a short link sends the visitor to the long address',
      'Two different long addresses never get the same code',
    ],
    nonFunctional: { createRps: 10, openRps: 150, linksPerYear: 'about 300 million' },
    constraints: ['One developer, one small server budget'],
    concepts: ['schema-design', 'capacity-estimation'],
    expectedFlows: ['make a short link', 'open a short link'],
    flowPlans: [
      { name: 'make a short link', kind: 'write', rps: 10, plain: 'Someone pastes a long address and gets a short code back.', mustReach: [['sql_db', 'nosql_db']] },
      { name: 'open a short link', kind: 'read', rps: 150, plain: 'A visitor clicks a short link and is sent to the long address.', mustReach: [['sql_db', 'nosql_db']] },
    ],
    hints: [
      {
        text: 'Every short code needs to remember its long address. Where is that pair kept?',
        ghost: { type: 'sql_db', label: 'Links DB', annotation: 'one row: code → long address' },
      },
      {
        text: 'Visitors talk to a server that looks up the code and sends them on.',
        ghost: { type: 'service', label: 'Link server', annotation: 'looks up the code, redirects' },
      },
      { text: 'Draw User → Link server → Links DB. Both requests use that path.' },
      { text: 'Write on the database box what makes a code unique, for example "code is the primary key".' },
    ],
    glossary: [
      { term: 'redirect', meaning: 'the server telling the browser "go to this other address instead".' },
      { term: 'primary key', meaning: 'the column that uniquely identifies each row, so no two rows can share it.' },
      DATABASE,
    ],
    rubricHints:
      'This sheet teaches one idea: a short link is a key-value lookup (code → long URL) stored once and read many times. Reward a link server in front of a database keyed by code, with uniqueness stated. A good answer notices reads outnumber writes 15 to 1. Do not ask for caching here; that is the next sheet.',
    twists: ['One link is shared by a celebrity and opened 2,000 times a second — that is the Step up sheet.'],
    scenarios: [
      {
        id: 'shared-on-social',
        name: 'Shared on social media',
        description: 'Clicks double for an afternoon.',
        rpsMultiplier: 2,
        passCriteria: 'Links keep opening with almost nothing dropped.',
      },
    ],
  },
  {
    id: 'l1-start-short-links-step-up',
    title: 'Short Links: Step Up',
    level: 1,
    domain: 'devtools',
    track: { topic: 'short-links', stage: 'step-up', next: 'l2-url-shortener-50k-rps' },
    learn: 'Serve hot links from a cache, and run several link servers behind a load balancer.',
    prompt:
      'Your link shortener took off: short links are opened 2,000 times a second, and a viral post can add half again. One link server answers about 500 requests a second, and the database about 3,000 reads a second. A handful of links get most of the clicks. Keep every click fast, even when one link goes viral.',
    functional: [
      'Open short links fast at 2,000 clicks a second',
      'Survive a viral link at 1.5× the usual peak',
      'Creating links keeps working',
    ],
    nonFunctional: { openRps: 2000, createRps: 20, serverLimit: 'about 500 requests a second each' },
    constraints: ['Keep the same database'],
    concepts: ['caching', 'load-balancing', 'capacity-estimation'],
    expectedFlows: ['open a short link', 'make a short link'],
    flowPlans: [
      { name: 'open a short link', kind: 'read', rps: 2000, plain: 'A visitor clicks a link; hot links come from the cache.', mustReach: [['cache'], ['sql_db', 'nosql_db']] },
      { name: 'make a short link', kind: 'write', rps: 20, plain: 'Someone creates a new short link.', mustReach: [['sql_db', 'nosql_db']] },
    ],
    hints: [
      { text: '2,000 clicks a second, and one link server answers about 500. How many link servers do you need at 3,000? Set the instance count in the Inspector.' },
      {
        text: 'Several link servers need something in front that spreads the clicks between them.',
        ghost: { type: 'load_balancer', label: 'Load balancer', annotation: 'spreads clicks across link servers' },
      },
      {
        text: 'A few links get most clicks. Keep those code → address pairs in fast memory so the database is asked less.',
        ghost: { type: 'cache', label: 'Link cache', annotation: 'code → address, kept for 1 hour' },
      },
      { text: 'Put the cache between the link server and the database: Link server → Link cache → Links DB.' },
    ],
    glossary: [
      { term: 'cache', meaning: 'fast memory of answers you already looked up, so you do not look them up again.' },
      { term: 'load balancer', meaning: 'a traffic director that spreads requests across several servers.' },
      { term: 'hot key', meaning: 'one item (here, one link) that gets far more requests than the rest.' },
    ],
    rubricHints:
      'This sheet teaches caching hot keys in front of the database and scaling stateless link servers behind a load balancer. Reward a cache on the redirect path and enough link server instances for 3,000 rps. Flag every click going to the database when a handful of links get most of the traffic.',
    twists: ['Every click must now be counted for the link owner, without slowing the redirect.'],
    scenarios: [
      {
        id: 'goes-viral',
        name: 'A link goes viral',
        description: 'A celebrity shares a link and clicks run 50% above the usual peak.',
        rpsMultiplier: 1.5,
        passCriteria: 'Links keep opening with almost nothing dropped; the database is not overwhelmed.',
      },
    ],
    diagram: leftYou({
      nodes: [
        { key: 'u', type: 'client', label: 'User', annotation: 'browser clicking a link', at: { x: 0, y: 0 } },
        { key: 'ls', type: 'service', label: 'Link server', annotation: 'looks up the code, redirects', at: { x: COL, y: 0 } },
        { key: 'db', type: 'sql_db', label: 'Links DB', annotation: 'code is the primary key', at: { x: COL * 2, y: 0 } },
      ],
      edges: [
        { from: 'u', to: 'ls', kind: 'sync' },
        { from: 'ls', to: 'db', kind: 'sync' },
      ],
      flows: [],
    }),
  },
];
