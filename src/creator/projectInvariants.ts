// Cross-cutting project invariants enforced by the store on every state
// transition. lockProjectInvariants composes clampStartStateToEye then
// lockStartXMm then lockFirstPoint; together they guarantee:
//   • Carriage Start and Start Stitch stay inside foot reach + eye edge
//   • mode / suggestedFoot are creation-only (rejected on same-id update)
//   • design-mode has manualStitches = []
//   • manual-mode has segments = []
//   • startXMm and startStitch are frozen once a manual stitch has been placed
//   • points[0] mirrors the Start Stitch position (synthetic anchor)

import type { Project } from './types.js';
import { NEEDLE_SLOT_HALF_MM, foot } from './foot.js';
import { startStitchOf } from './projectFactory.js';

/**
 * Sync `points[0]` to the canonical **Start Stitch** (X mirrors
 * `startStitch.x`; Y forced to 0). `points[0]` survives as a synthetic
 * mirror so the existing segment-from-id machinery keeps working —
 * segments referencing `points[0].id` continue to resolve, and the
 * first user-placed Segment's `from` is still `points[0].id`.
 *
 * Replaces the legacy x=0 invariant; the eye constraint is enforced
 * separately by {@link clampStartStateToEye}.
 */
export function lockFirstPoint(project: Project): Project {
  const first = project.points[0];
  if (!first) return project;
  const startX = startStitchOf(project).x;
  if (first.x === startX && first.y === 0) return project;
  const points = project.points.slice();
  points[0] = { ...first, x: startX, y: 0 };
  return { ...project, points };
}

/**
 * True when the project's start position is no longer freely moveable.
 *
 * Per-mode rule:
 *   - Design mode → never locked. The encoder re-plans from scratch on
 *     every render, so both the Carriage Start and the Start Stitch
 *     can be retuned at any time without disturbing authored geometry.
 *   - Manual mode → locked once at least one user-placed manual stitch
 *     exists. Each stitch was placed against the foot frame at the
 *     moment of placement; moving the start retroactively would shift
 *     every downstream slot decision, invalidating the design.
 */
export function isStartLocked(project: Project): boolean {
  return project.mode === 'manual' && project.manualStitches.length > 0;
}

/**
 * Enforce the Start Lock during a store transition. When the project
 * is locked and the next state is a same-project mutation, revert
 * both `startXMm` (the **Carriage Start**) and `startStitch` to the
 * previous values so any setState that tries to move either is
 * silently ignored. New project swaps and the freely-placeable
 * states pass through unchanged.
 */
function lockStartXMm(prev: Project | null, project: Project): Project {
  if (!isStartLocked(project)) return project;
  if (!prev || prev.id !== project.id) return project;
  const prevCarriage = prev.startXMm ?? 0;
  const nextCarriage = project.startXMm ?? 0;
  const prevStitch = startStitchOf(prev).x;
  const nextStitch = startStitchOf(project).x;
  if (nextCarriage === prevCarriage && nextStitch === prevStitch) return project;
  return {
    ...project,
    startXMm: prevCarriage,
    startStitch: { x: prevStitch },
  };
}

/**
 * Enforce the eye + reach invariants on **Carriage Start** and
 * **Start Stitch** as a store invariant. Behaviour matches the
 * grilling-locked rules:
 *
 *   • Carriage drag: when only `startXMm` moved (same-project), the
 *     Start Stitch drags along by the same delta (preserves its
 *     eye-relative offset).
 *   • Start Stitch drag: when only `startStitch.x` moved, it is
 *     hard-stopped at the Eye edge relative to the (unchanged)
 *     carriage.
 *   • First-load / migration / new project: each field is individually
 *     clamped to its valid range.
 */
export function clampStartStateToEye(prev: Project | null, project: Project): Project {
  const reachHalf = foot(project.suggestedFoot).carriageReachHalfMm;
  const sameProject = prev && prev.id === project.id;
  const prevCarriage = sameProject ? (prev.startXMm ?? 0) : null;
  const prevStitch = sameProject ? startStitchOf(prev).x : null;

  let nextCarriage = clampToRange(project.startXMm ?? 0, reachHalf);
  let nextStitch = project.startStitch?.x ?? project.points[0]?.x ?? 0;

  // Drag-along: a same-project carriage move slides the Start Stitch
  // with it unless the caller already adjusted both fields.
  if (prevCarriage !== null && prevStitch !== null) {
    const carriageDelta = nextCarriage - prevCarriage;
    const stitchDelta = nextStitch - prevStitch;
    if (carriageDelta !== 0 && stitchDelta === 0) {
      nextStitch = prevStitch + carriageDelta;
    }
  }

  // Hard-stop the Start Stitch at the Eye edge.
  nextStitch = clampToRange(nextStitch - nextCarriage, NEEDLE_SLOT_HALF_MM) + nextCarriage;

  if (
    (project.startXMm ?? 0) === nextCarriage &&
    (project.startStitch?.x ?? project.points[0]?.x ?? 0) === nextStitch
  ) {
    return project;
  }
  return { ...project, startXMm: nextCarriage, startStitch: { x: nextStitch } };
}

function clampToRange(value: number, halfRange: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(halfRange, Math.max(-halfRange, value));
}

/**
 * Enforce the cross-cutting invariants every store update has to honour:
 *
 *   • `mode` and `suggestedFoot` are creation-only. Any next state that
 *     differs on those fields is rejected — we keep the prior values.
 *   • In design mode, manualStitches must be empty.
 *   • In manual mode, segments must be empty (the chain anchor in points
 *     is allowed; user-authored points are not).
 *
 * Returns a Project with the violating fields reverted to the prior
 * state's values where applicable. Pure function — store calls this
 * and writes the result.
 */
export function lockProjectInvariants(prev: Project | null, next: Project): Project {
  let p = next;
  // Only enforce mode/foot immutability for in-place updates of the same
  // project. setState(otherProject) — used when the user switches the
  // active project in the sidebar — must not be reverted; that's a swap,
  // not a mutation.
  if (prev && prev.id === next.id) {
    if (p.mode !== prev.mode) {
      p = { ...p, mode: prev.mode };
    }
    if (p.suggestedFoot !== prev.suggestedFoot) {
      p = { ...p, suggestedFoot: prev.suggestedFoot };
    }
  }
  if (p.mode === 'design' && p.manualStitches.length > 0) {
    p = { ...p, manualStitches: [] };
  }
  if (p.mode === 'manual' && p.segments.length > 0) {
    p = { ...p, segments: [] };
  }
  // Order matters: clamp first (enforces eye + reach + drag coupling),
  // then lock (freezes both fields in manual mode after first user
  // stitch), then sync points[0] to the resolved Start Stitch position.
  p = clampStartStateToEye(prev, p);
  p = lockStartXMm(prev, p);
  p = lockFirstPoint(p);
  return p;
}
