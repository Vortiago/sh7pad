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

export const EMPTY_VIEW_BBOX: Bbox = { minX: -8, maxX: 8, minY: 0, maxY: 20 };

export function stitchesBbox(stitches: readonly Stitch[]): Bbox {
  if (stitches.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of stitches) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return { minX, maxX, minY, maxY };
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
  if (stitches.length === 0) return { ...EMPTY_VIEW_BBOX };
  const tight = stitchesBbox(stitches);
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
