import { describe, expect, it } from 'vitest';
import type { Flow, SimResult } from '@loadbearing/shared';
import { GIVE_UP_MS, fmtWait, journeysFor, sampleLoad, type Journey } from './userLoads';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};
const j = (over: Partial<Journey> = {}): Journey => ({ name: 'browse', p50Ms: 200, p99Ms: 2000, success: 1, broken: false, ...over });

describe('what a user of this client sees', () => {
  it('a healthy journey loads at the median most of the time', () => {
    const load = sampleLoad(j(), seq(0.5, 0.5, 0.5));
    expect(load.outcome).toBe('ok');
    expect(load.ms).toBeGreaterThan(150);
    expect(load.ms).toBeLessThan(260);
  });
  it('one load in ten lands on the slow tail', () => {
    expect(sampleLoad(j(), seq(0.5, 0.05, 0.5)).outcome).toBe('slow');
  });
  it('fails exactly as often as the run says requests fail', () => {
    expect(sampleLoad(j({ success: 0.7 }), seq(0.75)).outcome).toBe('error');
    expect(sampleLoad(j({ success: 0.7 }), seq(0.65, 0.5, 0.5)).outcome).toBe('ok');
  });
  it('a broken journey always errors', () => {
    expect(sampleLoad(j({ broken: true }), seq(0)).outcome).toBe('error');
  });
  it('gives up rather than spinning forever', () => {
    const load = sampleLoad(j({ p50Ms: 30_000, p99Ms: 60_000 }), seq(0.1, 0.5, 0.5));
    expect(load).toMatchObject({ outcome: 'timeout', ms: GIVE_UP_MS });
  });
  it('reads waits the way people do', () => {
    expect(fmtWait(230)).toBe('230 ms');
    expect(fmtWait(2400)).toBe('2.4 s');
  });
  it('uses the journeys that start at this client', () => {
    const flows: Flow[] = [
      { id: 'f1', name: 'browse', kind: 'read', steps: ['web', 'api'], rps: 10, description: '' },
      { id: 'f2', name: 'other', kind: 'read', steps: ['phone', 'api'], rps: 10, description: '' },
    ];
    const result = {
      flows: [
        { flowId: 'f1', name: 'browse', offeredRps: 100, completedRps: 90, p50Ms: 120, p99Ms: 900, broken: false, notes: [], measured: true },
        { flowId: 'f2', name: 'other', offeredRps: 100, completedRps: 100, p50Ms: 50, p99Ms: 80, broken: false, notes: [], measured: true },
      ],
    } as unknown as SimResult;
    expect(journeysFor('web', flows, result)).toEqual([{ name: 'browse', p50Ms: 120, p99Ms: 900, success: 0.9, broken: false }]);
  });
});
