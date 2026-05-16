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
    // Sequence layout: seq[0] = 'start' marker, seq[1] = **Start
    // Stitch** needle (a (0, 0) no-op needle drop), seq[2..] = user
    // records. Under the unified carriage planner, Foot B walks the
    // carriage exactly like Foot S — its narrower ±4.5 mm reach just
    // bounds it sooner. A 6 mm rightward segment lands one Phase-A
    // needle at the 3.5 mm slot edge, then Phase B walks 2.5 mm in 3
    // pieces (two 1 mm jumps + one 0.5 mm tail).
    const points = [pt('a', 0, 0), pt('b', 6, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_B);
    expect(seq).toHaveLength(6); // start + start-stitch + 1 Phase A + 3 walks
    expect(seq[0]).toMatchObject({ x: 0, y: 0, kind: 'start' });
    expect(seq[1]?.kind).toBe('needle'); // Start Stitch
    expect(seq[1]?.x).toBeCloseTo(0);
    expect(seq[2]?.kind).toBe('needle');
    expect(seq[2]?.x).toBeCloseTo(3.5);
    for (let i = 3; i <= 5; i++) expect(seq[i]?.kind).toBe('jump');
    expect(seq[5]?.x).toBeCloseTo(6);
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
    // Drop the 'start' marker AND the leading Start Stitch (sourceIndex=-1
    // needle at (0, 0)) so we compare against the actual satin geometry.
    const satinStitches = seq.filter(
      (s) => s.kind !== 'start' && s.sourceIndex !== -1,
    );
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
    // start + Start Stitch needle + 1 Phase A short + 17 Phase B pieces.
    // (132 raw remaining after Phase A; n = ceil(132/8) = 17, with the
    // last piece carrying the 4-raw remainder.)
    expect(stitches).toHaveLength(20);
    expect(stitches[0]).toMatchObject({ x: 0, y: 0, kind: 'start' });
    expect(stitches[1]?.kind).toBe('needle'); // Start Stitch at (0, 0)
    // Phase A short reaches the 3.5 mm slot edge in a single record.
    expect(stitches[2]?.kind).toBe('needle');
    expect(stitches[2]?.x).toBeCloseTo(3.5, 5);
    expect(stitches[2]?.y).toBeCloseTo(0, 5);
    // Phase B: 16 jumps of 1 mm each (cursor 4.5, 5.5, …, 19.5) plus a
    // final 0.5 mm jump bringing the cursor to 20.
    for (let i = 3; i <= 18; i++) {
      expect(stitches[i]?.kind).toBe('jump');
      expect(stitches[i]?.x).toBeCloseTo(3.5 + (i - 2), 5);
      expect(stitches[i]?.y).toBeCloseTo(0, 5);
    }
    expect(stitches[19]?.kind).toBe('jump');
    expect(stitches[19]?.x).toBeCloseTo(20, 5);
  });

  it('a small in-window segment under Foot S emits one stitch at the endpoint', () => {
    const points = [pt('a', 0, 0), pt('b', 0.5, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(3); // start + Start Stitch + 1 user
    expect(stitches[2]?.x).toBeCloseTo(0.5, 5);
  });

  it('a 3 mm in-window horizontal segment under Foot S is a single needle (no v1-style splitting)', () => {
    // 3 mm ≤ slot half (3.5 mm) → single in-window needle.
    const points = [pt('a', 0, 0), pt('b', 3, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(3);
    expect(stitches[2]?.x).toBeCloseTo(3, 5);
    expect(stitches[2]?.kind).toBe('needle');
  });

  it('a pure-Y segment under Foot S subdivides for the per-record dy cap (12 mm dy → 3 needles)', () => {
    // 12 mm = 144 raw, beyond STITCH_DY_MAX_RAW (48). The planner
    // splits into 3 records of dy=48 each. dx=0 never busts the slot,
    // so every record is a needle.
    const points = [pt('a', 0, 0), pt('b', 0, 12)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(5); // start + Start Stitch + 3 Y-cap pieces
    expect(stitches[4]?.y).toBeCloseTo(12, 5);
    for (let i = 1; i <= 4; i++) expect(stitches[i]?.kind).toBe('needle');
  });

  it('a diagonal segment under Foot S coalesces Phase A then walks with proportional Y', () => {
    // dx=80 raw (10 mm), dy=60 raw (5 mm). Phase A reaches the slot edge
    // (28 raw / 3.5 mm) with proportional dy = round(60·28/80) = 21 raw
    // (1.75 mm). Phase B walks the remaining 52 raw in 7 pieces (six of
    // 8 raw + one of 4 raw), with dy distributed cumulatively along the
    // segment line.
    const points = [pt('a', 0, 0), pt('b', 10, 5)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(10); // start + Start Stitch + 1 Phase A + 7 Phase B
    expect(stitches[2]?.x).toBeCloseTo(3.5, 5);
    expect(stitches[2]?.y).toBeCloseTo(1.75, 5);
    for (let i = 3; i <= 9; i++) {
      const x = stitches[i]!.x;
      expect(stitches[i]?.y).toBeCloseTo(x / 2, 1);
    }
    expect(stitches[9]?.x).toBeCloseTo(10, 5);
    expect(stitches[9]?.y).toBeCloseTo(5, 5);
  });

  it('preserves negative dx direction', () => {
    const points = [pt('a', 10, 0), pt('b', 0, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches).toHaveLength(10); // start + Start Stitch + 1 Phase A + 7 walks
    // Phase A short pushes the needle 3.5 mm leftward to the slot edge.
    expect(stitches[2]?.x).toBeCloseTo(6.5, 5);
    for (let i = 3; i <= 8; i++) {
      expect(stitches[i]?.x).toBeCloseTo(6.5 - (i - 2), 5);
    }
    expect(stitches[9]?.x).toBeCloseTo(0, 5);
  });

  it('Foot S stitch kinds match the planner (in-window=needle, busted segment = leading needle + trailing jumps)', () => {
    const inWindow: Point[] = [pt('a', 0, 0), pt('b', 3, 0)];
    const segIn: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const inSeq = encodeSegments(inWindow, segIn, FOOT_S);
    expect(inSeq).toHaveLength(3);
    expect(inSeq[2]?.kind).toBe('needle');

    const busts: Point[] = [pt('a', 0, 0), pt('b', 10, 0)];
    const segBust: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const bustSeq = encodeSegments(busts, segBust, FOOT_S);
    expect(bustSeq).toHaveLength(10);
    expect(bustSeq[2]?.kind).toBe('needle');
    for (let i = 3; i <= 9; i++) expect(bustSeq[i]?.kind).toBe('jump');
  });

  it('Foot S carriage (via trackFoot) stays planted under Phase A, then advances per jump piece', () => {
    const points = [pt('a', 0, 0), pt('b', 10, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_S);
    expect(seq).toHaveLength(10);
    const track = trackFoot(seq);
    // Phase A: needle reaches the slot edge, carriage planted at 0.
    expect(track[2]?.carriageXMm).toBeCloseTo(0, 5);
    for (let i = 3; i <= 8; i++) {
      expect(track[i]?.carriageXMm).toBeCloseTo(i - 2, 5);
    }
    expect(track[9]?.carriageXMm).toBeCloseTo(6.5, 5);

    const planted = [pt('a', 0, 0), pt('b', 3, 0)];
    const segPlanted: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const plantedSeq = encodeSegments(planted, segPlanted, FOOT_S);
    const plantedTrack = trackFoot(plantedSeq);
    expect(plantedTrack[2]?.carriageXMm).toBeCloseTo(0, 5);
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
    // seq = [start, Start Stitch needle, ...user records]
    expect(seq).toHaveLength(records.length + 2);
    const track = trackFoot(seq);
    for (let i = 0; i < records.length; i++) {
      const s = seq[i + 2]!;
      expect(s.x).toBeCloseTo(records[i]!.endXMm, 9);
      expect(s.y).toBeCloseTo(records[i]!.endYMm, 9);
      expect(track[i + 2]?.carriageXMm).toBeCloseTo(records[i]!.carriageXMm, 9);
      const expectedKind = records[i]!.kind === 'jump' ? 'jump' : 'needle';
      expect(s.kind).toBe(expectedKind);
    }
  });

  it('Foot B carriage walks just like Foot S — only its reach bound differs', () => {
    // seq layout: [start, Start Stitch, Phase A needle, 3 walks].
    const points = [pt('a', 0, 0), pt('b', 6, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const seq = encodeSegments(points, segments, FOOT_B);
    const track = trackFoot(seq);
    // Carriage stays at 0 through start + Start Stitch + Phase A needle.
    expect(track[0]?.carriageXMm).toBeCloseTo(0, 5);
    expect(track[1]?.carriageXMm).toBeCloseTo(0, 5);
    expect(track[2]?.carriageXMm).toBeCloseTo(0, 5);
    // 3 Phase-B pieces walk the carriage 1, 2, 2.5 mm.
    expect(track[3]?.carriageXMm).toBeCloseTo(1, 5);
    expect(track[4]?.carriageXMm).toBeCloseTo(2, 5);
    expect(track[5]?.carriageXMm).toBeCloseTo(2.5, 5);
    // Final carriage X stays inside Foot B's ±4.5 mm reach.
    expect(Math.abs(track[5]!.carriageXMm)).toBeLessThanOrEqual(4.5);
  });

  it('start stitch is emitted regardless of foot', () => {
    const points = [pt('a', 0, 0), pt('b', 10, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const stitches = encodeSegments(points, segments, FOOT_S);
    expect(stitches[0]?.kind).toBe('start');
  });

  it('cache invalidates when foot changes (segment that fits both feet)', () => {
    // 6 mm wide fits both Foot B (carriage walks to 3 mm ≤ 4.5 mm reach)
    // and Foot S. Sequences are: start + Start Stitch + Phase A + 3 walks = 6.
    const points = [pt('a', 0, 0), pt('b', 6, 0)];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const footS = encodeSegments(points, segments, FOOT_S);
    const footB = encodeSegments(points, segments, FOOT_B);
    expect(footS.length).toBe(6);
    expect(footB.length).toBe(6);
    const footSAgain = encodeSegments(points, segments, FOOT_S);
    expect(footSAgain.length).toBe(6);
  });
});
