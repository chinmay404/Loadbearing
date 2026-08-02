// Authoring helpers for the architectures drawn alongside a brief.
//
// Shared by the labs and by the design problems that show the system as it stands
// today, because those are the same artefact used two ways: one gets loaded onto your
// canvas, the other only gets looked at.

import type { ProblemDiagram } from '@loadbearing/shared';

/** Grid spacing, matching the blueprint library so everything looks laid out by one hand. */
export const COL = 215;
export const ROW = 125;

/**
 * Fill in what every diagram shares.
 *
 * Node annotations carry the substance — hovering a box is how you find out that the
 * cache has one key, or that the credential has no ceiling — so `annotation` is
 * required rather than optional, and this exists mostly to stop a diagram being
 * authored without a caption saying what you are looking at.
 */
export function diagram(
  caption: string,
  graph: Omit<ProblemDiagram, 'caption' | 'name'>,
): ProblemDiagram {
  return { name: caption, caption, ...graph };
}
