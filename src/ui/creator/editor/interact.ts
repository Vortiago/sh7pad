// Editor interaction layer: pointer events on the SVG → callbacks the
// orchestrator uses to mutate the project store.
//
// Pure helpers (hoopFromClient, clampToHoopAndLimit,
// determineActionFromPointer, liveBoundsForClick) plus the small
// PointerInfo / HoopPoint / Tool types live in ./interactMath.ts so
// this file stays focused on the stateful event-attach lifecycle.
//
// Tool semantics:
//   - 'add': click on empty canvas adds a new point + segment to the chain
//   - 'move': click+drag on a point moves it; clicking a segment selects it
//   - 'pan': click+drag pans the canvas (cursor: grab)
// Modifier shortcuts (work regardless of tool):
//   - middle button, right button, Alt+drag → pan

import { foot } from '../../../creator/foot.js';
import type { Project } from '../../../creator/types.js';
import type { View } from './view.js';
import type { StitchKind } from '../toolbar/index.js';
import {
  clampToHoopAndLimit,
  determineActionFromPointer,
  hoopFromClient,
  isInsideBounds,
  liveBoundsForClick,
  type HoopPoint,
  type Tool,
} from './interactMath.js';

export type {
  HoopPoint,
  PointerAction,
  PointerEventInfo,
  PointerInfo,
  Tool,
} from './interactMath.js';
export {
  clampToHoopAndLimit,
  determineActionFromPointer,
  hoopFromClient,
  liveBoundsForClick,
} from './interactMath.js';

export interface InteractionCallbacks {
  getView(): View;
  getProject(): Project;
  onAddPoint(point: HoopPoint, activeStitch: StitchKind): void;
  onSelectPoint(pointId: string): void;
  onMovePoint(pointId: string, point: HoopPoint): void;
  onSelectSegment(segmentId: string): void;
  onHover(point: HoopPoint | null): void;
  /**
   * Live-window validity signal for manual mode. Fires on every hover
   * pointermove with `true` if the cursor is inside the active live
   * window (carriage ± 3 mm for needle, last needle ± 1 mm for jump),
   * `false` otherwise. Design-mode projects never fire this — keep the
   * manual-mode-only invariant in the call sites.
   */
  onHoverValidity?(valid: boolean): void;
  onPan?(dx: number, dy: number): void;
  /** Drag delta in mm for the background image. */
  onBgMove?(dxMm: number, dyMm: number): void;
  /** New project.startXMm (mm) for the start marker drag. The store
   *  invariant clamps this against the slot-containment rule. */
  onMoveStart?(xMm: number): void;
}

export interface InteractionHandle {
  attach(): void;
  detach(): void;
  setTool(tool: Tool): void;
  setActiveStitch(kind: StitchKind): void;
  /** Snap any in-progress single-pointer drag to its current position so
   *  a multi-touch gesture can take over (gesture recognizer wires this). */
  commitInProgressDrag(): void;
}

