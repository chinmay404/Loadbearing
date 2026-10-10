// The request engine: one request at a time.
//
// The flow engine works in rates and answers in a few milliseconds, which is what
// makes it usable while drawing. What it cannot show is anything that depends on
// requests meeting each other — a burst inside one second, a queue that forms and
// drains, a dependency that is fine on average and terrible for one caller in a
// hundred. This engine follows each request through the parts it visits, on a
// clock that jumps from one event to the next.
//
// docs/superpowers/specs/2026-10-10-request-engine-design.md, phases 1–2. A visit
// to a part goes:
//
//   take a token (worker or connection), if the part has them
//   → first half of its CPU, on a core
//   → the rest of its own time, holding no core
//   → its calls, one after another
//   → second half of its CPU, on a core
//   → give the token back, answer the caller
//
// With no calls, all of the CPU is one piece. The result is its own shape for now;
// mapping it onto the flow engine's result is phase 3.

import { rateAt, type Scenario } from '../engine.js';
import { callCount } from './dist.js';
import { EventHeap } from './heap.js';
import { buildModel, type Link, type Part, type ServiceOverride } from './model.js';
import { createRng, type Rng } from './rng.js';
import { LatencyHistogram } from './stats.js';
import type { GraphDSL } from '../types.js';

export interface DesOptions {
  /** Same seed, same run. */
  seed?: number;
  /** Seconds at the start whose waits, response times and rates are not counted. */
  warmupS?: number;
  /** Test hook: replace named parts' log-normal service time. */
  service?: Record<string, ServiceOverride>;
}

export interface DesTick {
  t: number;
  /** Requests that arrived at a source in this second. */
  offered: number;
  /** Requests that finished end-to-end in this second. */
  completed: number;
  p50Ms: number;
  p99Ms: number;
}

export interface DesPart {
  nodeId: string;
  /** Visits that reached this part. */
  arrivals: number;
  completed: number;
  /** Visits completed per second, after warm-up. */
  servedRps: number;
  /** Cores computing in parallel; 0 when it holds none. */
  cores: number;
  /** Workers or connections held for a whole visit; 0 when unlimited. */
  tokens: number;
  /** Time spent queueing for a core, per piece of CPU work, ms. */
  meanWaitMs: number;
  waitP99Ms: number;
  /** Time spent queueing for a worker or connection, per visit, ms. */
  meanTokenWaitMs: number;
  /** Busy core-time over available core-time, after warm-up. */
  utilization: number;
}

export interface DesResult {
  seed: number;
  /** Events handled: the measure of how much work the run was. */
  events: number;
  ticks: DesTick[];
  parts: DesPart[];
  /** Requests finished end-to-end after warm-up. */
  completed: number;
  /**
   * Requests finished ÷ requests arrived, after warm-up. Below 1 the system is not
   * keeping up: until phase 3 adds timeouts and bounded queues, what an overloaded
   * part cannot finish waits in its queue rather than failing.
   */
  completionRatio: number;
  meanResponseMs: number;
  p99ResponseMs: number;
  assumptions: string[];
}

interface Frame {
  part: number;
  calls: Link[];
  next: number;
  /** The connection this visit came in on, for the way back. Null at the source. */
  via: Link | null;
  /** 1: first CPU piece; 2: waiting and calling; 3: second CPU piece. */
  stage: number;
  delay: number;
  cpuAfter: number;
}

interface Request {
  startedAt: number;
  stack: Frame[];
}

const ARRIVE = 0;
const ENTER = 1;
const CORE_DONE = 2;
const DELAY_DONE = 3;
const REPLY = 4;

interface Event {
  kind: number;
  /** Source index for ARRIVE, part index otherwise. */
  at: number;
  request: Request | null;
  link: Link | null;
}

interface Waiting {
  request: Request;
  work: number;
  since: number;
}

/** First in, first out, without shifting an array on every take. */
class Fifo<T> {
  private items: T[] = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }

  push(item: T): void {
    this.items.push(item);
  }

  take(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head]!;
    this.head += 1;
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
}

class PartState {
  busy = 0;
  coreQueue = new Fifo<Waiting>();
  inUse = 0;
  tokenQueue = new Fifo<Waiting>();
  arrivals = 0;
  completed = 0;
  served = 0;
  busyMs = 0;
  coreWaits = new LatencyHistogram();
  tokenWaits = new LatencyHistogram();
}

const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

function pickWeighted(rng: Rng, links: Link[]): Link | undefined {
  const total = links.reduce((sum, l) => sum + l.share, 0);
  if (!(total > 0)) return undefined;
  let r = rng() * total;
  for (const link of links) {
    r -= link.share;
    if (r < 0) return link;
  }
  return links[links.length - 1];
}

