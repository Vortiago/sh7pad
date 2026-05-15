// PlacementIntent — the editor's single seam for "the user wants to add
// geometry to the project." Captures the four placement shapes the
// editor produces (design-mode chain append, manual-mode needle/jump,
// manual-mode satin segment) under one discriminated union, and routes
// each to the underlying reducer in project.ts / manualStitch.ts.
//
// Why a single seam:
//   • The reducers live across two files (project.ts for design-mode
//     chain mutation; manualStitch.ts for manual-mode placement) and the
//     editor's onAddPoint callback used to dispatch on (project.mode,
//     kind) inline. To answer "what happens when the user clicks Satin
//     in manual mode?" you had to read interactCallbacks.ts AND
//     manualStitch.ts AND foot.ts. Now the dispatch lives here.
//   • The result type also surfaces the selection a placement produces
//     (a fresh segment becomes the active selection) so the UI doesn't
//     have to know how to compute that itself.
//
// What's still UI-level:
//   • The two-click manual-satin gesture. The first click stages a
//     spine start in uiStore.pendingManualSatinStart; only the second
//     click constructs a `manual-satin` intent. That gesture state is
//     UI concern (the user might switch tools mid-stage and cancel),
//     so PlacementIntent always represents a complete intent.
//   • Whether to even invoke a placement (the editor gates clicks
//     through liveBoundsForClick first).

import {
  DEFAULT_SATIN_DENSITY_MM,
  DEFAULT_SATIN_WIDTH_MM,
  addPointToProject,
} from './project.js';
import { addManualSatinSegment, addManualStitch } from './manualStitch.js';
import type { Project } from './types.js';

export interface DesignAddIntent {
  kind: 'design-add';
  segmentKind: 'straight' | 'satin';
  point: { x: number; y: number };
  /**
   * Caller-provided IDs for the new point and segment. The reducer
   * accepts an id-gen at construction; passing IDs in here makes the
   * placement deterministic (replay, undo, tests) and lets the UI
   * select the newly-created segment without round-tripping through
   * the reducer.
   */
  ids: { pointId: string; segmentId: string };
}

export interface ManualNeedleIntent {
  kind: 'manual-needle';
  point: { x: number; y: number };
}

export interface ManualJumpIntent {
  kind: 'manual-jump';
  point: { x: number; y: number };
}

export interface ManualSatinIntent {
  kind: 'manual-satin';
  spineStart: { x: number; y: number };
  spineEnd: { x: number; y: number };
  /** Defaults to {@link DEFAULT_SATIN_WIDTH_MM} if omitted. */
  widthStart?: number;
  /** Defaults to {@link DEFAULT_SATIN_WIDTH_MM} if omitted. */
  widthEnd?: number;
  /** Defaults to {@link DEFAULT_SATIN_DENSITY_MM} if omitted. */
  density?: number;
}

export type PlacementIntent =
  | DesignAddIntent
  | ManualNeedleIntent
  | ManualJumpIntent
  | ManualSatinIntent;

/**
 * Selection shape carried back to the UI when a placement creates a
 * new selectable entity. Kept structural so this module doesn't depend
 * on ui store types — the editor lifts it into `Selection` directly.
 */
export type CreatedSelection =
  | { kind: 'segment'; id: string }
  | { kind: 'point'; id: string }
  | { kind: 'manual-satin'; idx: number };

export interface PlacementResult {
  /** Next project state. Reference-equal to input when the placement
   *  was a no-op (out-of-mode intent, refused by the envelope, etc.). */
  project: Project;
  /** Selection patch to apply, or undefined to leave selection alone. */
  selection?: CreatedSelection;
}

/**
 * Apply a placement intent to the project. Rejection (mode mismatch or
 * envelope refusal) is signalled by returning the same `project`
 * reference; callers can compare with `===` to detect a no-op.
 *
 * Validation of the candidate (foot slot, hoop bounds, per-record dy)
 * happens inside the underlying reducers — `addManualStitch` calls
 * `validateManualStitch` which threads through `designEnvelope.ts`.
 * Design-mode `addPointToProject` clamps Y rather than refusing, by
 * design-mode UX convention.
 */
export function applyPlacement(project: Project, intent: PlacementIntent): PlacementResult {
  switch (intent.kind) {
    case 'design-add':
      if (project.mode !== 'design') return { project };
      return {
        project: addPointToProject(project, intent.point, intent.segmentKind, intent.ids),
        // Only surface a selection for the new segment if a segment was
        // actually created (the very first design click adds a lone point
        // with no incoming segment).
        selection:
          project.points.length > 0
            ? { kind: 'segment', id: intent.ids.segmentId }
            : undefined,
      };
    case 'manual-needle':
    case 'manual-jump':
      if (project.mode !== 'manual') return { project };
      return {
        project: addManualStitch(project, {
          kind: intent.kind === 'manual-needle' ? 'needle' : 'jump',
          x: intent.point.x,
          y: intent.point.y,
        }),
      };
    case 'manual-satin':
      if (project.mode !== 'manual') return { project };
      return {
        project: addManualSatinSegment(project, {
          x: intent.spineStart.x,
          y: intent.spineStart.y,
          toX: intent.spineEnd.x,
          toY: intent.spineEnd.y,
          widthStart: intent.widthStart ?? DEFAULT_SATIN_WIDTH_MM,
          widthEnd: intent.widthEnd ?? DEFAULT_SATIN_WIDTH_MM,
          density: intent.density ?? DEFAULT_SATIN_DENSITY_MM,
        }),
      };
  }
}
