// Design envelope — the canonical predicate layer for "is this geometry
// allowable?" Pulls together the file-format caps from sh7Limits.ts, the
// active foot's mechanical bounds (slot + reach + jump caps) from foot.ts,
// and the user's hoop, and exposes them in three shapes:
//
//   • canPlace*(...)      — single-candidate predicates (returned by the
//                            click-time validators in manualStitch.ts)
//   • auditDesignBounds   — exhaustive project audit (called by the
//                            exporter before serializing)
//   • auditPerRecordEnvelope — sequence-level audit for per-record |dy|
//
// Each call returns either `{ ok: true }` or `{ ok: false, reason }`
// strings that are stable enough for tests to match on.
//
// The editor's bounds projection (liveBoundsForClick in
// ui/creator/editor/interactMath.ts) reads the same constants and foot
// fields but returns a clamping rectangle rather than a yes/no — same
// rules, different shape. Keeping it where it lives keeps the editor
// math next to its other pure helpers.

import { jumpAllowedTo, needleAllowedAt, type Foot, type FootFrame } from './foot.js';
import {
  SATIN_WIDTH_MAX_MM,
  SATIN_WIDTH_MIN_MM,
  STITCH_DY_MAX_MM,
  STITCH_DY_MAX_RAW,
} from './sh7Limits.js';
import { foot } from './foot.js';
import { rawYtoMm } from '../parser/units.js';
import type { Project } from './types.js';
import type { StitchSequence } from './pipeline/stitch.js';

export interface Hoop {
  halfW: number;
  h: number;
}

export type EnvelopeResult = { ok: true } | { ok: false; reason: string };

const EPSILON = 1e-6;

export function insideHoop(hoop: Hoop, p: { x: number; y: number }): boolean {
  return p.y >= 0 && p.y <= hoop.h && Math.abs(p.x) <= hoop.halfW;
}

/**
 * Can a needle stitch land at `candidate` given the foot frame? Checks
 * the hoop's Y bounds, the per-record |dy| envelope, and the foot's
 * mechanical slot.
 */
export function canPlaceNeedle(
  f: Foot,
  hoop: Hoop,
  frame: FootFrame,
  candidate: { x: number; y: number },
): EnvelopeResult {
  const dy = checkRecordDy(hoop, frame, candidate);
  if (!dy.ok) return dy;
  return needleAllowedAt(f, frame, candidate.x);
}

/**
 * Can a jump land at `candidate` given the foot frame? Checks the hoop's
 * Y bounds, the per-record |dy| envelope, the per-record |dxHi| ≤ 1 mm
 * jump cap, and the foot's reach.
 */
export function canPlaceJump(
  f: Foot,
  hoop: Hoop,
  frame: FootFrame,
  candidate: { x: number; y: number },
): EnvelopeResult {
  const dy = checkRecordDy(hoop, frame, candidate);
  if (!dy.ok) return dy;
  return jumpAllowedTo(f, frame, candidate.x);
}

function checkRecordDy(
  hoop: Hoop,
  frame: FootFrame,
  candidate: { x: number; y: number },
): EnvelopeResult {
  if (candidate.y < 0 || candidate.y > hoop.h) {
    return { ok: false, reason: `y=${candidate.y} is outside the hoop (0..${hoop.h})` };
  }
  const dyMm = candidate.y - frame.needleYMm;
  if (Math.abs(dyMm) - STITCH_DY_MAX_MM > EPSILON) {
    return {
      ok: false,
      reason: `dy=${dyMm.toFixed(2)} mm exceeds the firmware envelope of ${STITCH_DY_MAX_MM} mm per record`,
    };
  }
  return { ok: true };
}

/**
 * Can a satin segment span these endpoints? Pure geometry rule — no
 * foot involvement (satins lock the carriage and sweep the needle, so
 * the foot's slot doesn't apply across the cone). Checks: both spine
 * endpoints inside hoop, non-zero spine length, widths positive (use
 * {@link auditSatinWidths} for the firmware needle-window check, which
 * is run at export-time rather than click-time).
 */
