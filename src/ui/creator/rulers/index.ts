// Sticky top + left axis rulers anchored to the viewport edges, so the X/Y
// scale stays visible regardless of pan/zoom.
//
// Each ruler is its own SVG drawn into a DIV container (pure HTML elements
// with absolute positioning are easier to layer over the canvas). Adaptive
// tick spacing — finer ticks at higher zoom, coarser at low zoom.
//
// Coordinate-frame note: the ruler containers are CSS-shifted from the
// canvas wrap (.ed-ruler-top is `left: 34px` to clear the corner badge,
// .ed-ruler-left is `top: 22px`). The canvas SVG fills the entire wrap, so
// to make ruler ticks land on the same screen pixels as the canvas content
// for the same mm coordinate, we subtract the ruler's CSS offset from the
// projected SVG positions. `rulerOffset` is the wrap-relative position of
// each ruler's top-left corner.

import './rulers.css';
import { svgEl } from '../../svgDom.js';
import { formatX } from '../../../creator/format.js';
import type { Hoop } from '../../../creator/types.js';
import type { View } from '../editor/view.js';

const TICK_CHOICES = [1, 2, 5, 10, 20, 50, 100];

interface ContainerSize {
  w: number;
  h: number;
}

interface HoverHoop {
  x: number;
  y: number;
}

export interface RulerOffset {
  top: number;
  left: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function pickRulerStep(zoom: number, targetPx: number): number {
  const targetMm = targetPx / Math.max(0.0001, zoom);
  for (const c of TICK_CHOICES) {
    if (c >= targetMm) return c;
  }
  return TICK_CHOICES[TICK_CHOICES.length - 1]!;
}

export function renderRulers(
  topEl: HTMLElement,
  leftEl: HTMLElement,
  view: View,
  hoop: Hoop,
  hover: HoverHoop | null,
  container: ContainerSize,
  rulerOffset: RulerOffset = { top: 0, left: 0 },
  xLimitHalfW: number | null = null,
): void {
  topEl.replaceChildren();
  leftEl.replaceChildren();

  const topSvg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  topSvg.setAttribute('width', '100%');
  topSvg.setAttribute('height', '22');
  buildTopRuler(topSvg, view, hoop, hover, container, rulerOffset, xLimitHalfW);
  topEl.appendChild(topSvg);

  const leftSvg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  leftSvg.setAttribute('width', '34');
  leftSvg.setAttribute('height', '100%');
  buildLeftRuler(leftSvg, view, hoop, hover, container, rulerOffset);
  leftEl.appendChild(leftSvg);
}

function projectX(mmX: number, view: View, rulerOffset: RulerOffset): number {
  return mmX * view.zoom + view.offsetX - rulerOffset.left;
}

function projectY(mmY: number, view: View, rulerOffset: RulerOffset): number {
  return mmY * view.zoom + view.offsetY - rulerOffset.top;
}

function buildTopRuler(
  svg: SVGSVGElement,
  view: View,
  hoop: Hoop,
  hover: HoverHoop | null,
  container: ContainerSize,
  rulerOffset: RulerOffset,
  xLimitHalfW: number | null,
): void {
  const stepMm = pickRulerStep(view.zoom, 70);
  const effectiveHalfW = xLimitHalfW != null
    ? Math.min(hoop.halfW, xLimitHalfW)
    : hoop.halfW;
  const startX = Math.ceil(-effectiveHalfW / stepMm) * stepMm;
  const visibleW = container.w - rulerOffset.left;
  for (let x = startX; x <= effectiveHalfW; x += stepMm) {
    const xp = projectX(x, view, rulerOffset);
    if (xp < 0 || xp > visibleW + 8) continue;
    const isZero = Math.abs(x) < 0.001;
    const tickClasses = ['ruler-tick'];
    if (isZero) tickClasses.push('axis-tick');
    svg.appendChild(svgEl('line', {
      x1: xp, x2: xp, y1: 14, y2: 22,
    }, tickClasses));
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(xp));
    t.setAttribute('y', '11');
    t.setAttribute('text-anchor', 'middle');
    if (isZero) t.classList.add('axis-tick');
    t.textContent = isZero ? '0' : (x > 0 ? `+${x}` : `${x}`);
    svg.appendChild(t);
  }
  if (hover) {
    const hp = projectX(hover.x, view, rulerOffset);
    const hg = svgEl('g', {}, ['hover-tick']);
    hg.appendChild(svgEl('line', {
      x1: hp, x2: hp, y1: 0, y2: 22,
    }, ['hover-line']));
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(hp));
    t.setAttribute('y', '14');
    t.setAttribute('text-anchor', 'middle');
    t.textContent = formatX(hover.x);
    hg.appendChild(t);
    svg.appendChild(hg);
  }
}

function buildLeftRuler(
  svg: SVGSVGElement,
  view: View,
  hoop: Hoop,
  hover: HoverHoop | null,
  container: ContainerSize,
  rulerOffset: RulerOffset,
): void {
  const stepMm = pickRulerStep(view.zoom, 60);
  // Skip ticks that would land in the negative-Y region (above the design
  // origin) — clamp to the first whole step >= 0.
  const startY = Math.max(
    0,
    Math.ceil(((-(view.offsetY - rulerOffset.top)) / view.zoom) / stepMm) * stepMm,
  );
  const visibleH = container.h - rulerOffset.top;
  for (let y = startY; y <= hoop.h; y += stepMm) {
    const yp = projectY(y, view, rulerOffset);
    if (yp < 0 || yp > visibleH + 8) continue;
    svg.appendChild(svgEl('line', {
      x1: 26, x2: 34, y1: yp, y2: yp,
    }, ['ruler-tick']));
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '22');
    t.setAttribute('y', String(yp + 3));
    t.setAttribute('text-anchor', 'end');
    t.textContent = String(y);
    svg.appendChild(t);
  }
  if (hover) {
    const hp = projectY(hover.y, view, rulerOffset);
    const hg = svgEl('g', {}, ['hover-tick']);
    hg.appendChild(svgEl('line', {
      x1: 0, x2: 34, y1: hp, y2: hp,
    }, ['hover-line']));
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '22');
    t.setAttribute('y', String(hp + 3));
    t.setAttribute('text-anchor', 'end');
    t.textContent = hover.y.toFixed(1);
    hg.appendChild(t);
    svg.appendChild(hg);
  }
}
