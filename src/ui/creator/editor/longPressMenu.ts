// Long-press menu helpers for the editor canvas. Hit-test resolves a
// point/segment id under a viewport coordinate; buildLongPressItems
// turns the hit into a contextMenu items list. Both kept pure so the
// orchestrator's wiring stays small.

import type { ContextMenuItem } from '../contextMenu/index.js';

export interface LongPressTarget {
  kind: 'point' | 'segment';
  id: string;
}

export interface LongPressOps {
  deleteSegment(id: string): void;
  deletePoint(id: string): void;
  subdivideSegment(id: string): void;
  convertSegment(id: string): void;
  currentSegmentType(id: string): 'straight' | 'satin' | undefined;
}

/** Hit-test the SVG at viewport coords; resolves to a point or
 *  segment id. jsdom (test env) doesn't implement elementsFromPoint
 *  — we return null there so the long-press fires no menu (safe no-op). */
export function hitTestCanvas(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): LongPressTarget | null {
  const doc = svg.ownerDocument ?? document;
  if (typeof doc.elementsFromPoint !== 'function') return null;
  const nodes = doc.elementsFromPoint(clientX, clientY);
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    const ptHost = node.closest('[data-point-id]');
    if (ptHost) return { kind: 'point', id: ptHost.getAttribute('data-point-id')! };
    const segHost = node.closest('[data-segment-id]');
    if (segHost) return { kind: 'segment', id: segHost.getAttribute('data-segment-id')! };
  }
  return null;
}

/** Build the long-press menu items for a hit. Returns [] for empty canvas
 *  so the recognizer can decline to open a menu. */
export function buildLongPressItems(
  target: LongPressTarget | null,
  ops: LongPressOps,
): ContextMenuItem[] {
  if (!target) return [];
  if (target.kind === 'segment') {
    const cur = ops.currentSegmentType(target.id);
    const convertLabel = cur === 'satin' ? 'Convert to straight' : 'Convert to satin';
    return [
      { label: 'Subdivide', action: 'subdivide-segment', onClick: () => ops.subdivideSegment(target.id) },
      { label: convertLabel, action: 'convert-segment', onClick: () => ops.convertSegment(target.id) },
      { label: 'Delete segment', action: 'delete-segment', danger: true, onClick: () => ops.deleteSegment(target.id) },
    ];
  }
  return [
    { label: 'Delete point', action: 'delete-point', danger: true, onClick: () => ops.deletePoint(target.id) },
  ];
}
