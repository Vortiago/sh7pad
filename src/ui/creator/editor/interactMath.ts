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
 */
export function liveBoundsForClick(
  project: Project,
  activeStitch: StitchKind,
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const halfW = project.hoop.halfW;
  const H = project.hoop.h;
  const f = foot(project.suggestedFoot);
  if (project.mode === 'manual') {
    const frame = currentManualFrame(project);
    const half =
      activeStitch === 'jump' ? PER_RECORD_JUMP_CAP_MM : f.needleSlotHalfMm;
    const center = activeStitch === 'jump' ? frame.needleXMm : frame.carriageXMm;
    return {
      xMin: Math.max(-halfW, center - half),
      xMax: Math.min(halfW, center + half),
      yMin: Math.max(0, frame.needleYMm - STITCH_DY_MAX_MM),
      yMax: Math.min(H, frame.needleYMm + STITCH_DY_MAX_MM),
    };
  }
  const eff = f.carriageReachHalfMm;
  const effLim = Math.min(eff, halfW);
  return { xMin: -effLim, xMax: effLim, yMin: 0, yMax: H };
}
