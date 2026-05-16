import { describe, it, expect } from 'vitest';
import {
  boundsOf,
  stitchesBbox,
  viewBbox,
  xUmYumFromBbox,
  EMPTY_VIEW_BBOX,
} from '../../creator/bbox.js';
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

describe('boundsOf', () => {
  it('returns null for an empty iterable', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf((function* () { /* empty */ })())).toBeNull();
  });

  it('computes tight bounds over any iterable of points', () => {
    const pts = [
      { x: -3, y: 4 },
      { x: 7, y: -1 },
      { x: 2, y: 5 },
    ];
    expect(boundsOf(pts)).toEqual({ minX: -3, maxX: 7, minY: -1, maxY: 5 });
  });

  it('consumes generator inputs lazily', () => {
    function* gen() {
      yield { x: 1, y: 1 };
      yield { x: 9, y: 9 };
    }
    expect(boundsOf(gen())).toEqual({ minX: 1, maxX: 9, minY: 1, maxY: 9 });
  });
});

describe('xUmYumFromBbox', () => {
  it('returns zero dimensions for a null bbox', () => {
    expect(xUmYumFromBbox(null)).toEqual({ xUm: 0, yUm: 0 });
  });

  it('rounds (max - min) × scale to integer µm', () => {
    const bbox = { minX: 0, maxX: 12.3456, minY: -1, maxY: 2.5 };
    expect(xUmYumFromBbox(bbox)).toEqual({ xUm: 12346, yUm: 3500 });
  });

  it('honors per-axis scale factors (Y at 1500 µm/mm)', () => {
    const bbox = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    expect(xUmYumFromBbox(bbox, 1000, 1500)).toEqual({ xUm: 1000, yUm: 1500 });
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
