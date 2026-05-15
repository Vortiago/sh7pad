import { describe, it, expect } from 'vitest';
import { stitchesBbox, viewBbox, EMPTY_VIEW_BBOX } from '../../creator/bbox.js';
import type { Stitch } from '../../creator/pipeline/stitch.js';

const needle = (x: number, y: number): Stitch => ({
  kind: 'needle', x, y, dxRaw: 0, dyRaw: 0, sourceIndex: -1, carriageXMm: 0,
});

describe('stitchesBbox', () => {
  it('returns the empty bbox when there are no stitches', () => {
    expect(stitchesBbox([])).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });

  it('computes tight bounds across mixed stitches', () => {
    const stitches = [needle(-5, 1), needle(3, 8), needle(-2, 4), needle(7, 0)];
    expect(stitchesBbox(stitches)).toEqual({ minX: -5, maxX: 7, minY: 0, maxY: 8 });
  });
});

describe('viewBbox', () => {
  it('returns EMPTY_VIEW_BBOX (the seed view) for an empty stitch list', () => {
    expect(viewBbox([], 6)).toEqual(EMPTY_VIEW_BBOX);
  });

  it('always includes X in [-2, +2] even when all stitches are positive', () => {
    const stitches = [needle(20, 5), needle(40, 10), needle(60, 15)];
    const v = viewBbox(stitches, 6);
    expect(v.minX).toBeLessThanOrEqual(-2);
    expect(v.maxX).toBeGreaterThanOrEqual(40);
  });

  it('always includes X in [-2, +2] even when all stitches are negative', () => {
    const stitches = [needle(-20, 5), needle(-40, 10)];
    const v = viewBbox(stitches, 6);
    expect(v.minX).toBeLessThanOrEqual(-40);
    expect(v.maxX).toBeGreaterThanOrEqual(2);
  });

  it('expands the bbox by the margin (mm) on every side', () => {
    const stitches = [needle(0, 10), needle(0, 20)];
    const v = viewBbox(stitches, 6);
    expect(v.minY).toBeCloseTo(10 - 6);
    expect(v.maxY).toBeCloseTo(20 + 6);
  });
});
