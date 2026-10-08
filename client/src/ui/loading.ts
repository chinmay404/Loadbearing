/**
 * How many things the person is waiting on right now.
 *
 * A plain counter with listeners rather than a store: every request goes through
 * it, and a bar at the top of the window is the only thing that reads it, so a
 * React re-render per request would be all cost and no benefit.
 */

type Listener = (busy: number) => void;

let busy = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(busy);
}

export function beginLoading(): () => void {
  busy += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busy = Math.max(0, busy - 1);
    emit();
  };
}

/** Wrap any promise the person is visibly waiting on. */
export function trackLoading<T>(work: Promise<T>): Promise<T> {
  const end = beginLoading();
  return work.finally(end);
}

export function subscribeLoading(fn: Listener): () => void {
  listeners.add(fn);
  fn(busy);
  return () => listeners.delete(fn);
}
