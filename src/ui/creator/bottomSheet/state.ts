// Bottom sheet state machine. Pure function: given a current state and
// a drag delta in pixels (positive = drag UP, negative = drag DOWN),
// return the next state. Snaps one step per drag end; large drags don't
// skip states.
//
// Thresholds tuned via Q7: closed → half → full with a 30%/70% snap.
// We pin the threshold in pixels rather than viewport-relative so the
// math is unit-testable without a viewport mock.

export type SheetState = 'closed' | 'half' | 'full';

const SNAP_PX = 100;

export function nextSheetState(current: SheetState, dy: number): SheetState {
  // Inside the snap deadzone — keep the same state.
  if (Math.abs(dy) < SNAP_PX) return current;
  const isUp = dy > 0;
  switch (current) {
    case 'closed':
      return isUp ? 'half' : 'closed';
    case 'half':
      return isUp ? 'full' : 'closed';
    case 'full':
      return isUp ? 'full' : 'half';
  }
}