export function canPlaceSatinSegment(
  hoop: Hoop,
  spineStart: { x: number; y: number },
  spineEnd: { x: number; y: number },
  widthStart: number,
  widthEnd: number,
  density: number,
): EnvelopeResult {
  if (!insideHoop(hoop, spineStart)) {
    return { ok: false, reason: 'satin spine start is outside the hoop' };
  }
  if (!insideHoop(hoop, spineEnd)) {
    return { ok: false, reason: 'satin spine end is outside the hoop' };
  }
  if (widthStart <= 0 || widthEnd <= 0) {
    return { ok: false, reason: 'satin widths must be positive' };
  }
  if (density <= 0) {
    return { ok: false, reason: 'satin density must be positive' };
  }
  if (spineStart.x === spineEnd.x && spineStart.y === spineEnd.y) {
    return { ok: false, reason: 'satin spine has zero length' };
  }
  return { ok: true };
}

/**
 * Audit the project's geometry against every rule the encoder relies on.
 * Returns an array of human-readable errors (empty on success). Run
 * before serializing — `enforceEnvelope: true` in exportProjectBinary
 * throws when this list is non-empty.
 */
export function auditDesignBounds(project: Project): string[] {
  const errors: string[] = [];
  if (project.points.length === 0) {
    errors.push('project has no points');
    return errors;
  }
  if (project.mode === 'manual') {
    if (project.manualStitches.length === 0) {
      errors.push('manual project has no stitches');
      return errors;
    }
  } else if (project.segments.length === 0) {
    errors.push('design project has no segments');
    return errors;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of project.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (project.mode === 'manual') {
    for (const m of project.manualStitches) {
      if (m.x < minX) minX = m.x;
      if (m.x > maxX) maxX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.y > maxY) maxY = m.y;
    }
  }
  const yMm = maxY - minY;
  if (yMm > 43.6) {
    errors.push(`Y dimension ${yMm.toFixed(2)} mm exceeds the 43.6 mm cap (val[2] = Y * 1.5 is BE16)`);
  }
  // X cap follows the active foot's carriage range — Foot B's 9 mm or
  // Foot S / hidden's 54.5 mm. The Foot record owns this; we just multiply.
  const xCapMm = foot(project.suggestedFoot).carriageReachHalfMm * 2;
  const xMm = maxX - minX;
  if (xMm > xCapMm) {
    errors.push(
      `X dimension ${xMm.toFixed(2)} mm exceeds the ${xCapMm} mm encoder envelope for foot ${project.suggestedFoot}`,
    );
  }
  for (let i = 0; i < project.segments.length; i++) {
    const seg = project.segments[i]!;
    if (seg.type !== 'satin') continue;
    auditSatinWidths(errors, `satin segment #${i}`, seg.widthStart, seg.widthEnd);
  }
  for (let i = 0; i < project.manualStitches.length; i++) {
    const m = project.manualStitches[i]!;
    if (m.kind !== 'satin') continue;
    auditSatinWidths(errors, `manual satin stitch #${i}`, m.widthStart, m.widthEnd);
  }
  return errors;
}

/**
 * Audit a fully-emitted StitchSequence — per-record |dy| ≤ 4 mm
 * (firmware envelope). The carriage planner and the manual validator
 * both enforce this at construction time; this audit is a postcondition.
 */
export function auditPerRecordEnvelope(seq: StitchSequence): string[] {
  const errors: string[] = [];
  for (let i = 0; i < seq.length; i++) {
    const s = seq[i]!;
    if (s.kind === 'start') continue;
    if (Math.abs(s.dyRaw) > STITCH_DY_MAX_RAW) {
      errors.push(
        `${s.kind} record #${i} has dy=${rawYtoMm(s.dyRaw).toFixed(2)} mm; exceeds the 4 mm per-record encoder envelope`,
      );
    }
  }
  return errors;
}

/**
 * Cone-width firmware-needle-window check. Pushes an error for whichever
 * of widthStart / widthEnd falls outside the empirical
 * [SATIN_WIDTH_MIN_MM, SATIN_WIDTH_MAX_MM] range from the observed NN=5
 * observed sample files.
 */
function auditSatinWidths(
  errors: string[],
  label: string,
  widthStart: number,
  widthEnd: number,
): void {
  for (const [name, value] of [['widthStart', widthStart], ['widthEnd', widthEnd]] as const) {
    if (value > SATIN_WIDTH_MAX_MM) {
      errors.push(
        `${label}: ${name} ${value} mm exceeds the ${SATIN_WIDTH_MAX_MM} mm cap (firmware needle window — cone widths greater than this render blank on the machine)`,
      );
    } else if (value < SATIN_WIDTH_MIN_MM) {
      errors.push(
        `${label}: ${name} ${value} mm is below the ${SATIN_WIDTH_MIN_MM} mm minimum (one raw stitch X unit — the .sh7 quantization floor)`,
      );
    }
  }
}
