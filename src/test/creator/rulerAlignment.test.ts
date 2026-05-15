// The X/Y rulers in the editor sit in CSS containers offset from the canvas
// (`.ed-ruler-top` is `left: 34px`, `.ed-ruler-left` is `top: 22px`). The
// canvas SVG fills the entire wrap, so a tick drawn at the same SVG
// coordinate in both elements lands at *different* screen pixels — a
// constant 34/22 px misalignment that looks zoom-dependent because the
// pixel error spans different mm-distances at different zooms.
//
// These tests pin the contract: the ruler renderer must compensate for the
// container offset so that, after CSS positioning, ruler ticks land on the
// same screen pixel as the canvas content for the same mm coordinate.
import { describe, it, expect } from 'vitest';
import { renderRulers } from '../../ui/creator/rulers/index.js';
import type { View } from '../../ui/creator/editor/view.js';

const HOOP = { halfW: 60, h: 40 };
const CONTAINER = { w: 600, h: 600 };
const RULER_OFFSET = { top: 22, left: 34 };

const makeView = (zoom: number, offsetX = 300, offsetY = 50): View => ({
  zoom, offsetX, offsetY, fitZoom: 1,
});

const newDiv = (): HTMLDivElement => document.createElement('div');

// Canvas SVG fills the entire wrap; a tick at mm-coordinate `mm` lives at
// screen pixel `mm * zoom + offset` (relative to the wrap's top-left).
const canvasScreenX = (mm: number, view: View) => mm * view.zoom + view.offsetX;
const canvasScreenY = (mm: number, view: View) => mm * view.zoom + view.offsetY;

describe('ruler alignment with the canvas', () => {
  for (const zoom of [0.5, 1, 2, 5]) {
    it(`top ruler hover line aligns with canvas X at zoom=${zoom}`, () => {
      const top = newDiv();
      const left = newDiv();
      const view = makeView(zoom);
      const hover = { x: 7.5, y: 12.3 };
      renderRulers(top, left, view, HOOP, hover, CONTAINER, RULER_OFFSET);

      const line = top.querySelector('.hover-line') as SVGLineElement | null;
      expect(line, 'top hover-line must be rendered').not.toBeNull();
      const svgX = Number(line!.getAttribute('x1'));
      // Screen pixel = svgX + ruler container's CSS left offset.
      expect(svgX + RULER_OFFSET.left).toBeCloseTo(canvasScreenX(hover.x, view), 5);
    });

    it(`left ruler hover line aligns with canvas Y at zoom=${zoom}`, () => {
      const top = newDiv();
      const left = newDiv();
      const view = makeView(zoom);
      const hover = { x: 7.5, y: 12.3 };
      renderRulers(top, left, view, HOOP, hover, CONTAINER, RULER_OFFSET);

      const line = left.querySelector('.hover-line') as SVGLineElement | null;
      expect(line, 'left hover-line must be rendered').not.toBeNull();
      const svgY = Number(line!.getAttribute('y1'));
      expect(svgY + RULER_OFFSET.top).toBeCloseTo(canvasScreenY(hover.y, view), 5);
    });

    it(`top ruler X=0 axis tick lands on the canvas X=0 column at zoom=${zoom}`, () => {
      const top = newDiv();
      const left = newDiv();
      const view = makeView(zoom);
      renderRulers(top, left, view, HOOP, null, CONTAINER, RULER_OFFSET);

      const axisTick = top.querySelector('line.axis-tick') as SVGLineElement | null;
      expect(axisTick, 'X=0 axis tick must be rendered').not.toBeNull();
      const svgX = Number(axisTick!.getAttribute('x1'));
      expect(svgX + RULER_OFFSET.left).toBeCloseTo(canvasScreenX(0, view), 5);
    });

    it(`left ruler Y=0 tick lands on the canvas Y=0 row at zoom=${zoom}`, () => {
      const top = newDiv();
      const left = newDiv();
      const view = makeView(zoom);
      renderRulers(top, left, view, HOOP, null, CONTAINER, RULER_OFFSET);

      // The "0" label is the topmost numbered tick in the left ruler.
      const zeroLabel = Array.from(left.querySelectorAll('text')).find(
        (t) => t.textContent === '0',
      );
      expect(zeroLabel, 'Y=0 label must be rendered').not.toBeNull();
      // Tick line for that row.
      const lines = Array.from(left.querySelectorAll('line.ruler-tick')) as SVGLineElement[];
      const expectedSvgY = canvasScreenY(0, view) - RULER_OFFSET.top;
      const found = lines.some(
        (ln) => Math.abs(Number(ln.getAttribute('y1')) - expectedSvgY) < 0.5,
      );
      expect(found, `expected a tick line at svgY≈${expectedSvgY}`).toBe(true);
    });
  }

  it('zero offset behaves as raw projection (sanity check)', () => {
    const top = newDiv();
    const left = newDiv();
    const view = makeView(2);
    const hover = { x: 4, y: 8 };
    renderRulers(top, left, view, HOOP, hover, CONTAINER, { top: 0, left: 0 });

    const lineTop = top.querySelector('.hover-line') as SVGLineElement;
    expect(Number(lineTop.getAttribute('x1'))).toBeCloseTo(4 * 2 + view.offsetX, 5);
    const lineLeft = left.querySelector('.hover-line') as SVGLineElement;
    expect(Number(lineLeft.getAttribute('y1'))).toBeCloseTo(8 * 2 + view.offsetY, 5);
  });
});
