// Phone inspector peek state machine — pure function. Given current
// state and a drag delta in pixels (up = positive), return next state.
// Same SNAP_PX deadzone idea as bottomSheet/state, but only two
// "open" states (peek + overlay) since the inspector closes itself
// when nothing is selected.

export type PeekState = 'hidden' | 'peek' | 'overlay';

const SNAP_PX = 80;

export function nextPeekState(current: PeekState, dy: number): PeekState {
  if (current === 'hidden') return current;
  if (Math.abs(dy) < SNAP_PX) return current;
  // Drag up: expand. Drag down from overlay collapses to peek; drag
  // down from peek stays at peek (closing via drag is rejected so the
  // selection-driven affordance isn't lost — user dismisses by tapping
  // outside or deselecting).
  if (dy > 0) return 'overlay';
  return 'peek';
}
