// sequenceFromProject — Project → StitchSequence dispatcher tests.
// Design mode delegates to encodeSegments; manual mode wraps the stored
// stitches in a 'start' marker without touching the encoder.

import { describe, it, expect } from 'vitest';
import { sequenceFromProject } from '../../../creator/pipeline/encodeDesign.js';
import { encodeSegments } from '../../../creator/pipeline/encodeSegments.js';
import { trackFoot } from '../../../creator/pipeline/trackFoot.js';
import { foot } from '../../../creator/foot.js';
import { newProject, SAMPLE } from '../../../creator/project.js';
import type { Point, Project, Segment } from '../../../creator/types.js';

const FOOT_B = foot('B');
const FOOT_S = foot('S');

const idGen = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

function designProject(points: Point[], segments: Segment[]): Project {
  const base = newProject('Test', { idGen, mode: 'design', suggestedFoot: 'B' });
  return { ...base, points, segments };
}

describe('sequenceFromProject — design branch matches encodeSegments', () => {
  it('Foot B straight chain: identical stitches and sourceIndex', () => {
    const points: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 5, y: 0 },
      { id: 'c', x: 5, y: 5 },
    ];
    const segments: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ];
    const project = { ...designProject(points, segments), suggestedFoot: 'B' as const };
    expect(sequenceFromProject(project)).toEqual(encodeSegments(points, segments, FOOT_B));
  });

  it('Foot S wide segment: identical (planner-driven) output', () => {
    const points: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 12, y: 0 },
    ];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const project = { ...designProject(points, segments), suggestedFoot: 'S' as const };
    expect(sequenceFromProject(project)).toEqual(encodeSegments(points, segments, FOOT_S));
  });
});

describe('sequenceFromProject — manual branch wraps stored stitches', () => {
  it('emits a start marker followed by the manual stitches verbatim (no encoder call)', () => {
    const base = newProject('M', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      manualStitches: [
        { kind: 'needle', x: 1, y: 0, dxRaw: 8, dyRaw: 0 },
        { kind: 'jump', x: 1.5, y: 0, dxRaw: 4, dyRaw: 0 },
        { kind: 'needle', x: 2, y: 3, dxRaw: 4, dyRaw: 36 },
      ],
    };
    const seq = sequenceFromProject(project);
    // Manual mode: needles plant, jumps walk the carriage by dxRaw/8.
    // sourceIndex is -1 for every record (no originating segment).
    expect(seq).toEqual([
      { kind: 'start',  x: 0,   y: 0, sourceIndex: -1, carriageXMm: 0 },
      { kind: 'needle', x: 1,   y: 0, dxRaw: 8, dyRaw: 0,  sourceIndex: -1, carriageXMm: 0 },
      { kind: 'jump',   x: 1.5, y: 0, dxRaw: 4, dyRaw: 0,  sourceIndex: -1, carriageXMm: 0.5 },
      { kind: 'needle', x: 2,   y: 3, dxRaw: 4, dyRaw: 36, sourceIndex: -1, carriageXMm: 0.5 },
    ]);
  });

  it('start position comes from points[0]', () => {
    const base = newProject('M', { idGen, mode: 'manual', suggestedFoot: 'B' });
    const project: Project = {
      ...base,
      points: [{ id: 'a', x: 0, y: 7 }],
    };
    const seq = sequenceFromProject(project);
    expect(seq[0]).toEqual({ kind: 'start', x: 0, y: 7, sourceIndex: -1, carriageXMm: 0 });
  });

  it('foot id does not affect the manual branch (no encoder, no planner)', () => {
    const base = newProject('M', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      manualStitches: [{ kind: 'needle', x: 1, y: 0, dxRaw: 8, dyRaw: 0 }],
    };
    const sSeq = sequenceFromProject(project);
    const bSeq = sequenceFromProject({ ...project, suggestedFoot: 'B' });
    expect(sSeq).toEqual(bSeq);
  });
});

