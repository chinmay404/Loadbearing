// Percentiles from buckets.
//
// A run at a few thousand requests per second sees millions of them; keeping each
// time to sort afterwards costs memory a browser tab does not have. Log-spaced
// buckets 2% wide hold any time from microseconds to minutes in about a thousand
// counters, and read any percentile to within one bucket. The bucketing also
// absorbs float noise, which helps two runs on different machines agree.

/** Bucket width: each bucket's upper edge is 2% above its lower one. */
const GROWTH = 1.02;
const LOG_GROWTH = Math.log(GROWTH);
/** Times below this share bucket 0. Far under anything a network can do. */
const FLOOR_MS = 0.01;

export class LatencyHistogram {
  private buckets: number[] = [];
  count = 0;
  private sum = 0;

  add(ms: number): void {
    const index = ms < FLOOR_MS ? 0 : 1 + Math.floor(Math.log(ms / FLOOR_MS) / LOG_GROWTH);
    while (this.buckets.length <= index) this.buckets.push(0);
    this.buckets[index]! += 1;
    this.count += 1;
    this.sum += ms;
  }

  get mean(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  /** The time below which a fraction `q` of what was recorded fell, 0 when nothing was. */
  percentile(q: number): number {
    if (this.count === 0) return 0;
    const rank = Math.max(1, Math.ceil(q * this.count));
    let seen = 0;
    for (let i = 0; i < this.buckets.length; i += 1) {
      seen += this.buckets[i]!;
      if (seen >= rank) return i === 0 ? FLOOR_MS / 2 : FLOOR_MS * GROWTH ** (i - 0.5);
    }
    return 0;
  }
}
