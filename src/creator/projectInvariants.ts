// Cross-cutting project invariants enforced by the store on every state
// transition. The store calls lockFirstPoint then lockProjectInvariants
// after every reducer; together they guarantee:
//   • first point sits at X=0 (the stitch axis)
//   • mode / suggestedFoot are creation-only (rejected on same-id update)
//   • design-mode has manualStitches = []
//   • manual-mode has segments = []
//   • startXMm is frozen once a manual stitch has been placed

import type { Project } from './types.js';

export function lockFirstPoint(project: Project): Project {
  const first = project.points[0];
  if (!first || first.x === 0) return project;
  const points = project.points.slice();
  points[0] = { ...first, x: 0 };
  return { ...project, points };
}

/**
 * True when the project's start position is no longer freely moveable.
 *
 * Per-mode rule:
 *   - Design mode → never locked. The encoder re-plans from scratch on
 *     every render, so the start is a design-level knob the user can
 *     retune at any time without disturbing the authored geometry.
 *   - Manual mode → locked once at least one manual stitch exists.
 *     Each manual stitch was placed against the carriage state at the
 *     moment of placement; moving the start retroactively would shift
 *     every subsequent slot decision, invalidating the design.
 *
 * Note: the chain anchor (`points[0]`) is part of every project from
 * creation and is NOT counted as user geometry — it isn't a stitch.
 */
export function isStartLocked(project: Project): boolean {
  return project.mode === 'manual' && project.manualStitches.length > 0;
}

/**
 * Enforce the start-position rule from {@link isStartLocked} during a
 * store transition. When the project is locked and the next state is a
 * same-project mutation, revert `startXMm` to the previous value so
 * any setState that tries to move the start is silently ignored (the
 * UI drag handler relies on this — see editor/interactCallbacks.ts).
 * New project swaps (`prev.id !== next.id`) and the freely-placeable
 * states (design mode, empty manual) pass through unchanged.
 */
export function lockStartXMm(prev: Project | null, project: Project): Project {
  if (!isStartLocked(project)) return project;
  if (!prev || prev.id !== project.id) return project;
  const prevStart = prev.startXMm ?? 0;
  const nextStart = project.startXMm ?? 0;
  if (nextStart === prevStart) return project;
  return { ...project, startXMm: prevStart };
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
 * after lockFirstPoint and writes the result.
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
  p = lockStartXMm(prev, p);
  return p;
}
