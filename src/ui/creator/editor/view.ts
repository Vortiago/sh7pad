// Pure view math for the editor canvas. Given the container size, hoop
// dimensions, user zoom (multiplier on top of fit), and pan offset, returns
// the zoom (px/mm) and screen-space origin (offsetX = where X=0 lives).
// Used by editor/render.ts and editor/interact.ts; kept pure so it's unit-testable.

import type { Hoop } from '../../../creator/types.js';

export interface ContainerSize {
  w: number;
  h: number;
}

export interface PanOffset {
  x: number;
  y: number;
}

export interface View {
  zoom: number;
  offsetX: number;
  offsetY: number;
  fitZoom: number;
}

const PADDING_PX = 36;
const MIN_FIT_ZOOM = 0.5;

export function computeView(
  container: ContainerSize,
  hoop: Hoop,
  userZoom: number,
  pan: PanOffset,
): View {
  const totalW = hoop.halfW * 2;
  const fitZoom = Math.max(
    MIN_FIT_ZOOM,
    Math.min(
      (container.w - PADDING_PX * 2) / totalW,
      (container.h - PADDING_PX * 2) / hoop.h,
    ),
  );
  const zoom = fitZoom * userZoom;
  // X=0 is centered horizontally; offsetX = the screen X where the stitch axis lives.
  const offsetX = (container.w - totalW * zoom) / 2 + hoop.halfW * zoom + pan.x;
  // Y=0 is at the top of the design area; offsetY = screen Y of the top edge.
  const offsetY = (container.h - hoop.h * zoom) / 2 + pan.y;
  return { zoom, offsetX, offsetY, fitZoom };
}
