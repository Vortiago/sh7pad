// Pure interaction-math helpers for the editor canvas: client→hoop
// coord conversion, clamping into hoop bounds, deciding whether a
// pointer event should pan or use the active tool, and computing
// the live click-window for manual mode. No DOM, no state — these
// are unit-tested directly.

import { foot } from '../../../creator/foot.js';
import { PER_RECORD_JUMP_CAP_MM, STITCH_DY_MAX_MM } from '../../../creator/sh7Limits.js';
import { currentManualFrame } from '../../../creator/manualStitch.js';
import type { Project } from '../../../creator/types.js';
import type { View } from './view.js';
import type { StitchKind } from '../toolbar/index.js';

export type Tool = 'select' | 'add' | 'move' | 'pan';
export type PointerAction = 'select' | 'add' | 'move' | 'pan';

export interface PointerInfo {
  clientX: number;
  clientY: number;
}

export interface PointerEventInfo {
  button: number;
  altKey: boolean;
}

export interface HoopPoint {
  x: number;
  y: number;
}

export function hoopFromClient(p: PointerInfo, rect: DOMRect, view: View): HoopPoint {
  const x = (p.clientX - rect.left - view.offsetX) / view.zoom;
  const y = (p.clientY - rect.top - view.offsetY) / view.zoom;
  return { x, y };
}

export function clampToHoopAndLimit(
  pt: HoopPoint,
  bounds: { effLim: number; H: number },
): HoopPoint {
  return {
    x: Math.max(-bounds.effLim, Math.min(bounds.effLim, pt.x)),
    y: Math.max(0, Math.min(bounds.H, pt.y)),
  };
}

export function determineActionFromPointer(e: PointerEventInfo, tool: Tool): PointerAction {
  if (e.button === 1 || e.button === 2 || e.altKey) return 'pan';
  return tool;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface LiveWindowGeometry extends Bounds {
  /** Center X of the band (carriageX for needle, needleX for jump). */
  center: number;
  /** Half-width of the band before hoop clipping. */
  half: number;
}

export function isInsideBounds(b: Bounds, p: HoopPoint): boolean {
  return p.x >= b.xMin && p.x <= b.xMax && p.y >= b.yMin && p.y <= b.yMax;
}

/**
 * Geometry of the live needle / jump window in manual mode. Returns
 * null when the project is in design mode or the stitch kind doesn't
 * have a band (the toolbar's 'straight' / 'satin' kinds). The (center,
 * half) values let the renderer draw the band; the (xMin, xMax, yMin,
 * yMax) values are the same band clipped to the hoop, which the click
 * handler uses to gate placement. Keeping both in one return value
 * keeps the band-drawing and the click-gate locked together.
 */
export function liveWindowGeometry(
  project: Project,
  activeStitch: StitchKind,
): LiveWindowGeometry | null {
  if (project.mode !== 'manual') return null;
  if (activeStitch !== 'needle' && activeStitch !== 'jump') return null;
  const halfW = project.hoop.halfW;
  const H = project.hoop.h;
  const f = foot(project.suggestedFoot);
  const frame = currentManualFrame(project);
  const half = activeStitch === 'jump' ? PER_RECORD_JUMP_CAP_MM : f.needleSlotHalfMm;
  const center = activeStitch === 'jump' ? frame.needleXMm : frame.carriageXMm;
  return {
    center,
    half,
    xMin: Math.max(-halfW, center - half),
    xMax: Math.min(halfW, center + half),
    yMin: Math.max(0, frame.needleYMm - STITCH_DY_MAX_MM),
    yMax: Math.min(H, frame.needleYMm + STITCH_DY_MAX_MM),
  };
}

/**
 * Inclusive (xMin, xMax, yMin, yMax) bounds for the next click in mm
 * (hoop coordinates). For manual mode the X bounds reflect the live
 * carriage window for needle stitches, or the ±1 mm jump envelope for
 * jumps; the Y bounds reflect the per-record firmware Y envelope
 * (±STITCH_DY_MAX_MM around the current needle Y, foot- and kind-
 * agnostic), clipped to the hoop. The validator inside addManualStitch
 * still has the final say, but pre-checking here lets the click handler
 * reject silently and the hover handler flip the cursor without touching
 * the store.
 *
 * Manual+needle/jump cases delegate to liveWindowGeometry so the editor
 * overlay (render.ts) and the click gate (interact.ts) cannot drift.
 */
export function liveBoundsForClick(project: Project, activeStitch: StitchKind): Bounds {
  const geom = liveWindowGeometry(project, activeStitch);
  if (geom) return { xMin: geom.xMin, xMax: geom.xMax, yMin: geom.yMin, yMax: geom.yMax };
  if (project.mode === 'manual') {
    // Manual mode but a kind that has no band (straight / satin from
    // the toolbar). Fall back to the carriage's needle slot so the
    // click pre-check matches the firmware envelope.
    const halfW = project.hoop.halfW;
    const H = project.hoop.h;
    const f = foot(project.suggestedFoot);
    const frame = currentManualFrame(project);
    return {
      xMin: Math.max(-halfW, frame.carriageXMm - f.needleSlotHalfMm),
      xMax: Math.min(halfW, frame.carriageXMm + f.needleSlotHalfMm),
      yMin: Math.max(0, frame.needleYMm - STITCH_DY_MAX_MM),
      yMax: Math.min(H, frame.needleYMm + STITCH_DY_MAX_MM),
    };
  }
  const halfW = project.hoop.halfW;
  const H = project.hoop.h;
  const f = foot(project.suggestedFoot);
  const effLim = Math.min(f.carriageReachHalfMm, halfW);
  return { xMin: -effLim, xMax: effLim, yMin: 0, yMax: H };
}
