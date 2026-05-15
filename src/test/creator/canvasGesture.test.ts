// canvasGesture recognizer — synthetic PointerEvent sequences exercise
// the multi-touch path. Single-pointer events should NOT invoke the
// callbacks (those go to the existing single-pointer flow).

import { beforeEach, describe, expect, it } from 'vitest';
import { attachGestureRecognizer } from '../../ui/creator/canvasGesture/index.js';

let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  el = document.createElement('div');
  document.body.appendChild(el);
});

function pointer(type: string, pointerId: number, x: number, y: number): Event {
  // jsdom 25 doesn't implement PointerEvent. Build a plain Event and
  // attach the bits the recognizer reads (pointerId, clientX/Y).
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'pointerId', { value: pointerId });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  return ev;
}

describe('attachGestureRecognizer', () => {
  it('a single pointer down/move/up does not fire pinch or pan callbacks', () => {
    const events: string[] = [];
    attachGestureRecognizer(el, {
      onPinch: () => events.push('pinch'),
      onTwoFingerPan: () => events.push('pan'),
    });

    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointermove', 1, 110, 110));
    el.dispatchEvent(pointer('pointerup', 1, 110, 110));
    expect(events).toEqual([]);
  });

  it('two-finger pinch in (distance shrinks) emits onPinch with factor < 1', () => {
    const factors: number[] = [];
    attachGestureRecognizer(el, {
      onPinch: (_x, _y, f) => factors.push(f),
    });

    // Start at 200px apart on the X axis.
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 300, 100));
    // Move pointer 2 to 200 → distance 100 (half).
    el.dispatchEvent(pointer('pointermove', 2, 200, 100));

    expect(factors.length).toBe(1);
    expect(factors[0]!).toBeCloseTo(0.5, 2);
  });

  it('two-finger pinch reports the centroid as the anchor', () => {
    const captured: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onPinch: (x, y) => captured.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 300, 200));
    el.dispatchEvent(pointer('pointermove', 2, 250, 200));

    expect(captured.length).toBe(1);
    // Centroid of (100,100) and (250,200) = (175, 150).
    expect(captured[0]!.x).toBeCloseTo(175);
    expect(captured[0]!.y).toBeCloseTo(150);
  });

  it('two-finger drag (constant distance) emits onTwoFingerPan with the centroid delta', () => {
    const pans: Array<{ dx: number; dy: number }> = [];
    attachGestureRecognizer(el, {
      onTwoFingerPan: (dx, dy) => pans.push({ dx, dy }),
    });

    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 200, 100));
    // Both fingers shift by (50, 30). Centroid moves the same.
    el.dispatchEvent(pointer('pointermove', 1, 150, 130));
    el.dispatchEvent(pointer('pointermove', 2, 250, 130));

    // The first move triggers a pan event (only one pointer changed,
    // but mid does shift); the second move adjusts again.
    expect(pans.length).toBeGreaterThan(0);
    const totalDx = pans.reduce((s, p) => s + p.dx, 0);
    const totalDy = pans.reduce((s, p) => s + p.dy, 0);
    expect(totalDx).toBeCloseTo(50);
    expect(totalDy).toBeCloseTo(30);
  });

  it('a quick small single-pointer release fires onTap', () => {
    const taps: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onTap: (x, y) => taps.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerup', 1, 102, 101));
    expect(taps).toEqual([{ x: 102, y: 101 }]);
  });

  it('a single-pointer release with too much movement does NOT fire onTap', () => {
    const taps: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onTap: (x, y) => taps.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointermove', 1, 150, 100));
    el.dispatchEvent(pointer('pointerup', 1, 150, 100));
    expect(taps).toEqual([]);
  });

  it('a 2nd pointer fires onMultiTouchStart so the editor can commit any drag', () => {
    let multiTouchStarts = 0;
    attachGestureRecognizer(el, {
      onMultiTouchStart: () => { multiTouchStarts += 1; },
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 200, 100));
    expect(multiTouchStarts).toBe(1);
  });

  it('a 2nd pointer cancels any pending tap (so taps mid-pinch never fire)', () => {
    const taps: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onTap: (x, y) => taps.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 200, 100));
    el.dispatchEvent(pointer('pointerup', 1, 100, 100));
    expect(taps).toEqual([]);
  });

  it('long-press fires after 600ms of stationary single pointer', async () => {
    const longPresses: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onLongPress: (x, y) => longPresses.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    await new Promise((r) => setTimeout(r, 650));
    expect(longPresses).toEqual([{ x: 100, y: 100 }]);
  });

  it('long-press is cancelled by movement >10px slop', async () => {
    const longPresses: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onLongPress: (x, y) => longPresses.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointermove', 1, 120, 100));
    await new Promise((r) => setTimeout(r, 650));
    expect(longPresses).toEqual([]);
  });

  it('long-press is cancelled by pointercancel', async () => {
    const longPresses: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onLongPress: (x, y) => longPresses.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointercancel', 1, 100, 100));
    await new Promise((r) => setTimeout(r, 650));
    expect(longPresses).toEqual([]);
  });

  it('after a long-press fires, the upcoming pointerup does NOT also fire onTap', async () => {
    const taps: Array<{ x: number; y: number }> = [];
    const longPresses: Array<{ x: number; y: number }> = [];
    attachGestureRecognizer(el, {
      onTap: (x, y) => taps.push({ x, y }),
      onLongPress: (x, y) => longPresses.push({ x, y }),
    });
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    await new Promise((r) => setTimeout(r, 650));
    el.dispatchEvent(pointer('pointerup', 1, 100, 100));
    expect(longPresses.length).toBe(1);
    expect(taps).toEqual([]);
  });

  it('pointercancel cleans up so a subsequent fresh gesture works', () => {
    const factors: number[] = [];
    attachGestureRecognizer(el, {
      onPinch: (_x, _y, f) => factors.push(f),
    });

    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 300, 100));
    el.dispatchEvent(pointer('pointercancel', 1, 100, 100));
    el.dispatchEvent(pointer('pointercancel', 2, 300, 100));

    // Fresh gesture: should not retain stale state.
    el.dispatchEvent(pointer('pointerdown', 3, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 4, 200, 100));
    el.dispatchEvent(pointer('pointermove', 4, 150, 100));
    expect(factors.length).toBe(1);
    expect(factors[0]!).toBeCloseTo(0.5, 2);
  });
});
