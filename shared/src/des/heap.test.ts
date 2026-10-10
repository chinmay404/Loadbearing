// The event queue decides what happens next. Two events at the same instant must
// come out in the order they went in, or the run depends on how a heap happened
// to shuffle its array — and stops being reproducible.

import { describe, expect, it } from 'vitest';
import { EventHeap } from './heap.js';

describe('event heap', () => {
  it('pops events earliest first', () => {
    const heap = new EventHeap<string>();
    for (const [t, v] of [[5, 'e'], [1, 'a'], [3, 'c'], [2, 'b'], [4, 'd']] as const) heap.push(t, v);
    const out: string[] = [];
    while (heap.size > 0) out.push(heap.pop()!.value);
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('breaks ties at the same time by the order they were pushed', () => {
    const heap = new EventHeap<number>();
    for (let i = 0; i < 100; i += 1) heap.push(i % 3 === 0 ? 1 : 2, i);
    const out: number[] = [];
    while (heap.size > 0) out.push(heap.pop()!.value);
    const ones = out.slice(0, 34);
    const twos = out.slice(34);
    expect(ones).toEqual([...ones].sort((a, b) => a - b));
    expect(twos).toEqual([...twos].sort((a, b) => a - b));
    expect(ones.every((v) => v % 3 === 0)).toBe(true);
  });

  it('returns undefined when empty', () => {
    expect(new EventHeap<number>().pop()).toBeUndefined();
  });
});
