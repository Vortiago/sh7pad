// Pinch + two-finger pan detector. Stateful: each new pair of pointer
// snapshots produces a (factor, dx, dy) relative to the previous
// frame. Caller applies factor as a zoom around the centroid and dx/dy
// as a pan delta. Sub-1% factors are filtered as noise.

import type { PointerMap } from './pointerMap.js';
import { distance, midpoint } from './pointerMap.js';

const PINCH_NOISE_FLOOR = 0.01;

export interface PinchFrame {
  /** Centroid of the two pointers in viewport coords. */
  centroidClientX: number;
  centroidClientY: number;
  /** Δdistance ratio relative to the previous frame. 1.0 = no change.
   *  null when no previous frame yet. */
  factor: number | null;
  /** Δmidpoint relative to the previous frame. {0,0} on first frame. */
  dx: number;
  dy: number;
}

export interface PinchState {
  prevDistance: number | null;
  prevMid: { x: number; y: number } | null;
}

export function makePinchState(): PinchState {
  return { prevDistance: null, prevMid: null };
}

/**
 * Compute a frame from two-pointer state. Returns null when there
 * aren't exactly two pointers tracked. The caller should treat
 * factor=null as "no zoom this frame yet" (initial setup), and
 * factor close to 1 as "two-finger pan only, no pinch".
 */
export function computePinchFrame(
  pointers: PointerMap,
  state: PinchState,
): PinchFrame | null {
  if (pointers.size !== 2) return null;
  const [a, b] = [...pointers.values()];
  const d = distance(a!, b!);
  const m = midpoint(a!, b!);
  let factor: number | null = null;
  let dx = 0;
  let dy = 0;
  if (state.prevDistance != null && d > 0) {
    const raw = d / state.prevDistance;
    factor = Math.abs(raw - 1) > PINCH_NOISE_FLOOR ? raw : 1;
  }
  if (state.prevMid) {
    dx = m.x - state.prevMid.x;
    dy = m.y - state.prevMid.y;
  }
  state.prevDistance = d;
  state.prevMid = m;
  return { centroidClientX: m.x, centroidClientY: m.y, factor, dx, dy };
}

export function resetPinchState(state: PinchState): void {
  state.prevDistance = null;
  state.prevMid = null;
}

export function refreshPinchState(state: PinchState, pointers: PointerMap): void {
  if (pointers.size < 2) {
    resetPinchState(state);
    return;
  }
  const [a, b] = [...pointers.values()];
  state.prevDistance = distance(a!, b!);
  state.prevMid = midpoint(a!, b!);
}