export function createEditorInteract(
  svg: SVGSVGElement,
  cb: InteractionCallbacks,
): InteractionHandle {
  let tool: Tool = 'select';
  let activeStitch: StitchKind = 'straight';
  let dragging:
    | { kind: 'point'; id: string }
    | { kind: 'pan' }
    | { kind: 'bg' }
    | { kind: 'start' }
    | null = null;
  let dragStart: { clientX: number; clientY: number } | null = null;

  const onPointerDown = (ev: PointerEvent): void => {
    const target = ev.target as HTMLElement | SVGElement;
    const pointGroup = (target as Element).closest('[data-point-id]');
    const segGroup = (target as Element).closest('[data-segment-id]');
    const bgGroup = (target as Element).closest('[data-role="bg-image"]');
    const startGroup = (target as Element).closest('[data-role="start-marker"]');
    const action = determineActionFromPointer(ev, tool);

    // Start marker — drag in any tool to retune the carriage's design-
    // start X. Per the per-mode rule (project.ts:isStartLocked):
    // design mode is always draggable; manual mode locks the start
    // once any manual stitch exists (the carriage state would
    // retroactively change otherwise). The marker's data-locked attr
    // mirrors that rule so we can short-circuit here without
    // re-deriving it.
    if (startGroup && action !== 'pan') {
      const locked = startGroup.getAttribute('data-locked') === 'true';
      ev.preventDefault();
      if (!locked) {
        dragging = { kind: 'start' };
        dragStart = { clientX: ev.clientX, clientY: ev.clientY };
      }
      return;
    }

    if (action === 'pan') {
      ev.preventDefault();
      dragging = { kind: 'pan' };
      dragStart = { clientX: ev.clientX, clientY: ev.clientY };
      return;
    }

    // The BG image is below points/segments in z-order, so we only get here
    // when the click missed everything stitch-related. Drag it around in
    // any tool — sliding the guide is a setup gesture, not a stitch edit.
    // When the user has locked the bg, fall through so clicks pass to
    // empty-canvas behavior (e.g., adding a point) instead of grabbing
    // the image.
    if (bgGroup && !pointGroup && !segGroup && !cb.getProject().bg?.locked) {
      ev.preventDefault();
      dragging = { kind: 'bg' };
      dragStart = { clientX: ev.clientX, clientY: ev.clientY };
      return;
    }
    if (pointGroup) {
      const id = pointGroup.getAttribute('data-point-id');
      if (action === 'add' && id) {
        // Clicking an existing point in Add mode lays a new stitch AT the
        // same coordinates (clean backtrack or a second pass over the same
        // path). The new chain endpoint is a fresh point with the same
        // x/y as the clicked one.
        const target = cb.getProject().points.find((p) => p.id === id);
        if (target) {
          cb.onAddPoint({ x: target.x, y: target.y }, activeStitch);
          return;
        }
      }
      if (id) {
        cb.onSelectPoint(id);
        if (tool === 'move') {
          dragging = { kind: 'point', id };
        }
      }
      return;
    }
    if (segGroup) {
      const id = segGroup.getAttribute('data-segment-id');
      if (id) cb.onSelectSegment(id);
      return;
    }
    if (action === 'add') {
      const view = cb.getView();
      const rect = svg.getBoundingClientRect();
      const project = cb.getProject();
      const raw = hoopFromClient(ev, rect, view);

      if (project.mode === 'manual') {
        // Strict rejection — manual placement requires the user to click
        // within the live carriage / jump window. No snap, no clamp; the
        // validator inside addManualStitch will catch any edge case the
        // pre-check missed (e.g. carriage drift on Foot B), and the hover
        // affordance already telegraphed invalidity before this click.
        const b = liveBoundsForClick(project, activeStitch);
        if (!isInsideBounds(b, raw)) return;
        cb.onAddPoint({ x: raw.x, y: raw.y }, activeStitch);
        return;
      }

      // Design mode: clicks below the hoop are clamped to the hoop edge so
      // the user gets a point at the file-format limit instead of the click
      // being silently dropped. X stays as a hard reject — outside the
      // design halfW the click is clearly off-canvas (e.g., over the
      // inspector strip). Coords pass through raw — the encoder quantizes
      // to 1/8 mm at export, and display readouts already use toFixed(1).
      const eff = foot(project.suggestedFoot).carriageReachHalfMm;
      const effLim = Math.min(eff, project.hoop.halfW);
      if (raw.x < -effLim || raw.x > effLim) return;
      const clamped = clampToHoopAndLimit(raw, { effLim, H: project.hoop.h });
      cb.onAddPoint(clamped, activeStitch);
    }
  };

  const onPointerMove = (ev: PointerEvent): void => {
    const view = cb.getView();
    const rect = svg.getBoundingClientRect();
    const project = cb.getProject();

    if (dragging) {
      if (dragging.kind === 'pan' && dragStart) {
        const dx = ev.clientX - dragStart.clientX;
        const dy = ev.clientY - dragStart.clientY;
        dragStart = { clientX: ev.clientX, clientY: ev.clientY };
        cb.onPan?.(dx, dy);
        return;
      }
      if (dragging.kind === 'bg' && dragStart) {
        // Convert pixel delta to mm via the current zoom so the image
        // tracks the cursor 1:1 in design space.
        const dxMm = (ev.clientX - dragStart.clientX) / view.zoom;
        const dyMm = (ev.clientY - dragStart.clientY) / view.zoom;
        dragStart = { clientX: ev.clientX, clientY: ev.clientY };
        cb.onBgMove?.(dxMm, dyMm);
        return;
      }
      if (dragging.kind === 'start') {
        // Snap the start marker to the cursor's hoop-X. Y is ignored —
        // the carriage's lateral position is one-dimensional and the
        // marker always renders at the chain anchor's Y. The store
        // invariant (lockStartXMm) clamps to ±slotHalf of the chain
        // anchor once geometry exists, so we don't pre-clamp here.
        const raw = hoopFromClient(ev, rect, view);
        cb.onMoveStart?.(raw.x);
        return;
      }
      // Point drag. (Pan/bg branches above only return when dragStart is set,
      // so we may still be here with a non-point drag if it just began but
      // dragStart wasn't recorded — defensively narrow.)
      if (dragging.kind !== 'point') return;
      const eff = foot(project.suggestedFoot).carriageReachHalfMm;
      const effLim = Math.min(eff, project.hoop.halfW);
      const raw = hoopFromClient(ev, rect, view);
      const clamped = clampToHoopAndLimit(raw, { effLim, H: project.hoop.h });
      cb.onMovePoint(dragging.id, clamped);
      return;
    }

    // Hover (no drag in progress). Coords pass through raw in both modes;
    // the on-canvas dot tracks the cursor 1:1, and a follow-up click lands
    // at the same visible spot. Mode-specific behavior left:
    //   • design mode: clamp to the design X-limit (hoop edge).
    //   • manual mode: emit a validity signal so the renderer can flip
    //     the cursor + swap the dot for a "rejected" affordance when the
    //     cursor is outside the live carriage / jump window.
    const raw = hoopFromClient(ev, rect, view);

    if (project.mode === 'manual') {
      const inHoop =
        raw.x >= -project.hoop.halfW && raw.x <= project.hoop.halfW &&
        raw.y >= 0 && raw.y <= project.hoop.h;
      // Validity-as-rejection-cue is only meaningful in Add tool, where a
      // click would actually try to place a stitch. In Select / Move / Pan
      // there's nothing to reject — emit valid=true so any stale false
      // from a prior Add session is cleared, and skip the live-window
      // computation entirely.
      if (tool !== 'add') {
        cb.onHover(inHoop ? { x: raw.x, y: raw.y } : null);
        cb.onHoverValidity?.(true);
        return;
      }
      if (!inHoop) {
        cb.onHover(null);
        cb.onHoverValidity?.(false);
        return;
      }
      const b = liveBoundsForClick(project, activeStitch);
      cb.onHover({ x: raw.x, y: raw.y });
      cb.onHoverValidity?.(isInsideBounds(b, raw));
      return;
    }

    const eff = foot(project.suggestedFoot).carriageReachHalfMm;
    const effLim = Math.min(eff, project.hoop.halfW);
    if (
      raw.x < -effLim || raw.x > effLim ||
      raw.y < 0 || raw.y > project.hoop.h
    ) {
      cb.onHover(null);
    } else {
      cb.onHover(clampToHoopAndLimit(raw, { effLim, H: project.hoop.h }));
    }
    // Design mode has no live window and no rejection cue — always emit
    // valid=true so a stale false from a prior manual-mode session is
    // wiped (cursor + on-canvas reject glyph are both manual-only).
    cb.onHoverValidity?.(true);
  };

  const onPointerUp = (): void => {
    dragging = null;
    dragStart = null;
  };

  const onContextMenu = (ev: Event): void => {
    ev.preventDefault();
  };

  return {
    attach(): void {
      svg.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      // pointercancel fires when iOS interrupts a drag (system gesture,
      // notification, etc). Without it the drag state would leak.
      window.addEventListener('pointercancel', onPointerUp);
      svg.addEventListener('contextmenu', onContextMenu);
    },
    detach(): void {
      svg.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('contextmenu', onContextMenu);
    },
    setTool(t: Tool): void { tool = t; },
    setActiveStitch(k: StitchKind): void { activeStitch = k; },
    /**
     * Commit any in-progress single-pointer drag at its current position.
     * Called by the gesture recognizer when a 2nd finger lands so pinch
     * takes over without the drag continuing alongside (Q10).
     *
     * The drag has already been mutating projectStore on each move, so
     * "commit" reduces to "stop watching pointermove" — the position
     * stays where it last landed.
     */
    commitInProgressDrag(): void {
      onPointerUp();
    },
  };
}