describe('sequenceFromProject — satin endAt trailer', () => {
  // A vertical satin from (0, 0) to (0, 10) with widthStart = widthEnd = 4 mm
  // gives a cone whose corners are TL=(-2,0), TR=(2,0), BL=(-2,10), BR=(2,10).
  // The simulated zigzag still lands at BR (firmware convention); endAt
  // controls whether a trailer needle drop is appended after that.
  const points: Point[] = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 0, y: 10 },
  ];
  const baseSatin = { id: 's1', from: 'a', to: 'b', type: 'satin', widthStart: 4, widthEnd: 4, density: 1 } as const;

  function lastNeedle(seq: readonly { kind: string; x?: number; y?: number }[]) {
    const stitches = seq.filter((s) => s.kind !== 'start');
    return stitches[stitches.length - 1] as { kind: string; x: number; y: number };
  }

  it("endAt: 'left' appends one needle stitch landing at BL", () => {
    const project = { ...designProject(points, [{ ...baseSatin, endAt: 'left' }]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const last = lastNeedle(seq);
    expect(last.kind).toBe('needle');
    expect(last.x).toBeCloseTo(-2, 6);
    expect(last.y).toBeCloseTo(10, 6);
  });

  it("trailer for endAt: 'left' tracks the spine, not BL.x", () => {
    // The trailer is a chain-exit nudge from BR to BL. The CARRIAGE, however,
    // continues to ride the cone's spine — the firmware drives the carriage
    // along the spine through the whole satin, including the trailer step.
    // For a vertical 4 mm cone, spine X at y = 10 is 0 (mid-way between
    // BL.x = -2 and BR.x = 2). Tracking the carriage at BL.x would snap the
    // preview foot leftward by width / 2 and create the persistent lag the
    // user reported after the first satin.
    const project = { ...designProject(points, [{ ...baseSatin, endAt: 'left' }]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const last = seq[seq.length - 1] as { kind: string };
    expect(last.kind).toBe('needle');
    const track = trackFoot(seq);
    expect(track[track.length - 1]!.carriageXMm).toBeCloseTo(0, 6);
  });

  it("trailer for endAt: 'left' on a tapered cone tracks the spine, not BL", () => {
    // Spine (0,0)→(4,10), widthStart=widthEnd=2. At y=10 the spine sits at
    // x=4 and BL is at x=3. The tracked carriage at the trailer must be 4
    // (spine), never 3 (BL.x). This locks the contract at a non-zero spine X
    // so a future regression back to trailer.x can't pass.
    const taperedPts: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 4, y: 10 },
    ];
    const tapered = { id: 's1', from: 'a', to: 'b', type: 'satin' as const, widthStart: 2, widthEnd: 2, density: 1, endAt: 'left' as const };
    const project = { ...designProject(taperedPts, [tapered]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const last = seq[seq.length - 1] as { kind: string };
    expect(last.kind).toBe('needle');
    const track = trackFoot(seq);
    expect(track[track.length - 1]!.carriageXMm).toBeCloseTo(4, 5);
  });

  it("trailer for endAt: 'center' tracks the spine endpoint X", () => {
    const project = { ...designProject(points, [{ ...baseSatin, endAt: 'center' }]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const last = seq[seq.length - 1] as { kind: string };
    expect(last.kind).toBe('needle');
    const track = trackFoot(seq);
    expect(track[track.length - 1]!.carriageXMm).toBeCloseTo(0, 6);
  });

  it("endAt: 'center' appends one needle stitch landing at the spine endpoint", () => {
    const project = { ...designProject(points, [{ ...baseSatin, endAt: 'center' }]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const last = lastNeedle(seq);
    expect(last.kind).toBe('needle');
    expect(last.x).toBeCloseTo(0, 6);
    expect(last.y).toBeCloseTo(10, 6);
  });

  it('trailer for a 10 mm cone splits via planFoot to respect the slot, summing to dxRaw=-80', () => {
    // 10 mm cone, endAt: 'left' → BR=(5, 10), BL=(-5, 10). With the
    // 7 mm slot (NEEDLE_SLOT_HALF_MM = 3.5), the -10 mm trailer busts
    // the slot and planFoot must split it into per-piece records.
    //
    // Pre-unification the multi-block builder emitted the trailer as a
    // single short of the full delta, bypassing planFoot's slot rule.
    // After the chain transition went through planFoot the trailer
    // splits into per-piece records (some shorts inside the slot, the
    // rest jumps walking the carriage). The architectural contract is
    // "every chain transition uses planFoot"; the visible contract is
    // "the trailer's records sum to the full delta and land at the
    // requested corner".
    const widePts: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 10 },
    ];
    const wideSatin = { id: 's1', from: 'a', to: 'b', type: 'satin' as const, widthStart: 10, widthEnd: 10, density: 1, endAt: 'left' as const };
    const project = { ...designProject(widePts, [wideSatin]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    // The trailer is the records that follow the last satin zigzag
    // drop (which lands at BR). Find the run from after BR to the end.
    // BR.y = 10 for this cone; BL.y = 10 too, so the trailer's last
    // record's (x, y) is BL = (-5, 10).
    const last = seq[seq.length - 1] as { kind: string; x: number; y: number };
    expect(last.x).toBeCloseTo(-5, 6);
    expect(last.y).toBeCloseTo(10, 6);
    // Walk back from the end, summing dxRaw, until we hit a stitch at
    // BR (5, 10). That run is the trailer.
    let sumDxRaw = 0;
    let sumDyRaw = 0;
    let trailerStart = seq.length;
    for (let i = seq.length - 1; i >= 0; i--) {
      const s = seq[i] as { kind: string; x: number; y: number; dxRaw?: number; dyRaw?: number };
      trailerStart = i;
      sumDxRaw += s.dxRaw ?? 0;
      sumDyRaw += s.dyRaw ?? 0;
      if (Math.abs(s.x - 5) < 1e-6 && Math.abs(s.y - 10) < 1e-6) {
        sumDxRaw -= s.dxRaw ?? 0;  // exclude BR itself
        sumDyRaw -= s.dyRaw ?? 0;
        trailerStart = i + 1;
        break;
      }
    }
    expect(sumDxRaw).toBe(-80);
    expect(sumDyRaw).toBe(0);
    // And the trailer is more than one record (planFoot split it).
    expect(seq.length - trailerStart).toBeGreaterThan(1);
  });

  it('omitted endAt is identical to endAt: "right" — no trailer appended', () => {
    const omitted = { ...designProject(points, [baseSatin]), suggestedFoot: 'S' as const };
    const right = { ...designProject(points, [{ ...baseSatin, endAt: 'right' as const }]), suggestedFoot: 'S' as const };
    const seqOmitted = sequenceFromProject(omitted);
    const seqRight = sequenceFromProject(right);
    expect(seqOmitted).toEqual(seqRight);
    // And the last stitch is at BR — confirms no trailer was added.
    const last = lastNeedle(seqOmitted);
    expect(last.x).toBeCloseTo(2, 6);
    expect(last.y).toBeCloseTo(10, 6);
  });
});

describe('sequenceFromProject — satin spine-X carriage tracking', () => {
  // For a vertical satin (0,0)→(0,10), widthStart=widthEnd=4 mm, the spine
  // sits at x=0 and the cone edges at x=±2 mm. trackFoot must report
  // carriage X = 0 (the spine X at that drop's Y) for every satin-internal
  // needle drop, so the preview foot tracks the spine instead of staying
  // parked at the pre-satin carriage.
  const points: Point[] = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 0, y: 10 },
  ];
  const verticalSatin = { id: 's1', from: 'a', to: 'b', type: 'satin' as const, widthStart: 4, widthEnd: 4, density: 1 };

  it('every satin-internal needle frame reports carriage X at the spine X', () => {
    const project = { ...designProject(points, [verticalSatin]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);
    // Every needle frame inside the satin sits on the spine (x=0).
    let internalFrames = 0;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i]!.kind !== 'needle') continue;
      internalFrames += 1;
      expect(track[i]!.carriageXMm).toBeCloseTo(0, 6);
    }
    expect(internalFrames).toBeGreaterThan(0);
  });

  it('tapered satin: tracked carriage interpolates along the spine with Y', () => {
    // Spine (0,0) → (4,10) tilts right with Y. Each needle frame's
    // carriage X should equal 4 × y/10 (the spine X at that Y), not 0.
    const taperedPts: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 4, y: 10 },
    ];
    const tapered = { id: 's1', from: 'a', to: 'b', type: 'satin' as const, widthStart: 1, widthEnd: 1, density: 1 };
    const project = { ...designProject(taperedPts, [tapered]), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i]!;
      if (s.kind !== 'needle') continue;
      expect(track[i]!.carriageXMm).toBeCloseTo(4 * s.y / 10, 5);
    }
  });
});

