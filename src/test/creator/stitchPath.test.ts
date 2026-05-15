import { describe, it, expect } from 'vitest';
import { encodeSegments } from '../../creator/pipeline/encodeSegments.js';
import { foot } from '../../creator/foot.js';
import { planFootGroupedBySegment } from '../../creator/carriagePlanner.js';
import { trackFoot } from '../../creator/pipeline/trackFoot.js';
import { X_UNITS_PER_MM, Y_UNITS_PER_MM } from '../../parser/units.js';
import type { Point, Segment } from '../../creator/types.js';

const FOOT_B = foot('B');
const FOOT_S = foot('S');

const pt = (id: string, x: number, y: number): Point => ({ id, x, y });

describe('encodeSegments (Foot B / non-side-motion path)', () => {
  it('returns an empty sequence for empty input', () => {
    const seq = encodeSegments([], [], FOOT_B);
    expect(seq).toEqual([]);
  });

  it('returns an empty sequence when segments reference missing points', () => {
    const points = [pt('a', 0, 0)];
    const segments: Segment[] = [
      { id: 's1', from: 'ghost', to: 'a', type: 'straight' },
    ];
    const seq = encodeSegments(points, segments, FOOT_B);
    expect(seq).toEqual([]);
  });

  it('a 6 mm Foot B segment walks the carriage (1 leading needle + jumps)', () => {
    // Under the unified carriage planner, Foot B walks the carriage
    // exactly like Foot S — its narrower ±4.5 mm reach just bounds it
    // sooner. A 6 mm rightward segment lands one Phase-A needle at the
    // 3.5 mm slot edge, then Phase B walks 2.5 mm in 3 pieces (two 1 mm
    // jumps + one 0.5 mm tail) bringing the carriage to 2.5 mm (well
    // inside Foot B's ±4.5 mm reach).
    const points = [pt('a', 0, 0), pt('b', 6, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_B);
    expect(seq).toHaveLength(5); // start + 1 Phase A + 3 walks
    expect(seq[0]).toMatchObject({ x: 0, y: 0, kind: 'start' });
    expect(seq[1]?.kind).toBe('needle');
    expect(seq[1]?.x).toBeCloseTo(3.5);
    for (let i = 2; i <= 4; i++) expect(seq[i]?.kind).toBe('jump');
    expect(seq[4]?.x).toBeCloseTo(6);
  });

  it('a Foot B segment that would walk the carriage past ±4.5 mm reach throws FootEncodeException', () => {
    // 12 mm rightward needs the carriage to walk 12 − 3.5 = 8.5 mm past
    // its start — beyond Foot B's ±4.5 mm reach. The unified planner refuses.
    const points = [pt('a', 0, 0), pt('b', 12, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    expect(() => encodeSegments(points, segments, FOOT_B)).toThrow(
      /Foot B \(Decorative\): carriage would exceed/,
    );
  });

  it('a tiny straight segment (<1mm) still produces at least the end stitch', () => {
    const points = [pt('a', 0, 0), pt('b', 0.5, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_B);
    expect(seq.length).toBeGreaterThanOrEqual(2);
    const last = seq[seq.length - 1]!;
    expect(last.x).toBeCloseTo(0.5);
    expect(last.y).toBeCloseTo(0);
  });

  it('every stitch carries its parent segment index in sourceIndex (start = -1)', () => {
    const points = [pt('a', 0, 0), pt('b', 6, 0), pt('c', 6, 6)];
    const segments: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ];
    const seq = encodeSegments(points, segments, FOOT_B);
    expect(seq[0]!.sourceIndex).toBe(-1); // start marker
    const seg0 = seq.filter((s) => s.sourceIndex === 0);
    const seg1 = seq.filter((s) => s.sourceIndex === 1);
    expect(seg0.length).toBeGreaterThan(0);
    expect(seg1.length).toBeGreaterThan(0);
  });

  it('a satin segment (top→bottom) starts on the LEFT side and ends on the RIGHT side', () => {
    const points = [pt('a', 0, 0), pt('b', 0, 10)];
    const segments: Segment[] = [{
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 4, widthEnd: 4, density: 1,
    }];
    const seq = encodeSegments(points, segments, FOOT_B);
    const satinStitches = seq.filter((s) => s.kind !== 'start');
    const first = satinStitches[0]!;
    const last = satinStitches[satinStitches.length - 1]!;
    expect(first.x).toBeLessThan(0);
    expect(last.x).toBeGreaterThan(0);
  });

  it('a satin with widthStart != widthEnd tapers linearly (offsets grow with t)', () => {
    const points = [pt('a', 0, 0), pt('b', 0, 12)];
    const segments: Segment[] = [{
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2, widthEnd: 6, density: 1,
    }];
    const stitches = encodeSegments(points, segments, FOOT_B)
      .filter((s) => s.kind !== 'start');
    const offsets = stitches.map((s) => Math.abs(s.x));
    const first = offsets[0]!;
    const last = offsets[offsets.length - 1]!;
    expect(last).toBeGreaterThan(first);
  });

  it('a satin segment uses density (mm spacing) to choose its step count', () => {
    const points = [pt('a', 0, 0), pt('b', 0, 12)];
    const dense: Segment[] = [{
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2, widthEnd: 2, density: 0.5,
    }];
    const sparse: Segment[] = [{
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2, widthEnd: 2, density: 2,
    }];
    const denseSeq = encodeSegments(points, dense, FOOT_B);
    const sparseSeq = encodeSegments(points, sparse, FOOT_B);
    expect(denseSeq.length).toBeGreaterThan(sparseSeq.length);
  });

  it('a degenerate zero-length segment does not crash and produces at least one stitch', () => {
    // A 0-mm segment emits one no-op needle record (dx=0, dy=0). It looks
    // pointless but it's a tack stitch: the needle drops at the cursor
    // position to anchor the thread before any motion. Imported designs
    // commonly have this as their first record (the foot-S singleton reference's source
    // bytes start with `(dx=0, dy=0)` for exactly this reason).
    const points = [pt('a', 5, 5), pt('b', 5, 5)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_B);
    expect(seq.length).toBeGreaterThanOrEqual(2);
    expect(() => encodeSegments(points, segments, FOOT_B)).not.toThrow();
  });
});

describe('encodeSegments — Foot S preview matches the planner record sequence', () => {
  it('a 20mm horizontal segment under Foot S: 1 leading needle to the slot edge, then walks of ≤ 1 mm', () => {
    const points = [pt('a', 0, 0), pt('b', 20, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    // start + 1 Phase A short + 17 Phase B pieces. (132 raw remaining
    // after Phase A; n = ceil(132/8) = 17, with the last piece carrying
    // the 4-raw remainder.)
    expect(stitches).toHaveLength(19);
    expect(stitches[0]).toMatchObject({ x: 0, y: 0, kind: 'start' });
    // Phase A short reaches the 3.5 mm slot edge in a single record.
    expect(stitches[1]?.kind).toBe('needle');
    expect(stitches[1]?.x).toBeCloseTo(3.5, 5);
    expect(stitches[1]?.y).toBeCloseTo(0, 5);
    // Phase B: 16 jumps of 1 mm each (cursor 4.5, 5.5, …, 19.5) plus a
    // final 0.5 mm jump bringing the cursor to 20.
    for (let i = 2; i <= 17; i++) {
      expect(stitches[i]?.kind).toBe('jump');
      expect(stitches[i]?.x).toBeCloseTo(3.5 + (i - 1), 5);
      expect(stitches[i]?.y).toBeCloseTo(0, 5);
    }
    expect(stitches[18]?.kind).toBe('jump');
    expect(stitches[18]?.x).toBeCloseTo(20, 5);
  });

  it('a small in-window segment under Foot S emits one stitch at the endpoint', () => {
    const points = [pt('a', 0, 0), pt('b', 0.5, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(2);
    expect(stitches[1]?.x).toBeCloseTo(0.5, 5);
  });

  it('a 3 mm in-window horizontal segment under Foot S is a single needle (no v1-style splitting)', () => {
    // 3 mm ≤ slot half (3.5 mm) → single in-window needle.
    const points = [pt('a', 0, 0), pt('b', 3, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(2);
    expect(stitches[1]?.x).toBeCloseTo(3, 5);
    expect(stitches[1]?.kind).toBe('needle');
  });

  it('a pure-Y segment under Foot S subdivides for the per-record dy cap (12 mm dy → 3 needles)', () => {
    // 12 mm = 144 raw, beyond STITCH_DY_MAX_RAW (48). The planner
    // splits into 3 records of dy=48 each. dx=0 never busts the slot,
    // so every record is a needle.
    const points = [pt('a', 0, 0), pt('b', 0, 12)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(4); // start + 3 Y-cap pieces
    expect(stitches[3]?.y).toBeCloseTo(12, 5);
    for (let i = 1; i <= 3; i++) expect(stitches[i]?.kind).toBe('needle');
  });

  it('a diagonal segment under Foot S coalesces Phase A then walks with proportional Y', () => {
    // dx=80 raw (10 mm), dy=60 raw (5 mm). Phase A reaches the slot edge
    // (28 raw / 3.5 mm) with proportional dy = round(60·28/80) = 21 raw
    // (1.75 mm). Phase B walks the remaining 52 raw in 7 pieces (six of
    // 8 raw + one of 4 raw), with dy distributed cumulatively along the
    // segment line. Stitches lie on the segment y = x/2 because the
    // planner targets the line at each piece's endpoint.
    const points = [pt('a', 0, 0), pt('b', 10, 5)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(9); // start + 1 Phase A + 7 Phase B
    expect(stitches[1]?.x).toBeCloseTo(3.5, 5);
    expect(stitches[1]?.y).toBeCloseTo(1.75, 5);
    // Each Phase B piece's (x, y) lands on the segment line y = x / 2.
    for (let i = 2; i <= 8; i++) {
      const x = stitches[i]!.x;
      expect(stitches[i]?.y).toBeCloseTo(x / 2, 1);
    }
    expect(stitches[8]?.x).toBeCloseTo(10, 5);
    expect(stitches[8]?.y).toBeCloseTo(5, 5);
  });

  it('preserves negative dx direction', () => {
    const points = [pt('a', 10, 0), pt('b', 0, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(9); // start + 1 Phase A + 7 walks
    // Phase A short pushes the needle 3.5 mm leftward to the slot edge.
    expect(stitches[1]?.x).toBeCloseTo(6.5, 5);
    // Walks advance the carriage leftward: 6 of 1 mm + 1 of 0.5 mm.
    for (let i = 2; i <= 7; i++) {
      expect(stitches[i]?.x).toBeCloseTo(6.5 - (i - 1), 5); // 5.5, 4.5, …, 0.5
    }
    expect(stitches[8]?.x).toBeCloseTo(0, 5);
  });

  it('Foot S stitch kinds match the planner (in-window=needle, busted segment = leading needle + trailing jumps)', () => {
    const inWindow: Point[] = [pt('a', 0, 0), pt('b', 3, 0)];
    const segIn: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const inSeq = encodeSegments(inWindow, segIn, FOOT_S);
    expect(inSeq).toHaveLength(2);
    expect(inSeq[1]?.kind).toBe('needle');

    const busts: Point[] = [pt('a', 0, 0), pt('b', 10, 0)];
    const segBust: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const bustSeq = encodeSegments(busts, segBust, FOOT_S);
    expect(bustSeq).toHaveLength(9);
    // Piece 1: one Phase-A needle reaching the slot edge.
    // Pieces 2..8: walks of 1 mm each.
    expect(bustSeq[1]?.kind).toBe('needle');
    for (let i = 2; i <= 8; i++) expect(bustSeq[i]?.kind).toBe('jump');
  });

  it('Foot S carriage (via trackFoot) stays planted under Phase A, then advances per jump piece', () => {
    const points = [pt('a', 0, 0), pt('b', 10, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_S);
    expect(seq).toHaveLength(9);
    const track = trackFoot(seq);
    // Phase A: needle reaches the slot edge, carriage planted at 0.
    expect(track[1]?.carriageXMm).toBeCloseTo(0, 5);
    // Phase B walks: 6 pieces of 1 mm + 1 of 0.5 mm = 6.5 mm carriage walk.
    for (let i = 2; i <= 7; i++) {
      expect(track[i]?.carriageXMm).toBeCloseTo(i - 1, 5);
    }
    expect(track[8]?.carriageXMm).toBeCloseTo(6.5, 5);

    // 3 mm fits inside the slot half (3.5 mm) → single needle,
    // carriage stays planted at 0.
    const planted = [pt('a', 0, 0), pt('b', 3, 0)];
    const segPlanted: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const plantedSeq = encodeSegments(planted, segPlanted, FOOT_S);
    const plantedTrack = trackFoot(plantedSeq);
    expect(plantedTrack[1]?.carriageXMm).toBeCloseTo(0, 5);
  });

  it('Foot S stitch positions equal planner record end positions exactly', () => {
    const points = [pt('a', 0, 0), pt('b', 10, 5)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_S);

    const groupedResult = planFootGroupedBySegment(
      FOOT_S,
      [{
        dxRaw: Math.round(10 * X_UNITS_PER_MM),
        dyRaw: Math.round(5 * Y_UNITS_PER_MM),
      }],
    );
    expect(groupedResult.ok).toBe(true);
    if (!groupedResult.ok) throw new Error('planner unexpectedly refused');
    const records = groupedResult.buckets[0]!;
    expect(seq).toHaveLength(records.length + 1);
    const track = trackFoot(seq);
    for (let i = 0; i < records.length; i++) {
      const s = seq[i + 1]!;
      expect(s.x).toBeCloseTo(records[i]!.endXMm, 9);
      expect(s.y).toBeCloseTo(records[i]!.endYMm, 9);
      expect(track[i + 1]?.carriageXMm).toBeCloseTo(records[i]!.carriageXMm, 9);
      const expectedKind = records[i]!.kind === 'jump' ? 'jump' : 'needle';
      expect(s.kind).toBe(expectedKind);
    }
  });

  it('Foot B carriage walks just like Foot S — only its reach bound differs', () => {
    // 6 mm rightward under Foot B: one Phase-A needle to the 3.5 mm slot
    // edge keeps the carriage planted, then 3 jumps walk it 2.5 mm to
    // the segment end — all within Foot B's ±4.5 mm reach. The carriage
    // advances on jumps, identically to Foot S; the only difference is
    // when reach is exceeded.
    const points = [pt('a', 0, 0), pt('b', 6, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_B);
    const track = trackFoot(seq);
    // start + Phase A needle: carriage planted at 0.
    expect(track[0]?.carriageXMm).toBeCloseTo(0, 5);
    expect(track[1]?.carriageXMm).toBeCloseTo(0, 5);
    // 3 Phase-B pieces walk the carriage 1, 2, 2.5 mm.
    expect(track[2]?.carriageXMm).toBeCloseTo(1, 5);
    expect(track[3]?.carriageXMm).toBeCloseTo(2, 5);
    expect(track[4]?.carriageXMm).toBeCloseTo(2.5, 5);
    // Final carriage X stays inside Foot B's ±4.5 mm reach.
    expect(Math.abs(track[4]!.carriageXMm)).toBeLessThanOrEqual(4.5);
  });

  it('start stitch is emitted regardless of foot', () => {
    const points = [pt('a', 0, 0), pt('b', 10, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches[0]?.kind).toBe('start');
  });

  it('cache invalidates when foot changes (segment that fits both feet)', () => {
    // 6 mm wide fits both Foot B (carriage walks to 3 mm ≤ 4.5 mm reach)
    // and Foot S. Both should produce the same record sequence — the only
    // per-foot difference is reach, and neither foot busts it here.
    const points = [pt('a', 0, 0), pt('b', 6, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const footS = encodeSegments(points, segments, FOOT_S);
    const footB = encodeSegments(points, segments, FOOT_B);
    expect(footS.length).toBe(5);
    expect(footB.length).toBe(5);
    const footSAgain = encodeSegments(points, segments, FOOT_S);
    expect(footSAgain.length).toBe(5);
  });
});
