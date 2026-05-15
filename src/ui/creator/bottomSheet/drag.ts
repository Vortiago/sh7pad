// Pointer-drag glue for the bottom-sheet handle. Captures pointer
// events with setPointerCapture so move events keep flowing when the
// pointer leaves the handle, and converts the down→up delta into a
// SheetState transition via nextSheetState.
//
// Pulled out of bottomSheet/index.ts so the orchestrator stays focused
// on layout + lifecycle (Q7 — drag-to-resize machinery).

import { nextSheetState, type SheetState } from './state.js';

export interface DragHandleDeps {
  /** The element users grab to resize the sheet. Receives the
   *  pointerdown / pointerup / pointercancel listeners. */
  handle: HTMLElement;
  /** Read the current sheet state at drag-end time so the snap math
   *  considers the latest baseline (e.g. user tapped to open between
   *  drags). */
  getState(): SheetState;
  /** Apply a state transition (the orchestrator's setState). */
  setState(next: SheetState): void;
}

export function attachSheetDrag(deps: DragHandleDeps): () => void {
  const { handle } = deps;
  let startY: number | null = null;

  const onDown = (ev: PointerEvent): void => {
    startY = ev.clientY;
    try { handle.setPointerCapture(ev.pointerId); } catch { /* jsdom ok */ }
  };
  const onEnd = (ev: PointerEvent): void => {
    if (startY === null) return;
    const dy = startY - ev.clientY; // up positive
    startY = null;
    try { handle.releasePointerCapture(ev.pointerId); } catch {
      // releasePointerCapture throws if the capture was already lost
      // (pointercancel from a system gesture). Safe to swallow.
    }
    deps.setState(nextSheetState(deps.getState(), dy));
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointerup', onEnd);
  handle.addEventListener('pointercancel', onEnd);

  return () => {
    handle.removeEventListener('pointerdown', onDown);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
  };
}
