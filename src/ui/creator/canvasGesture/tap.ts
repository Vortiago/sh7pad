// Single-tap detector. A tap is a stationary single-pointer
// down→up within 250ms with <8px movement. Movement >slop or a 2nd
// pointer disqualifies the tap; the recognizer also disqualifies a
// tap when long-press fires (long-press clears pressStart).

export const TAP_MAX_MS = 250;
export const TAP_SLOP_PX = 8;

export interface PressStart {
  pointerId: number;
  x: number;
  y: number;
  t: number;
}

/**
 * Returns true if the pointerup event at (x, y) qualifies as a tap
 * given the press-start record. Caller is responsible for clearing
 * pressStart on slop-exceeded movement and on multi-touch arrival;
 * this function only inspects the timing/displacement of the release.
 */
export function isTap(start: PressStart, upClientX: number, upClientY: number): boolean {
  const dt = performance.now() - start.t;
  const dx = upClientX - start.x;
  const dy = upClientY - start.y;
  return dt <= TAP_MAX_MS && Math.hypot(dx, dy) <= TAP_SLOP_PX;
}