describe('sequenceFromProject + trackFoot — foot does not snap backwards across a satin trailer', () => {
  // Regression: the preview foot ran along the cone's spine through the satin
  // interior, then snapped left by width / 2 at the trailer step (chain exit
  // for endAt: 'left') and never recovered. The bug pinned the trailer's
  // carriage to BL.x instead of the spine X — these tests guard the
  // simulator-level invariants that were missing when that regression
  // shipped.

  it("trailer frame does not yank the carriage backwards (endAt: 'left')", () => {
    // Vertical 4 mm cone (spine X = 0). Every interior drop reports
    // carriage X = 0 in trackFoot. The trailer step must keep the carriage
    // at 0, NOT snap it to BL.x = -2.
    const points: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 10 },
    ];
    const segments: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'satin', widthStart: 4, widthEnd: 4, density: 1, endAt: 'left' },
    ];
    const project = { ...designProject(points, segments), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);

    // The trailer is the very last needle drop (lands at BL = (-2, 10)).
    const trailerIdx = track.length - 1;
    const prior = track[trailerIdx - 1]!;
    const trailer = track[trailerIdx]!;

    // Both the last interior drop and the trailer ride the spine.
    expect(prior.carriageXMm).toBeCloseTo(0, 6);
    expect(trailer.carriageXMm).toBeCloseTo(0, 6);

    // Strong invariant: no frame-to-frame backward step at the trailer.
    expect(trailer.carriageXMm).toBeGreaterThanOrEqual(prior.carriageXMm - 1e-6);
  });

  it('persistent lag: post-satin carriage walks from the trailer spine X via planFoot', () => {
    // Reproduces the user-visible symptom end-to-end: a 'left'-end
    // satin followed by a straight to (10, 10). The trailer pins the
    // carriage at the cone's spine X (= 0 for a vertical cone). After
    // the trailer the chain is at BL = (-2, 10) but the carriage is
    // at 0; the post-satin chain transition runs through planFoot:
    //   • Phase A emits one SHORT that walks the cursor from -2 mm
    //     to the slot edge at +3.5 mm (cursor delta 5.5 mm), carriage
    //     planted at 0;
    //   • Phase B walks the carriage by ≤ 1 mm jumps until the
    //     cursor reaches the segment endpoint (10 mm). The remaining
    //     cursor delta is 6.5 mm → seven pieces (six of 1 mm + one
    //     of 0.5 mm), carriage ends at 6.5 mm.
    // The carriage trails the cursor by exactly the slot half
    // (NEEDLE_SLOT_HALF_MM), which is the firmware's actual mechanical
    // behaviour. The original bug had the trailer pinned at BL.x = -2
    // and the post-satin records using a stale planFoot initial
    // carriage of 0 (computed as if the design started fresh) — which
    // produced a 2-mm-leftward persistent offset for the rest of the
    // design. Locking final carriage = 10 − slotHalf catches any
    // stale-initial-carriage bug.
    const points: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 10 },
      { id: 'c', x: 10, y: 10 },
    ];
    const segments: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'satin', widthStart: 4, widthEnd: 4, density: 1, endAt: 'left' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ];
    const project = { ...designProject(points, segments), suggestedFoot: 'S' as const };
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);
    expect(track[track.length - 1]!.carriageXMm).toBeCloseTo(6.5, 5);
  });
});

