// Cone-edges adapters. Both authoring modes (design-mode SatinSegment +
// manual-mode ManualSatinSegment) reduce to the same SatinSpec shape
// before flowing into spineToEdges. Without these helpers every consumer
// would carry its own copy of the "filter satin, look up the spine
// endpoints, call spineToEdges" loop — designSource, multiBlockEmit, and
// the binary importer all did, with subtle differences that drifted
// over time.

import { spineToEdges, type ConeEdges, type SatinSpec } from '../shared/satinShape.js';
import type { ManualSatinSegment, Point, SatinSegment } from './types.js';

/**
 * Spine spec for a design-mode SatinSegment. Returns null when either
 * endpoint id can't be resolved against the project's points map (a
 * malformed segment — callers should skip it).
 */
export function satinSpecFromSegment(
  seg: SatinSegment,
  pointById: ReadonlyMap<string, Point>,
): SatinSpec | null {
  const from = pointById.get(seg.from);
  const to = pointById.get(seg.to);
  if (!from || !to) return null;
  return { from, to, widthStart: seg.widthStart, widthEnd: seg.widthEnd };
}

/**
 * Spine spec for a manual-mode satin record. The spine endpoints live
 * directly on the record (no project.points indirection), so this
 * always succeeds.
 */
export function satinSpecFromManual(m: ManualSatinSegment): SatinSpec {
  return {
    from: { x: m.x, y: m.y },
    to: { x: m.toX, y: m.toY },
    widthStart: m.widthStart,
    widthEnd: m.widthEnd,
  };
}

/** Convenience: SatinSegment + points map → ConeEdges, or null if malformed. */
export function coneEdgesFromSegment(
  seg: SatinSegment,
  pointById: ReadonlyMap<string, Point>,
): ConeEdges | null {
  const spec = satinSpecFromSegment(seg, pointById);
  return spec ? spineToEdges(spec) : null;
}

/** Convenience: ManualSatinSegment → ConeEdges. */
export function coneEdgesFromManual(m: ManualSatinSegment): ConeEdges {
  return spineToEdges(satinSpecFromManual(m));
}
