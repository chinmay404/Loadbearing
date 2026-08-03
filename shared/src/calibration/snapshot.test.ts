// The tripwire.
//
// `-u` updates this file, and updating it is a normal part of changing the
// physics. What is not normal is updating it without reading the diff: every
// number in here is something the engine currently tells a learner, and the whole
// point of the exercise is that changes to them are decisions rather than
// accidents.

import { describe, expect, it } from 'vitest';
import { snapshotAll } from './snapshot.js';

describe('engine baseline', () => {
  it('matches the committed snapshot', async () => {
    await expect(JSON.stringify(snapshotAll(), null, 2)).toMatchFileSnapshot('./baseline.json');
  });

  it('is deterministic across runs', () => {
    // The engine promises purity. If two runs of identical input disagree, some
    // state is leaking between them and every other assertion here is worthless.
    expect(JSON.stringify(snapshotAll())).toBe(JSON.stringify(snapshotAll()));
  });

  it('actually captured the blueprints, rather than an empty object', () => {
    // A snapshot that silently covers nothing passes forever and guards nothing.
    const snapshot = snapshotAll();
    const ids = Object.keys(snapshot);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      expect(snapshot[id]!.flows.length, `${id} has no flows`).toBeGreaterThan(0);
      expect(snapshot[id]!.nodes.length, `${id} has no nodes`).toBeGreaterThan(0);
    }
  });
});
