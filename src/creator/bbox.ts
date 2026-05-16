// Bounding-box helpers for the Creator preview pane. viewBbox always
// includes X=0 in the visible region so the stitch axis stays on screen
// even when the design lives entirely on one side.

import type { Stitch } from './pipeline/stitch.js';

export interface Bbox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Tight axis-aligned bbox over an iterable of points. Returns null when
 * the iterable is empty — callers that need a sentinel for empty input
 * supply their own (see {@link xUmYumFromBbox}, which returns zero
 * dimensions, and {@link viewBbox}, which returns the seed view).
 */
export function boundsOf(points: Iterable<{ x: number; y: number }>): Bbox | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let any = false;
  for (const p of points) {
    any = true;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return any ? { minX, maxX, minY, maxY } : null;
}

/**
 * X/Y span of a bbox, scaled and rounded to integer units. Used by the
 * binary exporter, which records dimensions in µm (default 1000 µm/mm).
 */
export function xUmYumFromBbox(
  bbox: Bbox | null,
  scaleX = 1000,
  scaleY = 1000,
): { xUm: number; yUm: number } {
  if (!bbox) return { xUm: 0, yUm: 0 };
  return {
    xUm: Math.round((bbox.maxX - bbox.minX) * scaleX),
    yUm: Math.round((bbox.maxY - bbox.minY) * scaleY),
  };
}

/**
 * How far the needle has travelled from the start of a motif to its last
 * stitch, in mm. The SH7 chunk replays from wherever the needle came to
 * rest, so this is the per-repeat shift between consecutive motif copies —
 * both for the preview's repeat translation and its auto-fit math.
 */
export function motifOffsetMm(stitches: readonly Stitch[]): { dx: number; dy: number } {
  if (stitches.length < 2) return { dx: 0, dy: 0 };
  const first = stitches[0]!;
  const last = stitches[stitches.length - 1]!;
  return { dx: last.x - first.x, dy: last.y - first.y };
}

export function viewBbox(stitches: readonly Stitch[], marginMm: number): Bbox {
  const tight = boundsOf(stitches);
  // Empty stitch list → the seed view that keeps the stitch axis on screen.
  if (!tight) return { minX: -8, maxX: 8, minY: 0, maxY: 20 };
  // Always include X=0 with at least 2mm of breathing room on either side.
  const minX = Math.min(tight.minX, -2);
  const maxX = Math.max(tight.maxX, 2);
  return {
    minX: minX - marginMm,
    maxX: maxX + marginMm,
    minY: tight.minY - marginMm,
    maxY: tight.maxY + marginMm,
  };
}
