// Long-press detector. 600ms stationary single-pointer hold, with a
// 10px slop tolerance. A second pointer or pointercancel clears the
// timer. The recognizer wires a clearPressStart callback so the tap
// detector also sees that the press has been "consumed" by long-press.

export const LONG_PRESS_MS = 600;
export const LONG_PRESS_SLOP_PX = 10;

export interface LongPressTimer {
  cancel(): void;
}

export interface LongPressOptions {
  /** Position of the press in viewport coords. */
  x: number;
  y: number;
  /** Called after LONG_PRESS_MS if the timer wasn't cancelled. */
  onFire(x: number, y: number): void;
}

export function startLongPressTimer(opts: LongPressOptions): LongPressTimer {
  const { x, y, onFire } = opts;
  const handle = window.setTimeout(() => onFire(x, y), LONG_PRESS_MS);
  return {
    cancel(): void { clearTimeout(handle); },
  };
}

/** Drag distance from the press origin past which the long-press is
 *  cancelled. Caller computes Math.hypot(dx, dy) and compares. */
export function exceedsLongPressSlop(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX;
}
