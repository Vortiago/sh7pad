// Canvas wiring — attaches the canvas-keyboard nav, the tap-ripple
// spawner, and the editor-specific long-press menu / multi-touch drag
// commit on top of the shared canvasCamera. canvasCamera owns the
// wheel zoom, the gesture recognizer, the two-finger pan, and the
// phone-only floating Fit button — both editor and preview share that
// glue. The editor adds the tap / long-press / multi-touch forwarders
// because the gesture recognizer is mounted by canvasCamera (one
// recognizer per wrap).
//
// Pulled out of editor/index.ts so the orchestrator stays focused on
// pane composition rather than per-event glue.

import { attachCanvasKeyboard } from './keyboard.js';
import { showContextMenu } from '../contextMenu/index.js';
import { spawnRipple } from '../tapRipple/index.js';
import { attachCanvasCamera } from '../canvasCamera/index.js';
import { hitTestCanvas, buildLongPressItems, type LongPressOps } from './longPressMenu.js';
import type { InteractionHandle } from './interact.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';

export interface CanvasWiringDeps {
  doc: Document;
  edCanvasWrap: HTMLElement;
  edCanvas: SVGSVGElement;
  projectStore: ProjectStore;
  uiStore: UiStore;
  /** May be null while the editor is still bootstrapping. The wiring
   *  reads this through a getter so late-bind is safe. */
  getInteract(): InteractionHandle | null;
  /** Long-press menu actions — pulled from the orchestrator's reducers. */
  longPressOps: LongPressOps;
}

export function attachCanvasWiring(deps: CanvasWiringDeps): void {
  const { doc, edCanvasWrap, edCanvas, projectStore, uiStore } = deps;

  // Shared camera (wheel zoom + pinch + two-finger pan + fit button).
  // The recognizer mounted here is the only one on this wrap; the
  // editor's tap / long-press / multi-touch callbacks are forwarded
  // through it rather than mounting a second recognizer that would
  // compete for pointer events.
  attachCanvasCamera({
    wrap: edCanvasWrap,
    getView: () => {
      const ui = uiStore.getState();
      return { userZoom: ui.userZoom, pan: ui.pan };
    },
    setView: (next) => {
      uiStore.update({ userZoom: next.userZoom, pan: next.pan });
    },
    onMultiTouchStart() {
      // 2nd finger landed mid-single-pointer: snap any in-progress
      // drag to its current position and cancel the upcoming click.
      deps.getInteract()?.commitInProgressDrag();
    },
    onTap(clientX, clientY) {
      // Editor/interact already handles point insertion via
      // pointerdown→pointerup; we draw a transient ripple on the
      // canvas wrap so the tap registers visually (touch UX).
      const rect = edCanvasWrap.getBoundingClientRect();
      spawnRipple(edCanvasWrap, clientX - rect.left, clientY - rect.top);
    },
    onLongPress(clientX, clientY) {
      // Long-press menu. Items vary by what's under the press:
      //   - point   → Delete
      //   - segment → Subdivide, Convert, Delete
      //   - empty   → no menu
      const target = hitTestCanvas(edCanvas, clientX, clientY);
      const items = buildLongPressItems(target, deps.longPressOps);
      if (items.length > 0) {
        showContextMenu({
          anchorX: clientX,
          anchorY: clientY,
          label: target?.kind === 'segment' ? 'Segment actions' : 'Point actions',
          items,
        });
      }
    },
  });

  // Canvas keyboard navigation (arrows, [/], Enter, Esc). The live
  // region (#canvas-announce) is announced via aria-live=polite.
  const liveRegion = doc.getElementById('canvas-announce');
  attachCanvasKeyboard({ svg: edCanvas, projectStore, uiStore, liveRegion });
}
