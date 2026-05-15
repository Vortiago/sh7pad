// Backward-compatible facade over the design encoder. New code should call
// encodeSegments directly (or sequenceFromProject when starting from a
// Project). This wrapper keeps existing segment-only call sites working.

import type { Point, Segment } from './types.js';
import type { Foot } from './foot.js';
import { encodeSegments } from './pipeline/encodeSegments.js';
import type { StitchSequence } from './pipeline/stitch.js';

export function renderStitchPath(
  points: readonly Point[],
  segments: readonly Segment[],
  foot: Foot,
): StitchSequence {
  return encodeSegments(points, segments, foot);
}

export type { Stitch, StitchSequence } from './pipeline/stitch.js';
