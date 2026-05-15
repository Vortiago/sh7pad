// Builds the InteractionCallbacks bag for createEditorInteract — the
// long inline object that forwards pointer-driven intents (add point,
// select, move, hover, pan, bg drag) into projectStore + uiStore mutations.
// Pulled out of editor/index.ts so the orchestrator stays small.
//
// Add-point dispatch (design vs manual, needle/jump/satin/straight) lives
// in `creator/placementIntent.ts`. This file constructs a PlacementIntent
// from the click + tool kind and applies the result; the two-click
// manual-satin gesture state lives here because it's a UI concern (the
// half-staged spine is canceled by switching tools).

import { newPointId, newSegmentId } from '../../../creator/ids.js';
import { movePointPreservingSatinSpines, moveBgImage } from '../../../creator/project.js';
import { applyPlacement, type PlacementIntent } from '../../../creator/placementIntent.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';
import type { InteractionCallbacks } from './interact.js';
import type { StitchKind } from '../toolbar/index.js';
import { computeView } from './view.js';

export interface InteractCallbackDeps {
  projectStore: ProjectStore;
  uiStore: UiStore;
  edCanvasWrap: HTMLElement;
}

export function buildInteractCallbacks(deps: InteractCallbackDeps): InteractionCallbacks {
  const { projectStore, uiStore, edCanvasWrap } = deps;
  return {
    getView: () => {
      const ui = uiStore.getState();
      return computeView(ui.containerSize, projectStore.getState().hoop, ui.userZoom, ui.pan);
    },
    getProject: () => projectStore.getState(),
    onAddPoint: (point, kind) => {
      const intent = buildPlacementIntent(projectStore.getState(), uiStore, point, kind);
      if (intent == null) return;
      const result = applyPlacement(projectStore.getState(), intent);
      if (result.selection) uiStore.update({ selection: result.selection });
      projectStore.setState(() => result.project);
    },
    onSelectPoint: (id) => {
      uiStore.update({ selection: { kind: 'point', id } });
    },
    onMovePoint: (id, point) => {
      projectStore.setState((p) => movePointPreservingSatinSpines(p, id, point));
    },
    onSelectSegment: (id) => {
      uiStore.update({ selection: { kind: 'segment', id } });
    },
    onHover: (point) => {
      // Preserve the last validity flag (set by onHoverValidity) so the
      // renderer can paint the rejected-affordance glyph at the cursor.
      const ui = uiStore.getState();
      uiStore.update({ hover: point ? { ...point, valid: ui.hoverValid } : null });
    },
    onHoverValidity: (valid) => {
      const ui = uiStore.getState();
      uiStore.update({
        hoverValid: valid,
        hover: ui.hover ? { ...ui.hover, valid } : ui.hover,
      });
      // Render-side hint for CSS selectors. Synchronous so the cursor
      // affordance updates immediately, before the SVG repaint microtask.
      edCanvasWrap.dataset['hoverValid'] = valid ? 'true' : 'false';
    },
    onPan: (dx, dy) => {
      const ui = uiStore.getState();
      uiStore.update({ pan: { x: ui.pan.x + dx, y: ui.pan.y + dy } });
    },
    onBgMove: (dxMm, dyMm) => {
      projectStore.setState((p) => moveBgImage(p, dxMm, dyMm));
    },
    onMoveStart: (xMm) => {
      // The store invariant (lockStartXMm via lockProjectInvariants)
      // clamps the new value to ±NEEDLE_SLOT_HALF_MM of the chain
      // anchor once geometry exists — no clamp needed at this layer.
      projectStore.setState((p) => ({ ...p, startXMm: xMm, updatedAt: Date.now() }));
    },
  };
}

/**
 * Turn a click + tool kind into a {@link PlacementIntent}. Returns null
 * when the click is a gesture step that produces no domain mutation
 * (the first half of a two-click manual-satin) or when the kind doesn't
 * apply in the current mode (defensive — the toolbar shouldn't surface
 * mismatched kinds).
 *
 * Side effect: updates `uiStore.pendingManualSatinStart` to drive the
 * two-click gesture. Clears it on every non-satin click.
 */
function buildPlacementIntent(
  project: import('../../../creator/types.js').Project,
  uiStore: UiStore,
  point: { x: number; y: number },
  kind: StitchKind,
): PlacementIntent | null {
  if (project.mode === 'manual') {
    if (kind === 'needle' || kind === 'jump') {
      uiStore.update({ pendingManualSatinStart: null });
      return { kind: kind === 'needle' ? 'manual-needle' : 'manual-jump', point };
    }
    if (kind === 'satin') {
      const pending = uiStore.getState().pendingManualSatinStart;
      if (pending == null) {
        uiStore.update({ pendingManualSatinStart: { x: point.x, y: point.y } });
        return null;
      }
      uiStore.update({ pendingManualSatinStart: null });
      return { kind: 'manual-satin', spineStart: pending, spineEnd: point };
    }
    return null;
  }
  // Design mode: chain-append. Needle / jump kinds shouldn't reach here
  // (toolbar doesn't surface them in design mode), so refuse them.
  if (kind !== 'straight' && kind !== 'satin') return null;
  return {
    kind: 'design-add',
    segmentKind: kind,
    point,
    ids: { pointId: newPointId(), segmentId: newSegmentId() },
  };
}