describe('sequenceFromProject + trackFoot — jump carriage walks by dxHi mm', () => {
  // The 7-byte long-jump record carries two separate fields:
  //   dx_total = dxLow + dxHi × 8 (in raw stitch units, 1/8 mm)
  // The firmware caps |dxHi| ≤ 1 mm per record (firmware envelope) and
  // interprets `dxHi mm` as the carriage's lateral slide, while
  // `dxLow / 8 mm` is an additional in-slot needle swing on top. Our
  // encoder always emits dxLow = 0 (so dx = dxHi × 8, the two models
  // agree). But IMPORTED binary files (foot-S reference designs)
  // routinely have dxLow ≠ 0 — the cursor moves by
  // dxLow/8 + dxHi mm per record, but only dxHi of that is carriage
  // motion. Walking the carriage by the full dx/8 mm (the pre-fix
  // behavior of manualSequence and pushRawStitch) inflates the
  // carriage drift and lands the foot in the wrong place during the
  // preview.
  it('manual jump with dxLow != 0 walks the carriage by dxHi mm only', () => {
    // dx = dxLow + dxHi*8 = 9 + 1*8 = 17 raw = 2.125 mm cursor displacement.
    // Carriage should slide by dxHi = 1 mm (not 2.125 mm).
    const base = newProject('M', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      manualStitches: [
        { kind: 'jump', x: 2.125, y: 0, dxRaw: 17, dyRaw: 0, dxHi: 1 },
      ],
    };
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);
    expect(track[1]!.carriageXMm).toBeCloseTo(1, 6);
  });

  it('encoder-style jump (dxLow = 0) walks the carriage by the full dx/8 mm', () => {
    // Encoder-emitted jumps always cap |dx| at 8 raw, so dxHi = ±1 and
    // dxLow = 0. Both carriage models agree here — this test pins the
    // existing behavior so the dxHi fix doesn't regress encoder output.
    const base = newProject('M', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      manualStitches: [
        { kind: 'jump', x: 1, y: 0, dxRaw: 8, dyRaw: 0, dxHi: 1 },
      ],
    };
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);
    expect(track[1]!.carriageXMm).toBeCloseTo(1, 6);
  });
});

