// Canvas multi-touch gesture recognizer. Pointer Events only (Q10).
//
// With 1 pointer: passes events through to existing single-pointer
// editor/interact handlers, but tracks tap (≤250ms, <8px slop) and
// long-press (≥600ms stationary) and fires those as observer events.
// With ≥2 pointers: stopPropagation single-pointer flow, fires
// onMultiTouchStart so the editor can commit any in-progress drag,
// then drives pinch (Δdistance) + two-finger pan (Δmidpoint).
//
// The orchestrator wires PointerEvent listeners; the actual detection
// logic is split into sibling files so each detector reads as a small
// unit:
//
//   pointerMap.ts  multi-pointer state + distance/midpoint helpers
//   pinch.ts       Δdistance + Δcentroid frame extractor
//   tap.ts         250ms / 8px slop release detector
//   longPress.ts   600ms stationary hold timer

import type { PointerMap } from './pointerMap.js';
import {
  computePinchFrame,
  makePinchState,
  refreshPinchState,
  resetPinchState,
} from './pinch.js';
import {
  exceedsLongPressSlop,
  startLongPressTimer,
  type LongPressTimer,
} from './longPress.js';
import { isTap, type PressStart } from './tap.js';

export interface GestureCallbacks {
  /** Pinch step: factor relative to the previous frame, anchored at
   *  the centroid (clientX/Y, viewport-relative). */
  onPinch?(centroidClientX: number, centroidClientY: number, factor: number): void;
  /** Two-finger pan: dx/dy of the centroid since the previous frame. */
  onTwoFingerPan?(dx: number, dy: number): void;
  /** Fired when a 2nd pointer arrives mid-single-pointer-interaction.
   *  Caller should commit any in-progress drag and cancel any pending
   *  click so the gesture takes over cleanly (Q10 decision). */
  onMultiTouchStart?(): void;
  /** Quick stationary tap. Caller spawns a ripple at clientX/clientY. */
  onTap?(clientX: number, clientY: number): void;
  /** Stationary press of LONG_PRESS_MS. Caller opens a context menu. */
  onLongPress?(clientX: number, clientY: number): void;
}

export function attachGestureRecognizer(
  el: Element,
  cb: GestureCallbacks,
): () => void {
  const pointers: PointerMap = new Map();
  const pinchState = makePinchState();
  let pressStart: PressStart | null = null;
  let longPressTimer: LongPressTimer | null = null;

  function clearLongPressTimer(): void {
    if (longPressTimer !== null) {
      longPressTimer.cancel();
      longPressTimer = null;
    }
  }

  function onDown(ev: PointerEvent): void {
    pointers.set(ev.pointerId, { clientX: ev.clientX, clientY: ev.clientY });
    if (pointers.size === 1) {
      pressStart = {
        pointerId: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        t: performance.now(),
      };
      if (cb.onLongPress) {
        const startId = ev.pointerId;
        longPressTimer = startLongPressTimer({
          x: ev.clientX,
          y: ev.clientY,
          onFire: (x, y) => {
            longPressTimer = null;
            // Long-press fires only if still single-pointer + stationary;
            // pressStart wasn't cleared by movement or 2nd pointer.
            if (pointers.size === 1 && pressStart && pressStart.pointerId === startId) {
              pressStart = null; // suppresses the upcoming tap
              cb.onLongPress?.(x, y);
            }
          },
        });
      }
    } else if (pointers.size === 2) {
      // Multi-touch: take over and short-circuit single-pointer flow.
      ev.stopPropagation();
      clearLongPressTimer();
      pressStart = null; // cancel pending tap
      cb.onMultiTouchStart?.();
      refreshPinchState(pinchState, pointers);
    }
  }

  function onMove(ev: PointerEvent): void {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { clientX: ev.clientX, clientY: ev.clientY });

    if (pointers.size === 1 && pressStart && pressStart.pointerId === ev.pointerId) {
      const dx = ev.clientX - pressStart.x;
      const dy = ev.clientY - pressStart.y;
      if (exceedsLongPressSlop(dx, dy)) {
        clearLongPressTimer();
        // Movement also disqualifies the upcoming tap (it was a drag).
        pressStart = null;
      }
      return;
    }

    if (pointers.size < 2) return;
    ev.stopPropagation();
    const frame = computePinchFrame(pointers, pinchState);
    if (!frame) return;
    if (frame.factor != null && frame.factor !== 1 && cb.onPinch) {
      cb.onPinch(frame.centroidClientX, frame.centroidClientY, frame.factor);
    }
    if ((frame.dx !== 0 || frame.dy !== 0) && cb.onTwoFingerPan) {
      cb.onTwoFingerPan(frame.dx, frame.dy);
    }
  }

  function onUp(ev: PointerEvent): void {
    if (!pointers.has(ev.pointerId)) return;
    // If this was a quick stationary single-pointer release, fire onTap.
    if (
      pointers.size === 1 &&
      pressStart &&
      pressStart.pointerId === ev.pointerId &&
      cb.onTap &&
      isTap(pressStart, ev.clientX, ev.clientY)
    ) {
      cb.onTap(ev.clientX, ev.clientY);
    }
    cleanup(ev);
  }

  function onCancel(ev: PointerEvent): void {
    cleanup(ev);
  }

  function cleanup(ev: PointerEvent): void {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    clearLongPressTimer();
    pressStart = null;
    if (pointers.size < 2) {
      resetPinchState(pinchState);
    } else {
      refreshPinchState(pinchState, pointers);
    }
  }

  // PointerEvent handlers cast to EventListener — `Element.addEventListener`
  // doesn't have a typed overload for pointer events (those are on the
  // narrower DOM interfaces), and we want the recognizer to accept any
  // Element. The capture-phase opts pass through unchanged on remove,
  // which is enough to dedupe the listener.
  const capture = { capture: true };
  el.addEventListener('pointerdown', onDown as EventListener, capture);
  el.addEventListener('pointermove', onMove as EventListener, capture);
  el.addEventListener('pointerup', onUp as EventListener, capture);
  el.addEventListener('pointercancel', onCancel as EventListener, capture);

  return () => {
    el.removeEventListener('pointerdown', onDown as EventListener, capture);
    el.removeEventListener('pointermove', onMove as EventListener, capture);
    el.removeEventListener('pointerup', onUp as EventListener, capture);
    el.removeEventListener('pointercancel', onCancel as EventListener, capture);
    clearLongPressTimer();
  };
}
