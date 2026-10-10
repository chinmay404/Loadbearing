// Seeded random numbers.
//
// Math.random cannot be seeded, so a run that used it could never be replayed:
// not to debug it, not to compare two designs on the same traffic, not to check
// that browser and server agree. mulberry32 is 32 bits of state and a handful of
// integer operations, which is all a simulation of this size needs — the period
// (2^32) is far beyond the number of draws one run makes.

/** A source of uniform numbers in [0, 1). */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
