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
  startStitchXMm = 0,
): StitchSequence {
  if (segments.some((s) => s.type === 'satin')) {
    return emitDesignMultiBlock(points, segments, foot, opts, startXMm, startStitchXMm).sequence;
  }
  const byId = new Map<string, Point>();
  for (const p of points) byId.set(p.id, p);

  const groupsByStraightSegIdx = computeGroupedRecords(
    points, segments, foot, opts, startXMm, startStitchXMm,
  );

  // Collect user-segment records first; only prepend the **Start
  // Stitch** when there's at least one user record to emit. Empty /
  // invalid input returns an empty sequence (matches the canonical
  // "nothing to render" shape used by safeSequenceFromProject).
  const userStitches: Stitch[] = [];

  segments.forEach((seg, idx) => {
    if (seg.type !== 'straight') return;
    const a = byId.get(seg.from);
    const b = byId.get(seg.to);
    if (!a || !b) return;

    const records = groupsByStraightSegIdx[idx];
    if (records && records.length > 0) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const last = records[records.length - 1]!;
      const baseX = a.x - (last.endXMm - dx);
      const baseY = a.y - (last.endYMm - dy);
      for (const r of records) {
        userStitches.push({
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

  if (userStitches.length === 0) return [];
  return [...prependStartFrames(startXMm, startStitchXMm), ...userStitches];
}

/**
 * Build the leading `'start'` marker + **Start Stitch** needle record
 * that prefix every encoded sequence. The 'start' marker is pinned to
 * the **Start Stitch** position so the preview's polyline (pathOf) does
 * not draw a phantom segment from machine origin to startStitch.x —
 * the marker and the leading needle share an (x, y), giving a zero-
 * length pseudo-segment that renders as nothing. The Start Stitch is
 * still emitted as a real needle record with `dx = round(startStitchXMm
 * * X_UNITS_PER_MM)`, `dy = 0` (by construction `|dx| ≤
 * NEEDLE_SLOT_HALF_MM × X_UNITS_PER_MM = 28 raw`, fits a short record)
 * so the .sh7 byte stream is unchanged.
 *
 * After the Start Stitch the cursor sits at design coord
 * (`startStitchXMm`, 0); subsequent user segments encode normally
 * with `planFoot`'s `initialCursorXRaw` set to that position.
 */
export function prependStartFrames(startXMm: number, startStitchXMm: number): Stitch[] {
  const dxRaw = Math.round(startStitchXMm * X_UNITS_PER_MM);
  return [
    { kind: 'start', x: startStitchXMm, y: 0, sourceIndex: -1, carriageXMm: startXMm },
    {
      kind: 'needle',
      x: startStitchXMm,
      y: 0,
      dxRaw,
      dyRaw: 0,
      sourceIndex: -1,
      carriageXMm: startXMm,
    },
  ];
}

function computeGroupedRecords(
  points: readonly Point[],
  segments: readonly Segment[],
  foot: Foot,
  opts: PlanFootOptions,
  startXMm: number,
  startStitchXMm: number,
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

  // planFoot's cursor enters the user-segment loop at the **Start
  // Stitch** position (the cursor where the firmware lands the first
  // needle drop). The carriage starts at the **Carriage Start**.
  // Slot decisions run against the lag between the two.
  const grouped = planFootGroupedBySegment(foot, deltas, {
    ...opts,
    initialCursorXRaw: Math.round(startStitchXMm * X_UNITS_PER_MM),
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
