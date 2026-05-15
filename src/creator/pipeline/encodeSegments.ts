// Encoder stage for segment-authored designs: turns Points + Segments
// into the canonical StitchSequence.
//
// Calls `planFootGroupedBySegment` directly for straight-only chains
// (one short or jump per record, slot-aware), and delegates to the
// multi-block walker in `multiBlockEmit.ts` when the chain has to
// thread through cone boundaries that `planFoot` doesn't model.
//
// Stitch density is the user's job: each input Segment produces one
// output record per per-record-envelope-sized piece (≤ 1 mm dx for
// jumps, ≤ 4 mm dy for any record), and the planner emits as few
// records as the slot/reach allow.
//
// Pure function. The 1-entry memo lives one stage up (encodeDesign) so
// it also covers manual-source identity returns without re-implementing
// here. Throws FootEncodeException when the planner refuses (e.g. a wide
// segment under Foot B that would walk the carriage past its reach).

import type { Point, Segment } from '../types.js';
import type { Foot } from '../foot.js';
import {
  FootEncodeException,
  planFootGroupedBySegment,
  type PlanFootOptions,
  type PlannedRecord,
} from '../carriagePlanner.js';
import { X_UNITS_PER_MM, Y_UNITS_PER_MM } from '../../parser/units.js';
import type { Stitch, StitchSequence } from './stitch.js';
import { emitDesignMultiBlock } from './multiBlockEmit.js';

// FootEncodeException is the carriage planner's refusal type. Re-exported
// here so callers that catch it from the pipeline don't have to know the
// planner module's path.
export { FootEncodeException } from '../carriagePlanner.js';

export function encodeSegments(
  points: readonly Point[],
  segments: readonly Segment[],
  foot: Foot,
  opts: PlanFootOptions = {},
  startXMm = 0,
): StitchSequence {
  if (segments.some((s) => s.type === 'satin')) {
    return emitDesignMultiBlock(points, segments, foot, opts, startXMm).sequence;
  }
  const byId = new Map<string, Point>();
  for (const p of points) byId.set(p.id, p);

  const groupsByStraightSegIdx = computeGroupedRecords(points, segments, foot, opts, startXMm);

  const stitches: Stitch[] = [];

  segments.forEach((seg, idx) => {
    if (seg.type !== 'straight') return;
    const a = byId.get(seg.from);
    const b = byId.get(seg.to);
    if (!a || !b) return;

    if (stitches.length === 0) {
      stitches.push({ kind: 'start', x: a.x, y: a.y, sourceIndex: -1, carriageXMm: startXMm });
    }

    const records = groupsByStraightSegIdx[idx];
    if (records && records.length > 0) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const last = records[records.length - 1]!;
      const baseX = a.x - (last.endXMm - dx);
      const baseY = a.y - (last.endYMm - dy);
      for (const r of records) {
        // The planner already computed the carriage X for each record
        // (it's the consequence of its slot decisions); thread it onto
        // the Stitch directly so the tracker doesn't need to re-derive it.
        stitches.push({
          kind: r.kind === 'jump' ? 'jump' : 'needle',
          x: baseX + r.endXMm,
          y: baseY + r.endYMm,
          dxRaw: r.dxRaw,
          dyRaw: r.dyRaw,
          sourceIndex: idx,
          carriageXMm: r.carriageXMm,
        });
      }
    }
  });

  return stitches;
}

function computeGroupedRecords(
  points: readonly Point[],
  segments: readonly Segment[],
  foot: Foot,
  opts: PlanFootOptions,
  startXMm: number,
): (readonly PlannedRecord[] | null)[] {
  const byId = new Map<string, Point>();
  for (const p of points) byId.set(p.id, p);

  const segIdxByStraightIdx: number[] = [];
  const deltas: { dxRaw: number; dyRaw: number }[] = [];
  segments.forEach((seg, idx) => {
    if (seg.type !== 'straight') return;
    const a = byId.get(seg.from);
    const b = byId.get(seg.to);
    if (!a || !b) return;
    segIdxByStraightIdx.push(idx);
    deltas.push({
      dxRaw: Math.round((b.x - a.x) * X_UNITS_PER_MM),
      dyRaw: Math.round((b.y - a.y) * Y_UNITS_PER_MM),
    });
  });

  // planFoot operates in cursor-relative coords (cursor starts at 0,
  // accumulating segment deltas). The CARRIAGE's chain-anchor-relative
  // start is `startXMm`, so the slot test runs against that offset —
  // imported binaries with a non-zero xElem will have their slot
  // positioned off-centre at design start.
  const grouped = planFootGroupedBySegment(foot, deltas, {
    ...opts,
    initialCarriageXRaw: Math.round(startXMm * X_UNITS_PER_MM),
  });
  if (!grouped.ok) {
    // The planner indexes its segmentIndex into the deltas array (only
    // straight segments). Map back to the project's segment index so the
    // exception message refers to the user-visible segment number.
    const projectSegIdx = segIdxByStraightIdx[grouped.error.segmentIndex] ?? grouped.error.segmentIndex;
    throw new FootEncodeException(foot.name, {
      code: grouped.error.code,
      segmentIndex: projectSegIdx,
    });
  }
  const out: (readonly PlannedRecord[] | null)[] = new Array(segments.length).fill(null);
  for (let i = 0; i < grouped.buckets.length; i++) {
    const segIdx = segIdxByStraightIdx[i]!;
    out[segIdx] = grouped.buckets[i]!;
  }
  return out;
}
