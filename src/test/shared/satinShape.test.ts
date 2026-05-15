import { describe, it, expect } from 'vitest';
import { coneCorners, satinStitches, satinTrailerEnd, spineToEdges } from '../../shared/satinShape.js';

describe('satinStitches — .sh7 satin invariant (Slice 1)', () => {
  it('vertical uniform satin: first stitch starts at TL, last ends at BR', () => {
    const edges = {
      leftPoints: [{ x: 0, y: 0 }, { x: 0, y: 10 }],
      rightPoints: [{ x: 2, y: 0 }, { x: 2, y: 10 }],
    };
    const stitches = satinStitches(edges, 1);
    expect(stitches.length).toBeGreaterThanOrEqual(1);
    const first = stitches[0]!;
    const last = stitches[stitches.length - 1]!;
    expect(first.start.x).toBeCloseTo(0, 6);
    expect(first.start.y).toBeCloseTo(0, 6);
    expect(last.end.x).toBeCloseTo(2, 6);
    expect(last.end.y).toBeCloseTo(10, 6);
  });

  it('consecutive stitches share an endpoint (forms a connected zigzag)', () => {
    const edges = {
      leftPoints: [{ x: 0, y: 0 }, { x: 0, y: 10 }],
      rightPoints: [{ x: 2, y: 0 }, { x: 2, y: 10 }],
    };
    const stitches = satinStitches(edges, 0.5);
    expect(stitches.length).toBeGreaterThan(2);
    for (let i = 1; i < stitches.length; i++) {
      expect(stitches[i]!.start.x).toBeCloseTo(stitches[i - 1]!.end.x, 6);
      expect(stitches[i]!.start.y).toBeCloseTo(stitches[i - 1]!.end.y, 6);
    }
  });

  it('coneCorners returns the four endpoint corners of the edge curves', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1.5, y: 5 };
    const c = { x: 1, y: 8 };
    const d = { x: 4, y: 2 };
    const e = { x: 3.5, y: 5 };
    const f = { x: 4, y: 8 };
    const corners = coneCorners({ leftPoints: [a, b, c], rightPoints: [d, e, f] });
    expect(corners.tl).toEqual(a);
    expect(corners.tr).toEqual(d);
    expect(corners.bl).toEqual(c);
    expect(corners.br).toEqual(f);
  });

  it('spineToEdges (vertical tapered): perpendicular offsets place TL/TR at the start, BL/BR at the end', () => {
    const edges = spineToEdges({
      from: { x: 0, y: 0 },
      to: { x: 0, y: 10 },
      widthStart: 2,
      widthEnd: 4,
    });
    expect(edges.leftPoints).toHaveLength(2);
    expect(edges.rightPoints).toHaveLength(2);
    expect(edges.leftPoints[0]!.x).toBeCloseTo(-1, 6);
    expect(edges.leftPoints[0]!.y).toBeCloseTo(0, 6);
    expect(edges.rightPoints[0]!.x).toBeCloseTo(1, 6);
    expect(edges.rightPoints[0]!.y).toBeCloseTo(0, 6);
    expect(edges.leftPoints[1]!.x).toBeCloseTo(-2, 6);
    expect(edges.leftPoints[1]!.y).toBeCloseTo(10, 6);
    expect(edges.rightPoints[1]!.x).toBeCloseTo(2, 6);
    expect(edges.rightPoints[1]!.y).toBeCloseTo(10, 6);
  });

  it('spineToEdges (horizontal): perp is along ±Y', () => {
    const edges = spineToEdges({
      from: { x: 0, y: 5 },
      to: { x: 10, y: 5 },
      widthStart: 2,
      widthEnd: 2,
    });
    // Spine is +X. Perp = (-dy, dx)/len = (0, 1) → "left" of spine = +Y direction.
    expect(edges.leftPoints[0]!.x).toBeCloseTo(0, 6);
    expect(edges.leftPoints[0]!.y).toBeCloseTo(6, 6);
    expect(edges.rightPoints[0]!.y).toBeCloseTo(4, 6);
    expect(edges.leftPoints[1]!.y).toBeCloseTo(6, 6);
    expect(edges.rightPoints[1]!.y).toBeCloseTo(4, 6);
  });

  it('curved edges (≥3 points per side): endpoints stay within the cone bbox', () => {
    // A curved cone: pinch in the middle on both sides.
    const edges = {
      leftPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 5 },
        { x: 0, y: 10 },
      ],
      rightPoints: [
        { x: 4, y: 0 },
        { x: 3, y: 5 },
        { x: 4, y: 10 },
      ],
    };
    const stitches = satinStitches(edges, 0.4);
    expect(stitches.length).toBeGreaterThan(0);
    const minX = 0, maxX = 4, minY = 0, maxY = 10;
    for (const s of stitches) {
      expect(s.start.x).toBeGreaterThanOrEqual(minX - 1e-9);
      expect(s.start.x).toBeLessThanOrEqual(maxX + 1e-9);
      expect(s.start.y).toBeGreaterThanOrEqual(minY - 1e-9);
      expect(s.start.y).toBeLessThanOrEqual(maxY + 1e-9);
      expect(s.end.x).toBeGreaterThanOrEqual(minX - 1e-9);
      expect(s.end.x).toBeLessThanOrEqual(maxX + 1e-9);
      expect(s.end.y).toBeGreaterThanOrEqual(minY - 1e-9);
      expect(s.end.y).toBeLessThanOrEqual(maxY + 1e-9);
    }
  });
});

describe('satinTrailerEnd — chain-exit override', () => {
  const edges = {
    leftPoints: [{ x: -2, y: 0 }, { x: -2, y: 10 }],
    rightPoints: [{ x: 2, y: 0 }, { x: 2, y: 10 }],
  };

  it("returns null for endAt='right' (default — no trailer needed)", () => {
    expect(satinTrailerEnd(edges, 'right')).toBeNull();
  });

  it('returns null for undefined (defaults to right)', () => {
    expect(satinTrailerEnd(edges, undefined)).toBeNull();
  });

  it("returns the BL corner for endAt='left'", () => {
    const target = satinTrailerEnd(edges, 'left');
    expect(target).not.toBeNull();
    expect(target!.x).toBeCloseTo(-2, 6);
    expect(target!.y).toBeCloseTo(10, 6);
  });

  it("returns the spine endpoint (midpoint of BL and BR) for endAt='center'", () => {
    const target = satinTrailerEnd(edges, 'center');
    expect(target).not.toBeNull();
    expect(target!.x).toBeCloseTo(0, 6);
    expect(target!.y).toBeCloseTo(10, 6);
  });

  it('center on a tapered cone places the target on the spine endpoint, not the cone bbox centre', () => {
    const tapered = {
      leftPoints: [{ x: -1, y: 0 }, { x: -3, y: 10 }],
      rightPoints: [{ x: 1, y: 0 }, { x: 3, y: 10 }],
    };
    const target = satinTrailerEnd(tapered, 'center');
    expect(target!.x).toBeCloseTo(0, 6);
    expect(target!.y).toBeCloseTo(10, 6);
  });
});
