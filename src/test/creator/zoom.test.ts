import { describe, it, expect } from 'vitest';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, clampZoom } from '../../ui/creator/zoom/index.js';

describe('clampZoom', () => {
  it('passes a value inside [min, max] through unchanged', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it('clamps below the minimum', () => {
    expect(clampZoom(ZOOM_MIN - 0.5)).toBe(ZOOM_MIN);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(-10)).toBe(ZOOM_MIN);
  });

  it('clamps above the maximum', () => {
    expect(clampZoom(ZOOM_MAX + 0.5)).toBe(ZOOM_MAX);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
  });

  it('honours custom bounds', () => {
    expect(clampZoom(5, 1, 4)).toBe(4);
    expect(clampZoom(0.5, 1, 4)).toBe(1);
    expect(clampZoom(2, 1, 4)).toBe(2);
  });

  it('NaN-safe: returns min for non-finite input', () => {
    expect(clampZoom(NaN)).toBe(ZOOM_MIN);
    expect(clampZoom(Infinity)).toBe(ZOOM_MAX);
    expect(clampZoom(-Infinity)).toBe(ZOOM_MIN);
  });

  it('ZOOM_STEP is a sensible step factor (greater than 1)', () => {
    expect(ZOOM_STEP).toBeGreaterThan(1);
    expect(clampZoom(1 * ZOOM_STEP)).toBeCloseTo(ZOOM_STEP, 6);
  });
});
