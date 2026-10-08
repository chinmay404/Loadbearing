import { describe, expect, it } from 'vitest';
import { beginLoading, subscribeLoading, trackLoading } from './loading';

describe('what the loading bar listens to', () => {
  it('counts overlapping work and settles back to zero', async () => {
    const seen: number[] = [];
    const stop = subscribeLoading((n) => seen.push(n));
    const endA = beginLoading();
    const b = trackLoading(Promise.resolve('ok'));
    endA();
    endA(); // ending twice must not go negative
    await b;
    stop();
    expect(seen).toEqual([0, 1, 2, 1, 0]);
  });
  it('still settles when the work fails', async () => {
    let last = -1;
    const stop = subscribeLoading((n) => (last = n));
    await trackLoading(Promise.reject(new Error('no'))).catch(() => undefined);
    stop();
    expect(last).toBe(0);
  });
});
