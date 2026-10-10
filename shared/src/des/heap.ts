// The future, in order.
//
// A binary min-heap keyed on time, with a sequence number to break ties. The tie
// break is the part that matters: two events at the same instant must come out in
// the order they were scheduled, or the run depends on how the heap happened to
// arrange its array and two identical runs can disagree.

export interface Scheduled<T> {
  time: number;
  seq: number;
  value: T;
}

const before = <T>(a: Scheduled<T>, b: Scheduled<T>): boolean =>
  a.time < b.time || (a.time === b.time && a.seq < b.seq);

export class EventHeap<T> {
  private items: Scheduled<T>[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.items.length;
  }

  push(time: number, value: T): void {
    const items = this.items;
    const item = { time, seq: this.nextSeq++, value };
    let i = items.length;
    items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(item, items[parent]!)) break;
      items[i] = items[parent]!;
      i = parent;
    }
    items[i] = item;
  }

  pop(): Scheduled<T> | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined || items.length === 0) return top;
    let i = 0;
    const n = items.length;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) break;
      const right = left + 1;
      const child = right < n && before(items[right]!, items[left]!) ? right : left;
      if (!before(items[child]!, last)) break;
      items[i] = items[child]!;
      i = child;
    }
    items[i] = last;
    return top;
  }
}
