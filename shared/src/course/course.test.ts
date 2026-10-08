import { describe, expect, it } from 'vitest';
import { checkTopology } from '../compatibility.js';
import { FAMILY } from '../families.js';
import { COURSE, STEP_BY_ID } from './chapters.js';
import { applyPatch, idOfKey, judgeGate, judgeStep, startGraph } from './judge.js';

const NODE_TYPES = Object.keys(FAMILY);

const steps = COURSE.flatMap((c) => c.steps);

describe('every step is honest', () => {
  // A step that already passes teaches nothing, and one nobody can pass is a wall.
  // Each one carries a solution, and these hold the arithmetic to both.
  it.each(steps.filter((s) => !s.observe).map((s) => [s.id, s] as const))('%s fails as given and passes when solved', (_id, step) => {
    const start = startGraph(step);
    expect(judgeStep(step, start).passed).toBe(false);
    const solved = judgeStep(step, applyPatch(start, step.solution));
    expect(solved.gates.filter((g) => !g.pass).map((g) => `${g.label}: ${g.detail}`)).toEqual([]);
    expect(solved.findings.filter((f) => f.open).map((f) => f.rule)).toEqual([]);
    expect(solved.budget.pass).toBe(true);
    expect(solved.passed).toBe(true);
  });

  it.each(steps.filter((s) => s.observe).map((s) => [s.id, s] as const))('%s shows something actually going wrong', (_id, step) => {
    const verdict = judgeStep(step, startGraph(step));
    expect(verdict.gates.some((g) => !g.pass)).toBe(true);
    if (step.predict) expect(verdict.firstFailure).not.toBeNull();
  });
});

describe('every step refers to things that exist', () => {
  it.each(steps.map((s) => [s.id, s] as const))('%s', (_id, step) => {
    const keys = new Set([...step.start.nodes.map((n) => n.key), ...(step.solution.add ?? []).map((a) => a.key)]);
    for (const d of step.dials ?? []) expect(step.start.nodes.map((n) => n.key)).toContain(d.key);
    for (const g of step.gates) if (g.kill) expect(keys).toContain(g.kill.key);
    for (const t of step.parts) expect(NODE_TYPES).toContain(t);
    if (step.hints.ghost) for (const k of step.hints.ghost.between) expect(keys).toContain(k);
    expect(STEP_BY_ID[step.id]).toBe(step);
  });
});

describe('every wire a step starts with can be seen', () => {
  // A wire drawn behind a part reads as two wires through it, which teaches the
  // opposite of what is there. Wires leave a part's right side and enter the next
  // one's left, stepping across halfway, so trace that and keep it off other parts.
  const W = 220;
  const H = 110;
  it.each(steps.map((s) => [s.id, s] as const))('%s', (_id, step) => {
    const at = new Map(step.start.nodes.map((n) => [n.key, n.at]));
    for (const e of step.start.edges) {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      const sx = a.x + W;
      const sy = a.y + H / 2;
      const tx = b.x;
      const ty = b.y + H / 2;
      const mx = (sx + tx) / 2;
      const segments = [
        { x1: sx, y1: sy, x2: mx, y2: sy },
        { x1: mx, y1: sy, x2: mx, y2: ty },
        { x1: mx, y1: ty, x2: tx, y2: ty },
      ];
      for (const n of step.start.nodes) {
        if (n.key === e.from || n.key === e.to) continue;
        const hit = segments.some(
          (s) =>
            Math.max(s.x1, s.x2) > n.at.x &&
            Math.min(s.x1, s.x2) < n.at.x + W &&
            Math.max(s.y1, s.y2) > n.at.y &&
            Math.min(s.y1, s.y2) < n.at.y + H,
        );
        expect(hit, `${e.from} → ${e.to} runs behind ${n.key}`).toBe(false);
      }
    }
  });
});

describe('the words stay short', () => {
  const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  it.each(steps.map((s) => [s.id, s] as const))('%s', (_id, step) => {
    expect(step.title.split(/\s+/).length).toBeLessThanOrEqual(6);
    expect(sentences(step.story)).toBeLessThanOrEqual(2);
    expect(step.story.length).toBeLessThanOrEqual(140);
    expect(step.task.length).toBeLessThanOrEqual(80);
    expect(sentences(step.lesson)).toBeLessThanOrEqual(2);
  });
});

describe('the judge', () => {
  it('counts only the seconds after a kill when asked to', () => {
    const step = STEP_BY_ID['2-3']!;
    const g = applyPatch(startGraph(step), { set: [{ key: 'lb', attrs: { healthCheckS: 5 } }] });
    const gate = step.gates[0]!;
    const after = judgeGate(g, gate).result;
    const all = judgeGate(g, { ...gate, window: 'all' }).result;
    // The same loss spread over more seconds reads smaller.
    expect(parseFloat(all.detail)).toBeLessThan(parseFloat(after.detail));
  });

  it('does not pass a phone that is wired to nothing', () => {
    // Parts placed but never connected: nothing is lost because nothing is sent.
    const step = STEP_BY_ID['p-5']!;
    const placed = applyPatch(startGraph(step), { add: step.solution.add ?? [] });
    const verdict = judgeStep(step, placed);
    expect(verdict.gates.map((g) => g.pass)).toEqual([false, false]);
    expect(verdict.gates[1]!.detail).toBe('Her phone is not connected');
  });

  it('names the part that broke first', () => {
    expect(judgeStep(STEP_BY_ID['p-4']!, startGraph(STEP_BY_ID['p-4']!)).firstFailure).toBe(idOfKey('app'));
  });

  it('keeps authored parts findable by key on the canvas', () => {
    const g = startGraph(STEP_BY_ID['p-1']!);
    expect(g.nodes.map((n) => n.id)).toContain(idOfKey('app'));
    expect(checkTopology(g).length).toBeGreaterThanOrEqual(0);
  });
});
