import { describe, it, expect } from 'vitest';
import { computeView } from '../../ui/creator/editor/view.js';

const HOOP = { halfW: 60, h: 150 };
const NO_PAN = { x: 0, y: 0 };

describe('computeView', () => {
  it('produces a positive zoom that fits the hoop with padding', () => {
    const v = computeView({ w: 600, h: 600 }, HOOP, 1, NO_PAN);
    expect(v.zoom).toBeGreaterThan(0);
    expect(v.zoom).toBeLessThan(10);
  });

  it('userZoom=2 doubles the base zoom', () => {
    const a = computeView({ w: 600, h: 600 }, HOOP, 1, NO_PAN);
    const b = computeView({ w: 600, h: 600 }, HOOP, 2, NO_PAN);
    expect(b.zoom).toBeCloseTo(a.zoom * 2);
  });

  it('userZoom=0.5 halves the base zoom (down to the floor of 0.5×fit)', () => {
    const a = computeView({ w: 600, h: 600 }, HOOP, 1, NO_PAN);
    const b = computeView({ w: 600, h: 600 }, HOOP, 0.5, NO_PAN);
    expect(b.zoom).toBeCloseTo(a.zoom * 0.5);
  });

  it('pan offsets shift offsetX and offsetY by the same amounts', () => {
    const a = computeView({ w: 600, h: 600 }, HOOP, 1, { x: 0, y: 0 });
    const b = computeView({ w: 600, h: 600 }, HOOP, 1, { x: 50, y: 25 });
    expect(b.offsetX - a.offsetX).toBeCloseTo(50);
    expect(b.offsetY - a.offsetY).toBeCloseTo(25);
  });

  it('places X=0 in screen coordinates equal to offsetX', () => {
    const v = computeView({ w: 800, h: 400 }, HOOP, 1, NO_PAN);
    // The X=0 stitch axis maps to screen x = offsetX.
    expect(v.offsetX).toBeGreaterThan(0);
    expect(v.offsetX).toBeLessThan(800);
  });

  it('floors zoom at 0.4 even when userZoom is tiny', () => {
    const v = computeView({ w: 600, h: 600 }, HOOP, 0.0001, NO_PAN);
    expect(v.zoom).toBeGreaterThanOrEqual(0.0001 * 0.4); // not below absolute floor
  });
});
