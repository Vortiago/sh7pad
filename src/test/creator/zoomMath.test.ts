// zoomAtPoint — anchor-aware zoom: keep the screen point under the
// cursor (or the centroid of two fingers) at the same hoop coordinate
// after the zoom factor changes. Used by both pinch (commit 4) and the
// upgraded wheel zoom in editor/canvasWiring.ts.
//
// The editor's view places the camera origin at `containerW/2 + panX`
// and `containerH/2 + panY` (auto-centering math in editorView.ts).
// zoomAtPoint takes the container size so its anchor math accounts
// for that — without it, every zoom step drifts the design by half
// the container width / height.

import { describe, expect, it } from 'vitest';
import {
  PAN_ZERO_EPS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  nextZoomView,
  zoomAtPoint,
} from '../../ui/creator/zoom/index.js';

const C = { w: 800, h: 600 };

/** Apply the same auto-centered offset math the editor's view uses. */
function offset(pan: { x: number; y: number }): { x: number; y: number } {
  return { x: C.w / 2 + pan.x, y: C.h / 2 + pan.y };
}

describe('zoomAtPoint', () => {
  it('factor=1 returns the input userZoom and pan unchanged', () => {
    const out = zoomAtPoint(
      { userZoom: 1.5, pan: { x: 10, y: 20 } },
      100, 100, 1, C,
    );
    expect(out.userZoom).toBeCloseTo(1.5);
    expect(out.pan.x).toBeCloseTo(10);
    expect(out.pan.y).toBeCloseTo(20);
  });

  it('zooming in at the container center keeps pan unchanged', () => {
    // Anchoring at the auto-fit origin shouldn't need any pan correction.
    const before = { userZoom: 1, pan: { x: 0, y: 0 } };
    const after = zoomAtPoint(before, C.w / 2, C.h / 2, 2, C);
    expect(after.userZoom).toBeCloseTo(2);
    expect(after.pan.x).toBeCloseTo(0);
    expect(after.pan.y).toBeCloseTo(0);
  });

  it('zooming around an off-center point keeps that screen point fixed', () => {
    // Hoop coord at screen (sx, sy) is (sx - offsetX) / zoom. Across a
    // zoom step, the anchor (sx, sy) must map to the same hoop coord.
    const before = { userZoom: 1, pan: { x: 30, y: -20 } };
    const sx = 600;
    const sy = 150;
    const before_off = offset(before.pan);
    const hoopXBefore = (sx - before_off.x) / before.userZoom;
    const hoopYBefore = (sy - before_off.y) / before.userZoom;
    const after = zoomAtPoint(before, sx, sy, 1.6, C);
    const after_off = offset(after.pan);
    const hoopXAfter = (sx - after_off.x) / after.userZoom;
    const hoopYAfter = (sy - after_off.y) / after.userZoom;
    expect(after.userZoom).toBeCloseTo(1.6);
    expect(hoopXAfter).toBeCloseTo(hoopXBefore, 6);
    expect(hoopYAfter).toBeCloseTo(hoopYBefore, 6);
  });

  it('clamps userZoom to [ZOOM_MIN, ZOOM_MAX]', () => {
    const lower = zoomAtPoint({ userZoom: 1, pan: { x: 0, y: 0 } }, 0, 0, 1e-6, C);
    expect(lower.userZoom).toBe(ZOOM_MIN);

    const upper = zoomAtPoint({ userZoom: 1, pan: { x: 0, y: 0 } }, 0, 0, 1e6, C);
    expect(upper.userZoom).toBe(ZOOM_MAX);
  });

  it('zooming out around a point keeps that screen point fixed', () => {
    const before = { userZoom: 4, pan: { x: 50, y: 50 } };
    const sx = 250;
    const sy = 250;
    const before_off = offset(before.pan);
    const hoopXBefore = (sx - before_off.x) / before.userZoom;
    const hoopYBefore = (sy - before_off.y) / before.userZoom;
    const after = zoomAtPoint(before, sx, sy, 0.5, C);
    const after_off = offset(after.pan);
    expect(after.userZoom).toBeCloseTo(2);
    expect((sx - after_off.x) / after.userZoom).toBeCloseTo(hoopXBefore, 6);
    expect((sy - after_off.y) / after.userZoom).toBeCloseTo(hoopYBefore, 6);
  });
});

describe('nextZoomView', () => {
  it('zoom in / out steps by ZOOM_STEP without touching pan', () => {
    const view = { userZoom: 1, pan: { x: 5, y: -7 } };
    const inResult = nextZoomView(view, 'in');
    expect(inResult).not.toBeNull();
    expect(inResult!.userZoom).toBeCloseTo(ZOOM_STEP);
    expect(inResult!.pan).toBe(view.pan);

    const outResult = nextZoomView(view, 'out');
    expect(outResult!.userZoom).toBeCloseTo(1 / ZOOM_STEP);
    expect(outResult!.pan).toBe(view.pan);
  });

  it('returns null when zoom-in is already clamped at ZOOM_MAX', () => {
    expect(nextZoomView({ userZoom: ZOOM_MAX, pan: { x: 0, y: 0 } }, 'in')).toBeNull();
  });

  it('returns null when zoom-out is already clamped at ZOOM_MIN', () => {
    expect(nextZoomView({ userZoom: ZOOM_MIN, pan: { x: 0, y: 0 } }, 'out')).toBeNull();
  });

  it('reset returns zoom 1 + zero pan when off', () => {
    const result = nextZoomView({ userZoom: 2.5, pan: { x: 30, y: -20 } }, 'reset');
    expect(result).toEqual({ userZoom: 1, pan: { x: 0, y: 0 } });
  });

  it('reset returns null when already at zoom 1 with zero pan', () => {
    expect(nextZoomView({ userZoom: 1, pan: { x: 0, y: 0 } }, 'reset')).toBeNull();
  });

  it('reset treats sub-PAN_ZERO_EPS pan as zero', () => {
    const tiny = PAN_ZERO_EPS / 10;
    expect(nextZoomView({ userZoom: 1, pan: { x: tiny, y: -tiny } }, 'reset')).toBeNull();
  });

  it('reset still acts when pan exceeds PAN_ZERO_EPS', () => {
    const result = nextZoomView({ userZoom: 1, pan: { x: PAN_ZERO_EPS * 10, y: 0 } }, 'reset');
    expect(result).toEqual({ userZoom: 1, pan: { x: 0, y: 0 } });
  });
});