export function runDes(graph: GraphDSL, scenario: Scenario, options: DesOptions = {}): DesResult {
  const seed = options.seed ?? 1;
  const rng = createRng(seed);
  const model = buildModel(graph, options.service);
  const { parts, sources } = model;
  const state = parts.map(() => new PartState());

  const horizonMs = Math.max(0, scenario.horizonS) * 1000;
  const warmupMs = Math.max(0, options.warmupS ?? 0) * 1000;
  const seconds = Math.ceil(horizonMs / 1000);
  const offered = new Array<number>(seconds).fill(0);
  const completed = new Array<number>(seconds).fill(0);
  const perSecond = Array.from({ length: seconds }, () => new LatencyHistogram());
  const overall = new LatencyHistogram();
  let arrivedAfterWarmup = 0;

  const heap = new EventHeap<Event>();
  let now = 0;
  let events = 0;

  const schedule = (time: number, kind: number, at: number, request: Request | null, link: Link | null) =>
    heap.push(time, { kind, at, request, link });

  const top = (request: Request): Frame => request.stack[request.stack.length - 1]!;

  // -------------------------------------------------------------- arrivals --

  const rateOf = (sourceIndex: number, second: number): number => {
    const { part, baseRps } = sources[sourceIndex]!;
    const pattern = scenario.patterns?.[parts[part]!.node.id] ?? { shape: 'steady' as const, baseRps };
    return rateAt({ ...pattern, baseRps: pattern.baseRps ?? baseRps }, second) * scenario.loadMultiplier;
  };

  /**
   * The next arrival after `from`. The rate is held for each whole second, as the
   * flow engine holds it; a gap that would cross into the next second restarts at
   * the boundary with that second's rate, which is exact because the exponential
   * has no memory.
   */
  const scheduleArrival = (sourceIndex: number, from: number): void => {
    let t = from;
    while (t < horizonMs) {
      const second = Math.floor(t / 1000);
      const boundary = (second + 1) * 1000;
      const rate = rateOf(sourceIndex, second);
      if (rate > 0) {
        const next = t - Math.log(1 - rng()) * (1000 / rate);
        if (next < boundary) {
          if (next < horizonMs) schedule(next, ARRIVE, sourceIndex, null, null);
          return;
        }
      }
      t = boundary;
    }
  };

  // ----------------------------------------------------------------- cores --

  const grantCore = (p: number, waiting: Waiting): void => {
    const s = state[p]!;
    s.busy += 1;
    if (now >= warmupMs) {
      s.coreWaits.add(now - waiting.since);
      s.busyMs += waiting.work;
    }
    schedule(now + waiting.work, CORE_DONE, p, waiting.request, null);
  };

  /** Compute for `work` ms on one of the part's cores, queueing if they are all busy. */
  const compute = (request: Request, p: number, work: number): void => {
    if (!(work > 0)) {
      computed(request);
      return;
    }
    const waiting: Waiting = { request, work, since: now };
    if (state[p]!.busy < parts[p]!.cores) grantCore(p, waiting);
    else state[p]!.coreQueue.push(waiting);
  };

  const coreDone = (p: number, request: Request): void => {
    const s = state[p]!;
    s.busy -= 1;
    const next = s.coreQueue.take();
    if (next) grantCore(p, next);
    computed(request);
  };

  // ---------------------------------------------------------------- visits --

  const enter = (request: Request, p: number, via: Link | null): void => {
    const part: Part = parts[p]!;
    const s = state[p]!;
    s.arrivals += 1;

    // Which calls this visit makes, decided on the way in. A cache hit makes none.
    // A part already on this request's call chain is not called again: a drawn
    // cycle is a loop, not a request that never ends.
    const onChain = (to: number) => request.stack.some((f) => f.part === to);
    const calls: Link[] = [];
    const answered = part.answers > 0 && rng() < part.answers;
    if (answered) {
      // Served from here.
    } else if (part.routes) {
      const picked = pickWeighted(rng, part.out);
      if (picked && !onChain(picked.to)) calls.push(picked);
    } else {
      for (const link of part.out) {
        if (onChain(link.to)) continue;
        for (let n = callCount(rng, link.share); n > 0; n -= 1) calls.push(link);
      }
    }
    request.stack.push({ part: p, calls, next: 0, via, stage: 0, delay: 0, cpuAfter: 0 });

    if (!Number.isFinite(part.tokens) || s.inUse < part.tokens) {
      if (Number.isFinite(part.tokens)) {
        s.inUse += 1;
        if (now >= warmupMs) s.tokenWaits.add(0);
      }
      begin(request);
    } else {
      s.tokenQueue.push({ request, work: 0, since: now });
    }
  };

  /** The visit has its token: draw how slow it is and start computing. */
  const begin = (request: Request): void => {
    const frame = top(request);
    const part = parts[frame.part]!;
    const f = part.factor(rng);
    const wall = part.latencyMs * f;
    const cpu = (part.cpuMs * f) / part.meanFactor / part.speed;
    frame.delay = Math.max(0, wall - cpu);
    const split = frame.calls.length > 0;
    frame.cpuAfter = split ? cpu / 2 : 0;
    frame.stage = 1;
    compute(request, frame.part, split ? cpu / 2 : cpu);
  };

  const computed = (request: Request): void => {
    const frame = top(request);
    if (frame.stage === 1) {
      frame.stage = 2;
      if (frame.delay > 0) schedule(now + frame.delay, DELAY_DONE, frame.part, request, null);
      else callNext(request);
      return;
    }
    finish(request);
  };

  /** Make the next call this visit owes, or move on to its last piece of CPU. */
  const callNext = (request: Request): void => {
    const frame = top(request);
    const link = frame.calls[frame.next];
    if (link) {
      frame.next += 1;
      schedule(now + link.halfRttMs, ENTER, link.to, request, link);
      return;
    }
    frame.stage = 3;
    compute(request, frame.part, frame.cpuAfter);
  };

  const finish = (request: Request): void => {
    const frame = request.stack.pop()!;
    const p = frame.part;
    const s = state[p]!;
    s.completed += 1;
    if (now >= warmupMs) s.served += 1;

    // Hand the token straight to whoever has been waiting longest.
    if (Number.isFinite(parts[p]!.tokens)) {
      const next = s.tokenQueue.take();
      if (next) {
        if (now >= warmupMs) s.tokenWaits.add(now - next.since);
        begin(next.request);
      } else {
        s.inUse -= 1;
      }
    }

    if (frame.via) {
      schedule(now + frame.via.halfRttMs, REPLY, p, request, null);
      return;
    }

    // Back at the source: the request is done.
    const second = Math.floor(now / 1000);
    if (second < seconds) {
      completed[second]! += 1;
      perSecond[second]!.add(now - request.startedAt);
    }
    if (now >= warmupMs) overall.add(now - request.startedAt);
  };

  // -------------------------------------------------------------- the loop --

  sources.forEach((_, i) => scheduleArrival(i, 0));

  for (;;) {
    const next = heap.pop();
    if (!next || next.time >= horizonMs) break;
    now = next.time;
    events += 1;
    const event = next.value;

    switch (event.kind) {
      case ARRIVE: {
        offered[Math.floor(now / 1000)]! += 1;
        if (now >= warmupMs) arrivedAfterWarmup += 1;
        scheduleArrival(event.at, now);
        enter({ startedAt: now, stack: [] }, sources[event.at]!.part, null);
        break;
      }
      case ENTER:
        enter(event.request!, event.at, event.link);
        break;
      case CORE_DONE:
        coreDone(event.at, event.request!);
        break;
      case DELAY_DONE:
      case REPLY:
        callNext(event.request!);
        break;
    }
  }

  // ------------------------------------------------------------ the answer --

  const measuredMs = Math.max(1, horizonMs - warmupMs);
  return {
    seed,
    events,
    ticks: offered.map((n, t) => ({
      t,
      offered: n,
      completed: completed[t]!,
      p50Ms: round(perSecond[t]!.percentile(0.5)),
      p99Ms: round(perSecond[t]!.percentile(0.99)),
    })),
    parts: parts.map((part, i) => {
      const s = state[i]!;
      const cores = Number.isFinite(part.cores) ? part.cores : 0;
      return {
        nodeId: part.node.id,
        arrivals: s.arrivals,
        completed: s.completed,
        servedRps: round(s.served / (measuredMs / 1000), 1),
        cores,
        tokens: Number.isFinite(part.tokens) ? part.tokens : 0,
        meanWaitMs: round(s.coreWaits.mean, 4),
        waitP99Ms: round(s.coreWaits.percentile(0.99)),
        meanTokenWaitMs: round(s.tokenWaits.mean, 4),
        // busyMs is time on a core, already stretched for a fractional vCPU.
        utilization: cores > 0 ? round(s.busyMs / (cores * measuredMs), 3) : 0,
      };
    }),
    completed: overall.count,
    completionRatio: arrivedAfterWarmup > 0 ? round(overall.count / arrivedAfterWarmup, 4) : 1,
    meanResponseMs: round(overall.mean),
    p99ResponseMs: round(overall.percentile(0.99)),
    assumptions: model.assumptions,
  };
}
