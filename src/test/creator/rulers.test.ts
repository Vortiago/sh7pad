// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderRulers, pickRulerStep } from '../../ui/creator/rulers/index.js';
import type { View } from '../../ui/creator/editor/view.js';

const HOOP = { halfW: 60, h: 150 };

const makeView = (zoom: number, offsetX = 100, offsetY = 50): View => ({
  zoom, offsetX, offsetY, fitZoom: 1,
});

const newDiv = (): HTMLDivElement => document.createElement('div');

describe('pickRulerStep', () => {
  it('returns smaller step at high zoom', () => {
    const high = pickRulerStep(10, 70);
    const low = pickRulerStep(0.5, 70);
    expect(high).toBeLessThan(low);
  });

  it('uses one of the standard 1/2/5/10/20/50/100 mm steps', () => {
    const valid = new Set([1, 2, 5, 10, 20, 50, 100]);
    expect(valid.has(pickRulerStep(0.5, 70))).toBe(true);
    expect(valid.has(pickRulerStep(5, 70))).toBe(true);
    expect(valid.has(pickRulerStep(50, 70))).toBe(true);
  });
});

describe('renderRulers', () => {
  it('top ruler contains the X=0 tick with axis-tick class', () => {
    const top = newDiv();
    const left = newDiv();
    renderRulers(top, left, makeView(2), { halfW: HOOP.halfW, h: HOOP.h }, null, { w: 600, h: 600 });
    const axisTick = top.querySelector('.axis-tick');
    expect(axisTick).not.toBeNull();
  });

  it('left ruler contains numbered ticks', () => {
    const top = newDiv();
    const left = newDiv();
    renderRulers(top, left, makeView(2), HOOP, null, { w: 600, h: 600 });
    const labels = Array.from(left.querySelectorAll('text')).map((t) => t.textContent);
    expect(labels.length).toBeGreaterThan(0);
  });

  it('hover position renders a .hover-tick on both rulers', () => {
    const top = newDiv();
    const left = newDiv();
    renderRulers(top, left, makeView(2), HOOP, { x: 5, y: 10 }, { w: 600, h: 600 });
    expect(top.querySelector('.hover-tick')).not.toBeNull();
    expect(left.querySelector('.hover-tick')).not.toBeNull();
  });

  it('no .hover-tick when hover is null', () => {
    const top = newDiv();
    const left = newDiv();
    renderRulers(top, left, makeView(2), HOOP, null, { w: 600, h: 600 });
    expect(top.querySelector('.hover-tick')).toBeNull();
    expect(left.querySelector('.hover-tick')).toBeNull();
  });
});
