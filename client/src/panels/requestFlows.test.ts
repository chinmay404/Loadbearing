import { describe, expect, it } from 'vitest';
import type { Flow, FlowPlan } from '@loadbearing/shared';
import { assignFlows } from './requestFlows';

const plan = (name: string): FlowPlan => ({ name, kind: 'read', rps: 10, plain: '' });
const flow = (id: string, name: string): Flow => ({ id, name, kind: 'read', rps: 10, steps: [], description: '' });

describe('assignFlows', () => {
  it('gives each request card the flow with its name', () => {
    const { byPlan, extra } = assignFlows([plan('upload a photo')], [flow('f1', ' Upload a photo')]);
    expect(byPlan.get('upload a photo')?.id).toBe('f1');
    expect(extra).toEqual([]);
  });

  it('lists a second flow with the same name instead of hiding it, so it can be seen and deleted', () => {
    const { byPlan, extra } = assignFlows([plan('view')], [flow('f1', 'view'), flow('f2', 'view')]);
    expect(byPlan.get('view')?.id).toBe('f1');
    expect(extra.map((f) => f.id)).toEqual(['f2']);
  });

  it('lists flows that belong to no request', () => {
    const { byPlan, extra } = assignFlows([plan('view')], [flow('f1', 'my own flow')]);
    expect(byPlan.get('view')).toBeUndefined();
    expect(extra.map((f) => f.id)).toEqual(['f1']);
  });
});