describe('sequenceFromProject + trackFoot — needle frames stay inside the foot slot', () => {
  // The firmware's slot is symmetric around the carriage: a needle stitch
  // can only land within ±needleSlotHalfMm of the current carriage X.
  // Anything wider must walk the carriage. The encoder respects this by
  // construction — planFoot splits oversized pieces into jumps; the
  // multi-block walker advances the chain to the moveTo target after
  // every record, including long shorts the firmware auto-walks.
  //
  // The tracker's job is to report the carriage that's consistent with
  // the encoder's view. Any frame where the needle ends up further than
  // slotHalf from the tracked carriage means the tracker is lying about
  // where the foot is — which is the visible "foot lags the needle"
  // symptom in the preview.

  it('SAMPLE design: every needle frame keeps |needle - carriage| ≤ slotHalf', () => {
    const project = SAMPLE();
    const f = foot(project.suggestedFoot);
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);
    const violations: string[] = [];
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i]!;
      if (s.kind !== 'needle') continue;
      const dist = Math.abs(s.x - track[i]!.carriageXMm);
      if (dist > f.needleSlotHalfMm + 1e-6) {
        violations.push(
          `idx=${i} needle=(${s.x.toFixed(2)}, ${s.y.toFixed(2)}) carriage=${track[i]!.carriageXMm.toFixed(2)} dist=${dist.toFixed(2)} > slot=${f.needleSlotHalfMm}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('SAMPLE design: chain transitions respect the slot via planFoot', () => {
    // Architectural invariant: the multi-block builder routes every
    // chain transition through planFoot — the single source of truth
    // for "how many records, what kinds, what dx per piece" under the
    // firmware's slot rule. SAMPLE's segment 0 is a 15 mm horizontal
    // straight; pre-fix the multi-block builder collapsed this to one
    // 15 mm short (way outside the foot's slot). With planFoot driving
    // moveTo, each record's |dx| is bounded by the planner's per-kind
    // caps: jumps ≤ 1 mm (8 raw, the firmware jump cap), shorts ≤ 127
    // raw (int8), and a Phase-A short never lands the needle outside
    // the foot's slot.
    //
    // Satin-emitted zigzag drops are intentionally NOT in scope here —
    // the firmware computes those from cone edges, and they routinely
    // span >slot in dx. We filter to straight-segment records only.
    const project = SAMPLE();
    const seq = sequenceFromProject(project);
    const straightIdxs = new Set<number>();
    project.segments.forEach((seg, i) => {
      if (seg.type === 'straight') straightIdxs.add(i);
    });
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i]!;
      if (s.kind === 'start') continue;
      if (!straightIdxs.has(s.sourceIndex)) continue;
      if (s.kind === 'jump') {
        expect(Math.abs(s.dxRaw)).toBeLessThanOrEqual(8);
      } else {
        expect(Math.abs(s.dxRaw)).toBeLessThanOrEqual(127);
      }
    }
  });

  it('long straight before a satin splits via planFoot — needle never lags the carriage past slotHalf', () => {
    // A satin design forces multi-block emission for every straight.
    // Pre-fix the multi-block builder collapsed any sub-int8 delta to
    // a single short, so a 15 mm straight before a satin emitted as
    // one slot-violating short. With planFoot driving moveTo, the
    // 15 mm splits per-piece (3 in-slot shorts + 12 jumps), and at
    // every frame the carriage stays within slotHalf of the needle.
    const points: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: -15, y: 4 },
      { id: 'c', x: -15, y: 12 },  // satin trigger, anchors the multi-block path
    ];
    const segments: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'satin', widthStart: 2, widthEnd: 2, density: 1 },
    ];
    const project = { ...designProject(points, segments), suggestedFoot: 'S' as const };
    const f = foot(project.suggestedFoot);
    const seq = sequenceFromProject(project);
    const track = trackFoot(seq);
    // Find the chain landing after the straight — it's where x≈-15 and
    // y≈4 (the segment endpoint). With planFoot driving the split,
    // that final piece is a jump (the carriage walks the last 1 mm to
    // the cursor), not a single 15 mm short.
    const landingIdx = seq.findIndex(
      (s) => s.kind !== 'start' && Math.abs(s.x - (-15)) < 1e-6 && Math.abs(s.y - 4) < 1e-6,
    );
    expect(landingIdx).toBeGreaterThan(0);
    // Across every frame from start to the satin entry, the needle
    // stays inside slotHalf of the carriage — the slot-respecting
    // contract that the pre-fix single-short violated by 12 mm.
    for (let i = 0; i <= landingIdx; i++) {
      const dist = Math.abs(seq[i]!.x - track[i]!.carriageXMm);
      expect(dist).toBeLessThanOrEqual(f.needleSlotHalfMm + 1e-6);
    }
  });
});

describe('sequenceFromProject — manual satin endAt trailer', () => {
  it("manual ManualSatinSegment with endAt: 'left' lands the chain at BL", () => {
    const base = newProject('M', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      manualStitches: [
        { kind: 'satin', x: 0, y: 0, toX: 0, toY: 10, widthStart: 4, widthEnd: 4, density: 1, endAt: 'left' },
      ],
    };
    const seq = sequenceFromProject(project);
    const last = seq[seq.length - 1] as { kind: string; x: number; y: number };
    expect(last.kind).toBe('needle');
    expect(last.x).toBeCloseTo(-2, 6);
    expect(last.y).toBeCloseTo(10, 6);
  });

  it('manual ManualSatinSegment with endAt omitted lands at BR (today\'s behaviour)', () => {
    const base = newProject('M', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      manualStitches: [
        { kind: 'satin', x: 0, y: 0, toX: 0, toY: 10, widthStart: 4, widthEnd: 4, density: 1 },
      ],
    };
    const seq = sequenceFromProject(project);
    const last = seq[seq.length - 1] as { kind: string; x: number; y: number };
    expect(last.x).toBeCloseTo(2, 6);
    expect(last.y).toBeCloseTo(10, 6);
  });
});

describe('sequenceFromProject — memoization', () => {
  it('returns the same reference when called twice with the same Project', () => {
    const points: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 5, y: 0 },
    ];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const project = { ...designProject(points, segments), suggestedFoot: 'B' as const };
    const a = sequenceFromProject(project);
    const b = sequenceFromProject(project);
    expect(a).toBe(b);
  });

  it('different Project references → different cached results', () => {
    const points: Point[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 5, y: 0 },
    ];
    const segments: Segment[] = [{ id: 's1', from: 'a', to: 'b', type: 'straight' }];
    const projectA = { ...designProject(points, segments), suggestedFoot: 'B' as const };
    const projectB = { ...designProject(points, segments), suggestedFoot: 'B' as const };
    const a = sequenceFromProject(projectA);
    const b = sequenceFromProject(projectB);
    expect(a).not.toBe(b);
  });
});
