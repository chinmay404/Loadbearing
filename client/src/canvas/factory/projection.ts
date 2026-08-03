// The arithmetic behind the isometric plant.
//
// Everything here is deliberately orthographic: one fixed camera, no vanishing
// point. That is not an aesthetic preference — the utilisation band on a station
// is the number a learner is asked to compare against every other station, and
// under perspective a bar's apparent length depends on where on the floor it
// happens to sit. Orthographic keeps two stations at 60% and 85% honestly
// comparable, which is the whole reason the view is allowed to exist.
//
// Height encodes exactly one variable — utilisation — so the plant's silhouette
// IS the load profile. Adding a second meaning to height would turn a readout
// back into decoration.

/** Footprint of one station on the floor, in flow units. */
export const STATION_W = 148;
export const STATION_D = 76;

/** One "unit" of height. A station is 0.6–2.0 of these tall. */
export const UNIT = 34;

/** Belt width, and how far above the floor it rides. */
export const BELT_W = 18;
export const BELT_Z = 6;

/** Azimuth reaches the isometric 45° early, so the middle tilt stop reads as a
 *  shallow plant rather than a skewed floor plan. */
export const azimuthFor = (tilt: number): number => 45 * Math.min(1, tilt / 12);

/** How much of the flat 2D presentation still shows through, 1 → 0. */
export const flatnessFor = (tilt: number): number => 1 - Math.min(1, tilt / 10);

/**
 * Strain bands, straight off `latency = service ÷ (1 − utilisation)`.
 *
 * The thresholds are the queueing knee, not taste: at 0.70 a component already
 * responds in 3.3× its service time, which is why that is where the drawing
 * starts to look worried rather than where it turns red.
 */
export function bandColor(u: number): string {
  if (u >= 0.85) return '#d9534b';
  if (u >= 0.5) return '#e2913c';
  return '#7ba75f';
}

export type Band = 'calm' | 'warm' | 'strained' | 'saturated' | 'shedding';

export function bandFor(u: number, dropping: boolean): Band {
  if (dropping || u >= 1) return 'shedding';
  if (u >= 0.85) return 'saturated';
  if (u >= 0.7) return 'strained';
  if (u >= 0.5) return 'warm';
  return 'calm';
}

/** Station height in pixels. The one place utilisation becomes geometry. */
export const heightFor = (u: number): number => (0.6 + Math.min(1.2, u) * 1.4) * UNIT;

/**
 * Flat-shaded faces: three fixed brightnesses, no lighting model.
 *
 * A specular highlight or a gradient here would push the plant towards toy, and
 * the product is asking to be trusted with numbers.
 */
export const FACE_TOP = 1;
export const FACE_FRONT = 0.78;
export const FACE_SIDE = 0.62;

export function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

/** Item density on a belt: one plate per 20 rps, never none, never a swarm. */
export const platesFor = (rps: number): number =>
  Math.max(1, Math.min(24, Math.round(rps / 20)));

/**
 * Plate travel time. Inverse to the *target's* service latency, because a slow
 * dependency is exactly what a learner should be able to see without reading a
 * number: the belt into a 1200ms model crawls, the belt into a cache blurs.
 */
export function beltSeconds(latencyMs: number): number {
  const ms = Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 20;
  return Math.max(0.4, Math.min(3.2, 0.4 + ms / 340));
}

/** Work-in-progress units beside a station: one per 50 queued, capped. */
export const pileFor = (queueDepth: number): number =>
  queueDepth <= 0 ? 0 : Math.max(1, Math.min(36, Math.round(queueDepth / 50)));

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounds of the drawing in flow space, padded so the fence has somewhere to go. */
export function boundsOf(points: { x: number; y: number }[], pad = 110): Rect {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 600, maxY: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + STATION_W);
    maxY = Math.max(maxY, p.y + STATION_D);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * Fit scale for the floor inside a viewport.
 *
 * Deliberately computed at the WORST case rather than at the current tilt: a
 * scale that tracks the elevation makes the plant shrink as it stands up, and
 * the tilt transition then reads as the drawing retreating rather than the towers
 * rising out of it. The elevation's own foreshortening is left out for the same
 * reason — the fit is a function of the drawing, not of where the camera is, so
 * moving between stops only ever tilts.
 *
 * Azimuth is included because 45° genuinely changes the footprint's aspect, and
 * it is at its full value for every stop above the first.
 */
export function fitScale(b: Rect, view: { w: number; h: number }, _tilt?: number): number {
  const rad = Math.PI / 180;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const rz = 45 * rad;
  const projW = Math.abs(w * Math.cos(rz)) + Math.abs(h * Math.sin(rz));
  // Headroom for the tallest station plus its floating label, which live above the
  // floor and would otherwise be cropped by a fit that only measured the floor.
  const projH = Math.abs(w * Math.sin(rz)) + Math.abs(h * Math.cos(rz)) + UNIT * 3;
  if (projW <= 0 || projH <= 0) return 1;
  return Math.max(0.3, Math.min(1.3, Math.min((view.w * 0.92) / projW, (view.h * 0.9) / projH)));
}
