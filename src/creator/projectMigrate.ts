// Migration layer for projects loaded from disk / localStorage. Handles
// the long tail of older shapes — v1 hoop {w,h} → v2 {halfW, h}, missing
// satin widthStart/widthEnd, projects predating manual mode, etc. —
// then enforces the first-point-at-X=0 invariant.

import type { Point, Project, SatinSegment, Segment } from './types.js';
import { DEFAULT_FOOT_ID, NEEDLE_SLOT_HALF_MM, foot } from './foot.js';
import { clampHoopH, clampStitchY } from './sh7Limits.js';
import {
  DEFAULT_THREAD_TENSION,
  HOOP_H,
  HOOP_HALF_W,
  TENSION_MAX,
  TENSION_MIN,
} from './projectFactory.js';
import { lockFirstPoint } from './projectInvariants.js';

/**
 * Migrate a project loaded from disk/localStorage into the current shape.
 * Handles:
 *   - v1 hoop ({w, h}) → v2 hoop ({halfW, h}) + re-centering existing points
 *   - missing widthStart/widthEnd on satin segments
 *   - first-point-at-X=0 invariant
 * Idempotent: passing an already-migrated project returns an equivalent shape.
 */
export function migrateProject(project: Project): Project {
  let p = project;

  // Fill missing or unrecognized suggestedFoot; clamp tension.
  const rawFoot = p.suggestedFoot as unknown as string | undefined;
  if (rawFoot !== 'B' && rawFoot !== 'S' && rawFoot !== 'hidden') {
    p = { ...p, suggestedFoot: DEFAULT_FOOT_ID };
  }

  // Default new fields for projects predating manual mode. Older projects
  // are always design-mode with no manual stitches.
  if (p.mode !== 'manual' && p.mode !== 'design') {
    p = { ...p, mode: 'design' };
  }
  if (!Array.isArray(p.manualStitches)) {
    p = { ...p, manualStitches: [] };
  }
  if (typeof p.startXMm !== 'number' || Number.isNaN(p.startXMm)) {
    p = { ...p, startXMm: 0 };
  }
  // Clamp legacy Carriage Start to ±NEEDLE_SLOT_HALF_MM so a project
  // saved with startXMm at e.g. +12mm (legal in the old model, illegal
  // in the new eye-constraint model) loads cleanly.
  const reachHalf = foot(p.suggestedFoot).carriageReachHalfMm;
  const clampedStart = Math.min(NEEDLE_SLOT_HALF_MM, Math.max(-NEEDLE_SLOT_HALF_MM, p.startXMm ?? 0));
  if ((p.startXMm ?? 0) !== clampedStart) {
    p = { ...p, startXMm: Math.min(reachHalf, Math.max(-reachHalf, clampedStart)) };
  }
  // Synthesize the Start Stitch at (0, 0) for legacy projects — the
  // old `lockFirstPoint` always pinned points[0].x to 0, so the
  // canonical Start Stitch X is 0 by construction. The hoop-rewrite
  // step below may shift points[0] off-zero (via re-centering); the
  // final lockFirstPoint pass at the end of this function snaps
  // points[0] back to the canonical Start Stitch position.
  if (!p.startStitch || typeof p.startStitch.x !== 'number' || Number.isNaN(p.startStitch.x)) {
    p = { ...p, startStitch: { x: 0 } };
  }
  if (typeof p.threadTension !== 'number' || Number.isNaN(p.threadTension)) {
    p = { ...p, threadTension: DEFAULT_THREAD_TENSION };
  } else if (p.threadTension < TENSION_MIN || p.threadTension > TENSION_MAX) {
    p = { ...p, threadTension: Math.min(TENSION_MAX, Math.max(TENSION_MIN, p.threadTension)) };
  }

  // Convert v1 hoop {w} into centered {halfW}.
  const hoop = p.hoop as unknown as { w?: number; halfW?: number; h?: number };
  if (typeof hoop.halfW !== 'number') {
    const oldW = typeof hoop.w === 'number' ? hoop.w : HOOP_HALF_W * 2;
    const halfW = oldW / 2;
    const h = typeof hoop.h === 'number' ? hoop.h : HOOP_H;
    const recentered: Point[] = (p.points ?? []).map((pt) => ({
      ...pt,
      x: (pt.x ?? 0) - halfW,
      y: pt.y ?? 0,
    }));
    p = { ...p, hoop: { halfW, h }, points: recentered };
  }

  // Clamp hoop.h to the .sh7 file-format limit (43.69 mm); points beyond
  // the new hoop edge get pulled in so existing projects don't ship with
  // out-of-bounds geometry that would fail to export.
  const clampedH = clampHoopH(p.hoop.h);
  if (clampedH !== p.hoop.h) {
    p = {
      ...p,
      hoop: { ...p.hoop, h: clampedH },
      points: p.points.map((pt) => ({ ...pt, y: clampStitchY(pt.y, clampedH) })),
    };
  }

  // Migrate segments: ensure satin has widthStart/widthEnd/density.
  const segments: Segment[] = (p.segments ?? []).map((s) => migrateSegment(s));
  p = { ...p, segments };

  // Always finish with the first-point-at-X=0 lock.
  p = lockFirstPoint(p);
  return p;
}

function migrateSegment(seg: Segment): Segment {
  if (seg.type !== 'satin') return seg;
  const sat = seg as SatinSegment & { width?: number };
  if (
    typeof sat.widthStart === 'number' &&
    typeof sat.widthEnd === 'number' &&
    typeof sat.density === 'number'
  ) {
    return sat;
  }
  const fallback = typeof sat.width === 'number' ? sat.width : 2.4;
  return {
    id: sat.id,
    from: sat.from,
    to: sat.to,
    type: 'satin',
    widthStart: typeof sat.widthStart === 'number' ? sat.widthStart : fallback,
    widthEnd: typeof sat.widthEnd === 'number' ? sat.widthEnd : fallback,
    density: typeof sat.density === 'number' ? sat.density : 0.6,
    ...(sat.imported ? { imported: true } : {}),
  };
}
