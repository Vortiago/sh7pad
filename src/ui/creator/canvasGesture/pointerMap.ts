// Multi-pointer state shared by pinch + tap + long-press detectors.
// Just a typed wrapper around Map<pointerId, snapshot> — keeps the
// other modules from importing the bare Map shape.

export interface PointerSnapshot {
  clientX: number;
  clientY: number;
}

export type PointerMap = Map<number, PointerSnapshot>;

export function distance(a: PointerSnapshot, b: PointerSnapshot): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function midpoint(a: PointerSnapshot, b: PointerSnapshot): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}
