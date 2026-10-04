import { describe, expect, it } from 'vitest';
import { FAMILY, type SimNodeResult } from '@loadbearing/shared';
import { GAUGE_OF, MAX_CELLS, fmtMs, gaugeModel, healthOf } from './gauge';

function sim(over: Partial<SimNodeResult> = {}): SimNodeResult {
  return {
    nodeId: 'n',
    incomingRps: 1000,
    capacityRps: 2000,
    utilization: 0.5,
    latencyMs: 20,
    droppedRps: 0,
    queueDepth: 0,
    state: 'ok',
    replicas: 1,
    replicasSettled: 1,
    unlimited: false,
    hostLimited: false,
    elastic: false,
    ...over,
  };
}

describe('health', () => {
  it('translates the engine state instead of re-deciding it', () => {
    expect(healthOf(undefined, false)).toBe('idle');
    expect(healthOf('ok', false)).toBe('pass');
    expect(healthOf('warn', false)).toBe('load');
    expect(healthOf('hot', false)).toBe('load');
    expect(healthOf('saturated', false)).toBe('fail');
    expect(healthOf('down', false)).toBe('down');
  });
  it('a killed part is down whatever the run said', () => {
    expect(healthOf('ok', true)).toBe('down');
  });
});

describe('every family has a gauge', () => {
  it('maps each component type to one of the eight drawings', () => {
    const kinds = new Set(Object.values(GAUGE_OF));
    for (const family of new Set(Object.values(FAMILY))) expect(GAUGE_OF[family]).toBeDefined();
    expect(kinds.size).toBeLessThanOrEqual(8);
  });
});

describe('workers', () => {
  it('counts busy channels as utilisation × concurrency × replicas', () => {
    const m = gaugeModel({
      type: 'service',
      attrs: { concurrency: 8 },
      sim: sim({ utilization: 0.5, replicas: 2, replicasSettled: 2 }),
      killed: false,
      outDegree: 1,
    });
    expect(m.kind).toBe('workers');
    expect(m.workers).toMatchObject({ channels: 16, busy: 8, cells: 16, busyCells: 8, replicas: 2 });
  });

  it('fills every cell and reports the queue once demand passes capacity', () => {
    const m = gaugeModel({
      type: 'service',
      attrs: { concurrency: 64 },
      sim: sim({ utilization: 1.5, incomingRps: 1500, droppedRps: 300, queueDepth: 240, state: 'saturated' }),
      killed: false,
      outDegree: 1,
    });
    expect(m.fill).toBe(1);
    expect(m.workers?.cells).toBe(MAX_CELLS);
    expect(m.workers?.busyCells).toBe(MAX_CELLS);
    expect(m.workers?.waiting).toBe(240);
    expect(m.shed).toBeCloseTo(0.2);
    expect(m.health).toBe('fail');
    expect(m.headline).toBe('sheds 20%');
  });
});

describe('cache', () => {
  it('shows the hit rate the engine used, capped by what memory can cover', () => {
    const m = gaugeModel({
      type: 'cache',
      attrs: { cacheHitRate: 0.95, memoryGb: 1, workingSetGb: 4 },
      sim: sim(),
      killed: false,
      outDegree: 1,
    });
    // A quarter of the working set fits; coverage^0.5 = 0.5 is the most it can absorb.
    expect(m.ring?.hitRate).toBeCloseTo(0.5);
    expect(m.headline).toBe('50% hits');
  });
});

describe('datastore', () => {
  it('estimates connections in use from queries in flight, capped by the pool', () => {
    const m = gaugeModel({
      type: 'sql_db',
      attrs: { concurrency: 200, maxConnections: 100 },
      sim: sim({ utilization: 0.75 }),
      killed: false,
      outDegree: 0,
    });
    expect(m.tank).toEqual({ poolSize: 100, poolUsed: 100 });
  });
  it('says nothing about a pool nobody stated', () => {
    const m = gaugeModel({ type: 'sql_db', attrs: {}, sim: sim(), killed: false, outDegree: 0 });
    expect(m.tank).toEqual({ poolSize: null, poolUsed: null });
  });
});

describe('queue', () => {
  it('reports the peak backlog and how long it takes to drain', () => {
    const m = gaugeModel({
      type: 'queue',
      attrs: {},
      sim: sim({ capacityRps: 500, queueDepth: 100 }),
      killed: false,
      outDegree: 1,
      peakBacklog: 2000,
    });
    expect(m.queue?.depth).toBe(2000);
    expect(m.queue?.drainS).toBe(4);
  });
});

describe('before a run, and after a kill', () => {
  it('rests with no numbers before anything has run', () => {
    const m = gaugeModel({ type: 'service', attrs: {}, killed: false, outDegree: 0 });
    expect(m.live).toBe(false);
    expect(m.health).toBe('idle');
    expect(m.fill).toBe(0);
    expect(m.headline).toBe('');
  });
  it('a killed part carries nothing', () => {
    const m = gaugeModel({ type: 'service', attrs: {}, sim: sim(), killed: true, outDegree: 0 });
    expect(m.health).toBe('down');
    expect(m.inRps).toBe(0);
    expect(m.headline).toBe('down');
  });
});

describe('milliseconds', () => {
  it('switches to seconds once milliseconds stop being readable', () => {
    expect(fmtMs(4.25)).toBe('4.3 ms');
    expect(fmtMs(42)).toBe('42 ms');
    expect(fmtMs(80_000)).toBe('80.0 s');
    expect(fmtMs(null)).toBe('—');
  });
});
