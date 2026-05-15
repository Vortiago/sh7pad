// Unified camera wiring shared by the editor and preview canvas wraps.
//
// Both panes wire wheel-zoom + pinch + two-finger pan + a floating
// "fit zoom" button + optional mouse pan in near-identical code. The
// only differences are which uiStore field pair they write
// (userZoom/pan for the editor, previewUserZoom/previewPan for the
// preview) and whether mouse pan is owned at this layer (preview)
// or by the editor's own pointer-interact (editor).
//
// canvasCamera takes a CameraView adapter that hides the field-pair
// difference and the editor-specific extra recognizer callbacks
// (onTap / onLongPress / onMultiTouchStart) are forwarded so both panes
// share one gesture-recognizer instance per wrap. Two recognizers on
// the same element would compete for pointer events, so the camera
// owns the single mount and the caller forwards what it needs.
//
// zoom/zoomAtPoint + nextZoomView stay as the pure math layer; this
// module composes over them.

import { attachGestureRecognizer, type GestureCallbacks } from '../canvasGesture/index.js';
import { zoomAtPoint, nextZoomView, type ZoomAction, type ZoomViewState } from '../zoom/index.js';
import { createPanInteract } from '../editor/panInteract.js';

export interface CanvasCameraOptions {
  /** The canvas wrap element (e.g. `.ed-canvas-wrap` or `.pv-canvas-wrap`). */
  wrap: HTMLElement;
  /** Read the current camera view (userZoom + pan) from the store. */
  getView(): ZoomViewState;
  /** Write the next camera view to the store. */
  setView(next: ZoomViewState): void;
  /** Editor-only: forward tap events from the shared recognizer.
   *  The preview pane does not consume tap. */
  onTap?: GestureCallbacks['onTap'];
  /** Editor-only: forward long-press events from the shared recognizer.
   *  The preview pane does not consume long-press. */
  onLongPress?: GestureCallbacks['onLongPress'];
  /** Editor-only: forward the 2nd-finger-landed signal so the editor
   *  can commit an in-progress single-pointer drag and cancel the
   *  pending click. The preview pane has no such drag state. */
  onMultiTouchStart?: GestureCallbacks['onMultiTouchStart'];
  /** Preview-only: enable mouse pan via panInteract (middle / right /
   *  Alt+drag). The editor's mouse pan is owned by editorInteract and
   *  gated by the Pan tool / modifiers, so it leaves this off. */
  enableMousePan?: boolean;
}

export interface CanvasCameraHandle {
  /** Apply a discrete toolbar zoom action (in / out / reset) using the
   *  same view adapter the wheel / pinch handlers use. The reset action
   *  is also wired to the floating fit button mounted by this module. */
  applyZoom(action: ZoomAction): void;
}

/**
 * Wire wheel zoom + pinch + two-finger pan + floating fit button (and
 * optionally mouse pan) onto a canvas wrap. Returns an applyZoom that
 * the caller can also bind to toolbar/transport zoom buttons.
 */
export function attachCanvasCamera(opts: CanvasCameraOptions): CanvasCameraHandle {
  const { wrap, getView, setView } = opts;

  // Cursor-anchored wheel zoom — the screen point under the wheel
  // stays pinned to the same hoop coord across the zoom step.
  wrap.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const rect = wrap.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const next = zoomAtPoint(getView(), sx, sy, factor, { w: rect.width, h: rect.height });
    setView(next);
  }, { passive: false });

  // Pinch + two-finger pan via the shared gesture recognizer. Attached
  // to the canvas WRAP (parent of the SVG) with capture-phase listeners
  // so it intercepts pointerdown before any SVG-target-phase interact
  // handlers — prevents a 2nd-finger pinch start from being interpreted
  // as a phantom point insertion under the editor's 'add' tool.
  // zoomAtPoint anchors at the centroid.
  //
  // The editor's onTap / onLongPress / onMultiTouchStart are forwarded
  // through this single recognizer (one recognizer per wrap; two would
  // compete for pointer events).
  attachGestureRecognizer(wrap, {
    onPinch(centroidClientX, centroidClientY, factor) {
      const rect = wrap.getBoundingClientRect();
      const sx = centroidClientX - rect.left;
      const sy = centroidClientY - rect.top;
      const next = zoomAtPoint(getView(), sx, sy, factor, { w: rect.width, h: rect.height });
      setView(next);
    },
    onTwoFingerPan(dx, dy) {
      const cur = getView();
      setView({ userZoom: cur.userZoom, pan: { x: cur.pan.x + dx, y: cur.pan.y + dy } });
    },
    ...(opts.onMultiTouchStart ? { onMultiTouchStart: opts.onMultiTouchStart } : {}),
    ...(opts.onTap ? { onTap: opts.onTap } : {}),
    ...(opts.onLongPress ? { onLongPress: opts.onLongPress } : {}),
  });

  // Preview-only: middle / right / Alt+drag mouse pan via the generic
  // panInteract. The editor's mouse pan is owned by editorInteract and
  // gated by Pan tool / modifiers, so it leaves enableMousePan off.
  if (opts.enableMousePan) {
    const pan = createPanInteract(wrap, {
      onPan: (dx, dy) => {
        const cur = getView();
        setView({ userZoom: cur.userZoom, pan: { x: cur.pan.x + dx, y: cur.pan.y + dy } });
      },
    });
    pan.attach();
  }

  function applyZoom(action: ZoomAction): void {
    const next = nextZoomView(getView(), action);
    if (next === null) return;
    setView(next);
  }

  // Phone-only floating "Fit zoom" button. CSS hides it at ≥640px where
  // the toolbar / transport's reset/zoom buttons are visible. Always
  // mounted in the DOM so a window-resize across the breakpoint shows /
  // hides it without re-mounting. The class name `.ed-fit-zoom` is
  // shared by the editor and preview (predates the unification).
  const btn = wrap.ownerDocument.createElement('button');
  btn.type = 'button';
  btn.className = 'ed-fit-zoom';
  btn.dataset['action'] = 'fit-zoom';
  btn.setAttribute('aria-label', 'Fit zoom to view');
  btn.textContent = '⊙';
  btn.addEventListener('click', () => applyZoom('reset'));
  wrap.appendChild(btn);

  return { applyZoom };
}
