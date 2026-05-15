// Manual-mode stitch reducers + validation.
//
// In manual mode the user clicks to place individual needle/jump stitches.
// Each insertion is validated against the current foot frame so the UI
// can never write a stitch the machine couldn't actually sew. The
// allowability rules (hoop bounds, per-record |dy| cap, foot slot/reach)
// live in `designEnvelope.ts`; this module composes them with the
// reducer plumbing (frame snapshot, raw-delta computation, immutable
// project update).
//
// The carriage frame for the current state is derived by walking the
// existing manualStitches with trackFoot; the same module the preview /
// editor use, so the gating UI is provably consistent with playback.

import type { ManualStitchInput, Project } from './types.js';
import type { SatinEndAt } from '../shared/satinShape.js';
import { sequenceFromProject } from './pipeline/encodeDesign.js';
import { trackFoot } from './pipeline/trackFoot.js';
import { foot, type FootFrame } from './foot.js';
import { canPlaceJump, canPlaceNeedle, canPlaceSatinSegment } from './designEnvelope.js';
import { X_UNITS_PER_MM, Y_UNITS_PER_MM } from '../parser/units.js';

export interface ManualStitchCandidate {
  kind: 'needle' | 'jump';
  /** Absolute needle X in mm. */
  x: number;
  /** Absolute needle Y in mm. */
  y: number;
}

export interface ManualSatinCandidate {
  /** Spine start (= chain anchor before the satin). */
  x: number;
  y: number;
  /** Spine end. */
  toX: number;
  toY: number;
  /** Defaults applied by the UI; spelled here to keep the reducer pure. */
  widthStart: number;
  widthEnd: number;
  density: number;
}

/** Editable fields of a {@link ManualSatinSegment}, mirroring the shape
 *  the design-mode SatinSegment inspector emits. */
export interface ManualSatinPatch {
  widthStart?: number;
  widthEnd?: number;
  density?: number;
  endAt?: SatinEndAt;
}

export type ManualStitchValidation =
  | { ok: true; stitch: ManualStitchInput }
  | { ok: false; reason: string };

/**
 * Compute the foot frame in effect after the project's current
 * manualStitches have all been laid down. The next manual stitch is
 * validated against this frame.
 */
export function currentManualFrame(project: Project): FootFrame {
  const start = project.points[0] ?? { x: 0, y: 0 };
  const seq = sequenceFromProject(project);
  const track = trackFoot(seq);
  return track[track.length - 1] ?? {
    carriageXMm: 0,
    needleXMm: start.x,
    needleYMm: start.y,
  };
}

export function validateManualStitch(
  project: Project,
  candidate: ManualStitchCandidate,
): ManualStitchValidation {
  if (project.mode !== 'manual') {
    return { ok: false, reason: 'project is not in manual mode' };
  }
  const f = foot(project.suggestedFoot);
  const frame = currentManualFrame(project);
  const v = candidate.kind === 'needle'
    ? canPlaceNeedle(f, project.hoop, frame, candidate)
    : canPlaceJump(f, project.hoop, frame, candidate);
  if (!v.ok) return v;
  const dxRaw = Math.round((candidate.x - frame.needleXMm) * X_UNITS_PER_MM);
  const dyRaw = Math.round((candidate.y - frame.needleYMm) * Y_UNITS_PER_MM);
  return {
    ok: true,
    stitch: { kind: candidate.kind, x: candidate.x, y: candidate.y, dxRaw, dyRaw },
  };
}

export function addManualStitch(
  project: Project,
  candidate: ManualStitchCandidate,
  now: number = Date.now(),
): Project {
  const v = validateManualStitch(project, candidate);
  if (!v.ok) return project;
  return {
    ...project,
    manualStitches: [...project.manualStitches, v.stitch],
    updatedAt: now,
  };
}

/**
 * Add a satin segment to a manual project. Validates that both spine
 * endpoints sit inside the hoop, that the spine has non-zero length, and
 * that widths and density are positive; returns the project unchanged
 * otherwise. The satin's chain advance (to the cone's BR corner) is
 * computed at encode time, not stored here.
 */
export function addManualSatinSegment(
  project: Project,
  candidate: ManualSatinCandidate,
  now: number = Date.now(),
): Project {
  if (project.mode !== 'manual') return project;
  const v = canPlaceSatinSegment(
    project.hoop,
    { x: candidate.x, y: candidate.y },
    { x: candidate.toX, y: candidate.toY },
    candidate.widthStart,
    candidate.widthEnd,
    candidate.density,
  );
  if (!v.ok) return project;
  return {
    ...project,
    manualStitches: [
      ...project.manualStitches,
      {
        kind: 'satin',
        x: candidate.x,
        y: candidate.y,
        toX: candidate.toX,
        toY: candidate.toY,
        widthStart: candidate.widthStart,
        widthEnd: candidate.widthEnd,
        density: candidate.density,
      },
    ],
    updatedAt: now,
  };
}

/**
 * Patch a manual-mode satin segment at index `idx`. Returns the project
 * unchanged when the index is out of range or points at a non-satin
 * entry. Mirrors `updateSegment` in project.ts, deliberately matching
 * its behaviour: width / density clamping is the inspector slider's
 * responsibility (SATIN_WIDTH_MIN_MM / MAX_MM bounds), keeping the
 * reducer pure and consistent across authoring paths.
 */
export function updateManualSatin(
  project: Project,
  idx: number,
  patch: ManualSatinPatch,
  now: number = Date.now(),
): Project {
  const current = project.manualStitches[idx];
  if (!current || current.kind !== 'satin') return project;
  const stitches = project.manualStitches.slice();
  stitches[idx] = { ...current, ...patch };
  return { ...project, manualStitches: stitches, updatedAt: now };
}

export function removeLastManualStitch(project: Project, now: number = Date.now()): Project {
  if (project.manualStitches.length === 0) return project;
  return {
    ...project,
    manualStitches: project.manualStitches.slice(0, -1),
    updatedAt: now,
  };
}

export function replaceManualStitches(
  project: Project,
  next: readonly ManualStitchInput[],
  now: number = Date.now(),
): Project {
  return {
    ...project,
    manualStitches: next.slice(),
    updatedAt: now,
  };
}
