// Editor + preview zoom constants, clamp helper, and the anchor-aware
// zoomAtPoint used by both pinch-to-zoom and the cursor-anchored wheel
// handler (Q11). Pure math — no DOM — so it's trivially unit-testable.

export const ZOOM_STEP = 1.25;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 20;

/** Pan values below this are treated as zero in reset-no-op checks.
 * Sub-pixel at any reachable zoom level. */
export const PAN_ZERO_EPS = 1e-6;

/**
 * Clamp a zoom factor into [min, max]. NaN-safe (NaN → min); infinities
 * clamp naturally (+∞ → max, -∞ → min).
 */
export function clampZoom(z: number, min: number = ZOOM_MIN, max: number = ZOOM_MAX): number {
  if (Number.isNaN(z)) return min;
  return Math.max(min, Math.min(max, z));
}

export interface ZoomViewState {
  userZoom: number;
  pan: { x: number; y: number };
}

export type ZoomAction = 'in' | 'out' | 'reset';

/**
 * Compute the next view for a discrete toolbar zoom action.
 *   - `'in'` / `'out'`: clamp(cur × ZOOM_STEP) / clamp(cur ÷ ZOOM_STEP); pan unchanged.
 *   - `'reset'`: zoom 1, pan 0,0 (re-center).
 *
 * Returns `null` when the action would be a no-op so callers can skip
 * the store write — `uiStore.update` always notifies subscribers, so an
 * unguarded same-value patch wakes every renderer.
 */
export function nextZoomView(view: ZoomViewState, action: ZoomAction): ZoomViewState | null {
  const cur = view.userZoom;
  if (action === 'reset') {
    if (cur === 1 && Math.abs(view.pan.x) < PAN_ZERO_EPS && Math.abs(view.pan.y) < PAN_ZERO_EPS) {
      return null;
    }
    return { userZoom: 1, pan: { x: 0, y: 0 } };
  }
  const next = action === 'in' ? clampZoom(cur * ZOOM_STEP) : clampZoom(cur / ZOOM_STEP);
  if (cur === next) return null;
  return { userZoom: next, pan: view.pan };
}

/**
 * Apply a zoom factor anchored at a screen-space point. The returned
 * userZoom and pan keep `(screenX, screenY)` mapped to the same hoop
 * coordinate it had before the zoom.
 *
 * Caller passes:
 *   - the canvas-wrap container size in screen pixels. The editor's
 *     computeView auto-centers the design horizontally and vertically
 *     inside the container, so the camera origin is `container/2 + pan`
 *     (not just `pan`). Without subtracting half-container before
 *     applying the effective scale the anchor drifts by half the
 *     container width on every zoom step.
 *   - screen point relative to the canvas-wrap container (i.e.
 *     clientX - rect.left and clientY - rect.top).
 *
 * The math: at any zoom z, the screen→hoop mapping is
 *   hoopX = (screenX - offsetX) / z
 * where offsetX = containerW/2 + panX. To keep hoopX invariant across
 * z → z':
 *   offsetX' = screenX - z'/z · (screenX - offsetX)
 *   panX'    = offsetX' - containerW/2
 *            = screenX - containerW/2 - z'/z · (screenX - containerW/2 - panX)
 * Same for Y.
 */
export function zoomAtPoint(
  view: ZoomViewState,
  screenX: number,
  screenY: number,
  factor: number,
  container: { w: number; h: number },
): ZoomViewState {
  const nextUserZoom = clampZoom(view.userZoom * factor);
  // If the clamp bit, scale the actual factor down so the math stays
  // self-consistent (anchor truly invariant after clamp).
  const effective = nextUserZoom / view.userZoom;
  const halfW = container.w / 2;
  const halfH = container.h / 2;
  const panX = screenX - halfW - (screenX - halfW - view.pan.x) * effective;
  const panY = screenY - halfH - (screenY - halfH - view.pan.y) * effective;
  return {
    userZoom: nextUserZoom,
    pan: { x: panX, y: panY },
  };
}
