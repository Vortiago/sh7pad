// Generic pan interaction: middle / right / Alt+left drag → onPan(dxPx, dyPx)
// per pointermove. Used by the preview canvas to mirror the editor's camera
// without pulling in editorInteract's point/segment/bg drag logic.
//
// Plain left-drag is intentionally not handled, so future click-targets
// inside the host element stay free for other interactions.

export interface PanCallbacks {
  onPan(dxPx: number, dyPx: number): void;
}

export interface PanHandle {
  attach(): void;
  detach(): void;
}

function isPanTrigger(ev: PointerEventLike): boolean {
  return ev.button === 1 || ev.button === 2 || ev.altKey === true;
}

interface PointerEventLike {
  button: number;
  altKey: boolean;
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
}

export function createPanInteract(el: HTMLElement | SVGElement, cb: PanCallbacks): PanHandle {
  let dragging = false;
  let last: { x: number; y: number } | null = null;

  const onPointerDown = (ev: PointerEvent): void => {
    if (!isPanTrigger(ev)) return;
    ev.preventDefault();
    dragging = true;
    last = { x: ev.clientX, y: ev.clientY };
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragging || !last) return;
    const dx = ev.clientX - last.x;
    const dy = ev.clientY - last.y;
    last = { x: ev.clientX, y: ev.clientY };
    cb.onPan(dx, dy);
  };

  const onPointerUp = (): void => {
    dragging = false;
    last = null;
  };

  // Right-drag would otherwise pop the system context menu mid-pan.
  const onContextMenu = (ev: Event): void => {
    ev.preventDefault();
  };

  return {
    attach(): void {
      el.addEventListener('pointerdown', onPointerDown as EventListener);
      window.addEventListener('pointermove', onPointerMove as EventListener);
      window.addEventListener('pointerup', onPointerUp as EventListener);
      // pointercancel: system gestures (notification, app switcher) drop
      // pointer ownership; treat the same as pointerup so state doesn't leak.
      window.addEventListener('pointercancel', onPointerUp as EventListener);
      el.addEventListener('contextmenu', onContextMenu);
    },
    detach(): void {
      el.removeEventListener('pointerdown', onPointerDown as EventListener);
      window.removeEventListener('pointermove', onPointerMove as EventListener);
      window.removeEventListener('pointerup', onPointerUp as EventListener);
      window.removeEventListener('pointercancel', onPointerUp as EventListener);
      el.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
