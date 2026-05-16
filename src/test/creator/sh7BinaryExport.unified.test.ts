// Equivalence invariant for the unified pipeline:
//
//   For any segment-authored Project and any manual-authored Project that
//   yield the same StitchSequence, exportProjectBinary must produce the
//   same bytes.
//
// This locks down the user-stated guiding principle: the encoder is the
// single source of truth for "what gets sewn"; manual and design are two
// authoring sources that converge on a single Stitch[] before any
// downstream consumer reads them.

import { describe, it, expect } from 'vitest';
import { exportProjectBinary } from '../../creator/sh7BinaryExport.js';
import { sequenceFromProject } from '../../creator/pipeline/encodeDesign.js';
import { newProject } from '../../creator/project.js';
import type {
  ManualStitchInput,
  Point,
  Project,
  Segment,
} from '../../creator/types.js';
import type { FootId } from '../../creator/foot.js';
import type { StitchSequence } from '../../creator/pipeline/stitch.js';

/**
 * Project a StitchSequence onto its sewing-output fields (kind, position,
 * raw deltas). Drops `sourceIndex` (which is encode-mode-specific bookkeeping:
 * manual mode tags every record -1; design mode threads the originating
 * segment index) and `carriageXMm` (encoder bookkeeping for the preview).
 * Used to assert manual ↔ design equivalence at the level the firmware
 * actually sees.
 */
function sewingShape(seq: StitchSequence): readonly object[] {
  return seq.map((s) => {
    if (s.kind === 'start') return { kind: s.kind, x: s.x, y: s.y };
    return { kind: s.kind, x: s.x, y: s.y, dxRaw: s.dxRaw, dyRaw: s.dyRaw };
  });
}

const idGen = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

function segmentProject(
  foot: FootId,
  layout: readonly { x: number; y: number }[],
): Project {
  const base = newProject('seg', { idGen, mode: 'design', suggestedFoot: foot });
  const points: Point[] = [
    { id: base.points[0]!.id, x: layout[0]!.x, y: layout[0]!.y },
  ];
  for (let i = 1; i < layout.length; i++) {
    points.push({ id: `pt_${idGen()}`, x: layout[i]!.x, y: layout[i]!.y });
  }
  const segments: Segment[] = [];
  for (let i = 1; i < layout.length; i++) {
    segments.push({
      id: `s_${idGen()}`,
      from: points[i - 1]!.id,
      to: points[i]!.id,
      type: 'straight',
    });
  }
  return { ...base, points, segments };
}

function manualProjectMirroring(
  foot: FootId,
  start: { x: number; y: number },
  manualStitches: readonly ManualStitchInput[],
): Project {
  const base = newProject('manual', { idGen, mode: 'manual', suggestedFoot: foot });
  return {
    ...base,
    points: [{ id: base.points[0]!.id, x: start.x, y: start.y }],
    manualStitches: manualStitches.slice(),
  };
}

function manualMirrorOf(seg: Project): Project {
  const seq = sequenceFromProject(seg);
  const start = seq[0];
  if (!start || start.kind !== 'start') {
    throw new Error('expected sequence to start with a start stitch');
  }
  // The encoder prepends a 'start' marker + a **Start Stitch** needle
  // record. The manual mirror builds the same prefix automatically when
  // it re-encodes, so we strip BOTH from the source-of-truth iteration.
  const manualStitches: ManualStitchInput[] = [];
  let skippedStartStitch = false;
  for (const s of seq) {
    if (s.kind === 'start') continue;
    if (!skippedStartStitch && s.sourceIndex === -1) {
      skippedStartStitch = true;
      continue;
    }
    manualStitches.push({
      kind: s.kind,
      x: s.x,
      y: s.y,
      dxRaw: s.dxRaw,
      dyRaw: s.dyRaw,
    });
  }
  return manualProjectMirroring(seg.suggestedFoot, { x: start.x, y: start.y }, manualStitches);
}

describe('manual ↔ segment unification invariant', () => {
  it('Foot B: a 3-needle chain yields the same StitchSequence and bytes', () => {
    // Tight chain that keeps every needle within Foot B's ±3 mm reach of x=0.
    const seg = segmentProject('B', [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: -2, y: 4 },
      { x: 2, y: 6 },
    ]);
    const man = manualMirrorOf(seg);

    const segSeq = sequenceFromProject(seg);
    const manSeq = sequenceFromProject(man);

    // Compare sewing-output fields only: sourceIndex differs by mode (manual=-1
     // throughout vs design=segment index) and that's expected. Byte-equality
     // below is the load-bearing assertion.
     expect(sewingShape(manSeq)).toEqual(sewingShape(segSeq));
    expect(exportProjectBinary(man)).toEqual(exportProjectBinary(seg));
  });

  it('Foot S: a chain inside the slot window with no jump-splits yields the same StitchSequence and bytes', () => {
    // All moves are within the ±3 mm slot window so the Foot S planner emits
    // one record per segment with no jump-splitting — manual mirrors it.
    const seg = segmentProject('S', [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: -1, y: 3 },
      { x: 0, y: 5 },
    ]);
    const man = manualMirrorOf(seg);

    const segSeq = sequenceFromProject(seg);
    const manSeq = sequenceFromProject(man);

    // Compare sewing-output fields only: sourceIndex differs by mode (manual=-1
     // throughout vs design=segment index) and that's expected. Byte-equality
     // below is the load-bearing assertion.
     expect(sewingShape(manSeq)).toEqual(sewingShape(segSeq));
    expect(exportProjectBinary(man)).toEqual(exportProjectBinary(seg));
  });

  it('the bbox in the binary is the stitch bbox, not the segment-points bbox', () => {
    // A Foot B straight segment sampled at 3 mm steps puts intermediate
    // needle drops between the endpoints. The bbox should cover the full
    // chain regardless of which authoring source produced it. This catches
    // the historical divergence where the segment path used points-bbox and
    // the manual path used stitch-bbox — the two coincide for endpoint-only
    // chains, but the invariant must hold for any equivalent StitchSequence.
    const seg = segmentProject('B', [
      { x: 0, y: 0 },
      { x: 0, y: 9 }, // sampled into 3 needle drops at y=3, 6, 9
    ]);
    const man = manualMirrorOf(seg);

    expect(exportProjectBinary(man)).toEqual(exportProjectBinary(seg));
  });
});
