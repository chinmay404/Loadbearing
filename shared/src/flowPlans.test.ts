import { describe, expect, it } from 'vitest';
import type { GraphDSL, GraphNode } from './types.js';
import { guessFlowKind, isPathBroken, matchPath, meetsPlan, plansFor, sameFlowName } from './flowPlans.js';

const node = (id: string, type: GraphNode['type']): GraphNode => ({ id, type, label: id, annotation: '' });
const graph = (nodes: GraphNode[], edges: [string, string][]): GraphDSL => ({
  nodes,
  edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to, kind: 'sync' })),
  stickies: [],
  flows: [],
});

describe('guessFlowKind', () => {
  it.each([
    ['image upload', 'write'],
    ['merchandiser price update', 'write'],
    ['image deletion', 'write'],
    ['nightly catalog import', 'async'],
    ['derivative generation', 'async'],
    ['admin refund', 'admin'],
    ['product detail read', 'read'],
    ['feed page', 'read'],
    ['verification email send', 'async'],
    ['click event ingest', 'async'],
    ['display a product', 'read'],
    ['view posts', 'read'],
  ])('%s → %s', (name, kind) => {
    expect(guessFlowKind(name)).toBe(kind);
  });
});

describe('plansFor', () => {
  it('uses an authored plan when one matches the name, ignoring case and spaces', () => {
    const plans = plansFor({
      expectedFlows: ['Upload a photo'],
      flowPlans: [{ name: 'upload a photo ', kind: 'write', rps: 20, plain: 'A user sends a photo.' }],
    });
    expect(plans).toEqual([{ name: 'upload a photo ', kind: 'write', rps: 20, plain: 'A user sends a photo.' }]);
  });

  it('derives a plan for a name that has none', () => {
    expect(plansFor({ expectedFlows: ['image upload'] })).toEqual([
      { name: 'image upload', kind: 'write', rps: 100, plain: '' },
    ]);
  });
});

describe('matchPath', () => {
  const photo = graph(
    [node('u', 'client'), node('app', 'service'), node('store', 'blob_store'), node('q', 'queue'), node('w', 'worker')],
    [['u', 'app'], ['app', 'store'], ['app', 'q'], ['q', 'w']],
  );

  it('finds the one path that reaches what the request needs, cut where it gets there', () => {
    const m = matchPath({ name: 'upload', kind: 'write', rps: 20, plain: '', mustReach: [['blob_store']] }, photo);
    expect(m).toEqual({ status: 'found', path: ['u', 'app', 'store'] });
  });

  it('honours every group, in the order the path reaches them', () => {
    const m = matchPath({ name: 'thumb', kind: 'async', rps: 20, plain: '', mustReach: [['queue'], ['worker']] }, photo);
    expect(m).toEqual({ status: 'found', path: ['u', 'app', 'q', 'w'] });
  });

  it('starts background work where the request hands it off, so it does not count as new traffic', () => {
    const handoff: GraphDSL = {
      ...photo,
      edges: photo.edges.map((e) => (e.from === 'app' && e.to === 'q' ? { ...e, kind: 'async' as const } : e)),
    };
    const m = matchPath({ name: 'thumb', kind: 'async', rps: 20, plain: '', mustReach: [['queue'], ['worker']] }, handoff);
    expect(m).toEqual({ status: 'found', path: ['app', 'q', 'w'] });
  });

  it('recognises cache-aside: the app server calls the cache and the database side by side', () => {
    const aside = graph(
      [node('u', 'client'), node('app', 'service'), node('c', 'cache'), node('db', 'sql_db')],
      [['u', 'app'], ['app', 'c'], ['app', 'db']],
    );
    const m = matchPath({ name: 'view', kind: 'read', rps: 50, plain: '', mustReach: [['cache'], ['sql_db']] }, aside);
    expect(m).toEqual({ status: 'found', path: ['u', 'app', 'c', 'db'] });
    if (m.status === 'found') expect(isPathBroken(m.path, aside)).toBe(false);
  });

  it('says none when nothing drawn reaches it', () => {
    const m = matchPath({ name: 'view', kind: 'read', rps: 20, plain: '', mustReach: [['cdn']] }, photo);
    expect(m).toEqual({ status: 'none' });
  });

  it('offers a choice between equally short paths', () => {
    const twoServers = graph(
      [node('u', 'client'), node('lb', 'load_balancer'), node('a', 'service'), node('b', 'service'), node('db', 'sql_db')],
      [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'db'], ['b', 'db']],
    );
    const m = matchPath({ name: 'read', kind: 'read', rps: 50, plain: '', mustReach: [['sql_db']] }, twoServers);
    expect(m.status).toBe('choose');
    if (m.status === 'choose') expect(m.paths).toHaveLength(2);
  });

  it('with no mustReach, offers every distinct path to choose from', () => {
    const m = matchPath({ name: 'x', kind: 'read', rps: 1, plain: '' }, photo);
    expect(m.status).toBe('choose');
  });

  it('says none on an empty canvas', () => {
    expect(matchPath({ name: 'x', kind: 'read', rps: 1, plain: '' }, graph([], []))).toEqual({ status: 'none' });
  });
});

describe('isPathBroken', () => {
  const g = graph([node('u', 'client'), node('app', 'service'), node('db', 'sql_db')], [['u', 'app'], ['app', 'db']]);

  it('accepts a path the drawing still carries', () => {
    expect(isPathBroken(['u', 'app', 'db'], g)).toBe(false);
  });

  it('accepts a step called by an earlier step, not only the one before (API → cache, API → db)', () => {
    const fan = graph(
      [node('u', 'client'), node('api', 'service'), node('c', 'cache'), node('db', 'sql_db')],
      [['u', 'api'], ['api', 'c'], ['api', 'db']],
    );
    expect(isPathBroken(['u', 'api', 'c', 'db'], fan)).toBe(false);
  });

  it('a step that is gone breaks the path', () => {
    expect(isPathBroken(['u', 'app', 'gone'], g)).toBe(true);
  });

  it('a step nothing earlier calls breaks the path', () => {
    expect(isPathBroken(['u', 'db'], g)).toBe(true);
  });

  it('an empty flow is not broken, just empty', () => {
    expect(isPathBroken([], g)).toBe(false);
  });
});

describe('meetsPlan', () => {
  const g = graph(
    [node('u', 'client'), node('app', 'service'), node('store', 'blob_store')],
    [['u', 'app'], ['app', 'store']],
  );
  const plan = { name: 'upload', kind: 'write' as const, rps: 20, plain: '', mustReach: [['blob_store' as const]] };

  it('accepts steps that still reach what the request needs', () => {
    expect(meetsPlan(plan, ['u', 'app', 'store'], g)).toBe(true);
  });

  it('rejects steps cut short when the box at the end was deleted', () => {
    // Deleting a box strips it from the flow, leaving a connected but useless path.
    expect(meetsPlan(plan, ['u', 'app'], g)).toBe(false);
  });

  it('accepts any steps for a plan with no mustReach', () => {
    expect(meetsPlan({ ...plan, mustReach: undefined }, ['u', 'app'], g)).toBe(true);
  });
});

describe('sameFlowName', () => {
  it('ignores case and surrounding space', () => {
    expect(sameFlowName(' Upload a photo', 'upload a photo')).toBe(true);
    expect(sameFlowName('upload', 'view')).toBe(false);
  });
});
