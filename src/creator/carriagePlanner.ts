// Carriage planner — turns a list of segment deltas into the canonical
// PlannedRecord stream under a given foot's slot/reach constraints.
//
// Decision rule (per-piece, carriage-relative slot test):
//
//  1. The carriage owns a slot of width `2 × needleSlotHalfMm` centered on
//     its current X. A SHORT moves only the needle (cursor); the carriage
//     stays planted. A JUMP advances cursor AND carriage by the same dx
//     (≤ PER_RECORD_JUMP_CAP_MM per piece, firmware-enforced |dxHi| ≤ 1).
//
//  2. Fast path. If the segment endpoint lands inside the slot
//     (`|target − carriage| ≤ slotHalf`) AND the segment fits both the
//     X and Y per-record envelopes, emit one SHORT for the whole segment.
//     The carriage stays planted and the foot's swing deposits the stitch
//     in a single record.
//
//  3. Otherwise the segment is walked piece-by-piece (≤ 1 mm raw each so
//     the firmware-enforced |dxHi| ≤ 1 envelope holds, AND each piece's
//     dy stays inside STITCH_DY_MAX_RAW). Distribution mirrors v1's
//     pushFootSSplit so pieces line up byte-for-byte where the comparison
//     applies. For each piece:
//       • If the piece's target stays inside the slot
//         (|cursor + dxPiece − carriage| ≤ slotHalf), emit a SHORT — the
//         needle reaches there from the planted carriage.
//       • Otherwise emit a JUMP — cursor and carriage advance together
//         by dxPiece. The carriage walks toward the segment endpoint
//         until cursor and carriage end co-located (next segment then
//         starts with a fresh ±slotHalf swing).
//     Before advancing the carriage on a jump, check the foot's reach: if
//     the move would land the carriage past `±carriageReachHalfMm`, refuse
//     with `{ ok: false, error: { code: 'reach', segmentIndex } }`. The
//     editor's input gate (liveBoundsForClick) already prevents authoring
//     unreachable designs in design mode; reach failures here come from
//     imports or foot switches.
//
// Why carriage-relative, not run-span: a one-sided drift across `slot` mm
// (e.g. cursor 0 → 6 mm under a 6 mm slot) would otherwise pass a
// run-span check while landing the needle 6 mm right of a planted
// carriage — outside the slot half (3 mm). The hardware's slot is
// symmetric around the carriage; the planner test must be too.
//
// Foot-agnostic input. The planner reads two numeric constraints
// (`needleSlotHalfMm`, `carriageReachHalfMm`) — exactly the two fields
// it needs to make slot/jump decisions. Both the Foot record (foot.ts)
// and hand-rolled `{ needleSlotHalfMm, carriageReachHalfMm }` objects
// satisfy the input by structural typing, so tests can construct
// synthetic constraints directly without inventing a fake Foot.

import { X_UNITS_PER_MM, Y_UNITS_PER_MM } from '../parser/units.js';
import { STITCH_DY_MAX_RAW } from './sh7Limits.js';

/**
 * What the planner needs from a foot — its slot half-width and carriage
 * reach in mm. A Foot record satisfies this by structural typing; tests
 * can also pass plain `{ needleSlotHalfMm: 3, carriageReachHalfMm: 27.25 }`
 * objects directly.
 */
export interface CarriageConstraints {
  /** Maximum |needle − carriage| in mm. The mechanical needle window. */
  needleSlotHalfMm: number;
  /** Maximum |carriage X| in mm. The wide-carriage reach bound (Foot S vs Foot B). */
  carriageReachHalfMm: number;
}

export interface PlannedRecord {
  kind: 'short' | 'jump';
  /** Signed delta in raw X stitch units (8 per mm). */
  dxRaw: number;
  /** Signed delta in raw Y stitch units (12 per mm). */
  dyRaw: number;
  /** Absolute needle X in mm after this record. */
  endXMm: number;
  /** Absolute needle Y in mm after this record. */
  endYMm: number;
  /** Virtual carriage X in mm after this record (for the glass-foot visualizer). */
  carriageXMm: number;
}

/** Reasons the planner can refuse to encode a segment list. */
export interface FootEncodeError {
  /** 'reach' — a jump would land the carriage past the foot's reach. */
  code: 'reach';
  /** Index into the input segments array of the offending segment. */
  segmentIndex: number;
}

/**
 * Thrown when the carriage planner refuses to encode a segment list
 * under the active foot. Today the only refusal mode is `'reach'`: a
 * jump piece would land the carriage past `±carriageReachHalfMm`.
 *
 * Carries the foot's display name (passed in by the caller) so the
 * message can refer to "Foot B" / "Foot S" — the planner itself is
 * foot-agnostic; the name is purely diagnostic.
 */
export class FootEncodeException extends Error {
  readonly code: FootEncodeError['code'];
  readonly segmentIndex: number;
  constructor(footName: string, error: FootEncodeError) {
    super(
      `Segment ${error.segmentIndex} cannot be encoded under ${footName}: carriage would exceed the foot's reach`,
    );
    this.name = 'FootEncodeException';
    this.code = error.code;
    this.segmentIndex = error.segmentIndex;
  }
}

export type PlanResult =
  | { ok: true; records: PlannedRecord[] }
  | { ok: false; error: FootEncodeError };

export type GroupedPlanResult =
  | { ok: true; buckets: PlannedRecord[][] }
  | { ok: false; error: FootEncodeError };

/**
 * Optional planner knobs. Today's only knob is `maxNeedleMm`: tightens
 * every emitted record's dx (in slice 1) below the firmware envelope so
 * needle stitches and jumps land at the same per-record length on the
 * fabric ("uniform mode"). Default Infinity = today's behavior.
 */
export interface PlanFootOptions {
  /** Maximum per-record stitch length in mm (X axis in slice 1). */
  maxNeedleMm?: number;
  /**
   * Initial cursor X (raw stitch units, 8/mm) at the start of planning.
   * Default 0 — the planner's records' carriageXMm and the slot test
   * are then in the planner's local frame. Pass the absolute chain X
   * (in raw units) when resuming mid-design (e.g. from the multi-block
   * walker after a satin chunk has reset the chain), so the planner's
   * slot decisions and carriage-X reports come out in the absolute
   * design frame.
   */
  initialCursorXRaw?: number;
  /**
   * Initial carriage X (raw stitch units, 8/mm) at the start of
   * planning. Default 0. Same purpose as initialCursorXRaw — lets a
   * caller resume planning with the firmware's actual carriage state
   * (e.g. spineXAtY after a satin) instead of the planner's default
   * "carriage starts at 0" assumption.
   */
  initialCarriageXRaw?: number;
}

const EPSILON = 1e-6;

// Short-stitch dx is encoded as a signed int8, but the byte 0x80 (=−128)
// is reserved as the long-jump record prefix (see FORMAT.md §short stitch).
// The planner caps the magnitude of any short stitch's dx at 127 raw so
// the byte writer never has to promote a short to a jump just to dodge
// that reserved value.
const SHORT_DX_INT8_MAX = 127;

/**
 * Plan the carriage-aware record stream for a list of segments under a
 * given set of carriage constraints. The cursor starts at (0, 0) with
 * the carriage at 0; each segment's deltas are applied in order. Returns
 * one PlannedRecord per machine record.
 *
 * Emits SHORT records where the needle can reach the target inside the
 * slot from the planted carriage; emits JUMP records (≤ 1 mm dx each)
 * when the carriage must walk to keep the needle in slot. Refuses with
 * `{ ok: false, error: { code: 'reach', segmentIndex } }` if a jump would
 * land the carriage past `±carriageReachHalfMm`.
 */
export function planFoot(
  c: CarriageConstraints,
  segments: ReadonlyArray<{ dxRaw: number; dyRaw: number }>,
  opts: PlanFootOptions = {},
): PlanResult {
  const slotHalfRaw = c.needleSlotHalfMm * X_UNITS_PER_MM;
  const reachHalfRaw = c.carriageReachHalfMm * X_UNITS_PER_MM;
  const maxNeedleMm = opts.maxNeedleMm ?? Infinity;
  const maxNeedleDxRaw = maxNeedleMm * X_UNITS_PER_MM;
  const maxNeedleDyRaw = maxNeedleMm * Y_UNITS_PER_MM;
  const pieceDxCap = Math.min(X_UNITS_PER_MM, maxNeedleDxRaw);
  const pieceDyCap = Math.min(STITCH_DY_MAX_RAW, maxNeedleDyRaw);
  const records: PlannedRecord[] = [];

  let cursorXRaw = opts.initialCursorXRaw ?? 0;
  let cursorYRaw = 0;
  let carriageXRaw = opts.initialCarriageXRaw ?? 0;

  // Single push site for the five record-emit locations below. Each had
  // an identical raw→mm conversion for cursor/carriage; centralising it
  // means future tweaks to PlannedRecord (or the raw-units convention)
  // land in one place. Reads the outer cursor/carriage state, which is
  // always updated BEFORE the push at every call site.
  const pushRecord = (kind: 'short' | 'jump', dxRaw: number, dyRaw: number): void => {
    records.push({
      kind,
      dxRaw,
      dyRaw,
      endXMm: cursorXRaw / X_UNITS_PER_MM,
      endYMm: cursorYRaw / Y_UNITS_PER_MM,
      carriageXMm: carriageXRaw / X_UNITS_PER_MM,
    });
  };

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]!;
    const targetXRaw = cursorXRaw + seg.dxRaw;

    // Fast path: target lands inside the carriage's slot AND the segment
    // fits both per-record envelopes (|dy| ≤ STITCH_DY_MAX_RAW; |dx| ≤
    // int8 is implicit because shorts use int8 dx, but the fast-path test
    // is triggered by slot fit which is much tighter than int8 anyway).
    // Uniform mode disables the fast path when |dx| exceeds the configured
    // needle cap so the slow-path piece sizing can split it.
    if (
      Math.abs(targetXRaw - carriageXRaw) <= slotHalfRaw + EPSILON &&
      Math.abs(seg.dyRaw) <= STITCH_DY_MAX_RAW &&
      Math.abs(seg.dxRaw) <= maxNeedleDxRaw &&
      Math.abs(seg.dyRaw) <= maxNeedleDyRaw
    ) {
      cursorXRaw = targetXRaw;
      cursorYRaw += seg.dyRaw;
      pushRecord('short', seg.dxRaw, seg.dyRaw);
      continue;
    }

    // Slow path. In uniform mode (`maxNeedleDxRaw ≤ pieceDxCap`) every
    // piece is already capped at 1 mm dx, so the v1 even-distribute
    // splitter and the Phase A + Phase B algorithm produce identical
    // record counts — but the v1 distribution preserves byte-equality
    // with imported fixtures, so we take that path for uniform mode.
    // Compact mode (`maxNeedleDxRaw === Infinity`) takes the new
    // coalescing path.
    if (maxNeedleDxRaw <= pieceDxCap) {
      const nByDx = Math.ceil(Math.abs(seg.dxRaw) / pieceDxCap);
      const nByDy = Math.ceil(Math.abs(seg.dyRaw) / pieceDyCap);
      const n = Math.max(1, nByDx, nByDy);
      const signXLegacy = Math.sign(seg.dxRaw);
      const stepX = signXLegacy * Math.floor(Math.abs(seg.dxRaw) / n);
      let xRem = Math.abs(seg.dxRaw) - Math.abs(stepX) * n;
      const stepY = Math.trunc(seg.dyRaw / n);
      let yRem = seg.dyRaw - stepY * n;
      for (let i = 0; i < n; i++) {
        const extraX = xRem > 0 ? signXLegacy : 0;
        if (xRem > 0) xRem--;
        const signYLegacy = Math.sign(yRem);
        const extraY = signYLegacy;
        if (yRem !== 0) yRem -= signYLegacy;
        const dxPiece = stepX + extraX;
        const dyPiece = stepY + extraY;
        const nextCursorX = cursorXRaw + dxPiece;
        const inSlot = Math.abs(nextCursorX - carriageXRaw) <= slotHalfRaw + EPSILON;
        cursorXRaw = nextCursorX;
        cursorYRaw += dyPiece;
        if (!inSlot) {
          const nextCarriage = carriageXRaw + dxPiece;
          if (Math.abs(nextCarriage) > reachHalfRaw + EPSILON) {
            return { ok: false, error: { code: 'reach', segmentIndex: segIdx } };
          }
          carriageXRaw = nextCarriage;
        }
        pushRecord(inSlot ? 'short' : 'jump', dxPiece, dyPiece);
      }
      continue;
    }

    // Compact-mode slow path. Two phases:
    //   Phase A — slot-internal shorts. While the cursor can still reach
    //   forward along the segment without moving the carriage, emit one
    //   short of |dx| up to the slot reach (capped by the int8 short
    //   envelope of 127). dy is proportional to the slope; if it would
    //   exceed pieceDyCap, the piece's dx is shrunk to keep the stitch
    //   on the segment line. (Coalescing consecutive in-slot shorts in
    //   the OOW branch.)
    //
    //   Phase B — walking jumps. Once the cursor sits at the slot edge,
    //   walk the carriage in ≤ pieceDxCap steps (the firmware jump cap),
    //   sewing one needle per walked piece. dy is allocated by cumulative
    //   line-position so each piece's running endpoint stays on the
    //   segment.
    let remDx = seg.dxRaw;
    let remDy = seg.dyRaw;
    const signX = Math.sign(seg.dxRaw) || 1;
    const signY = Math.sign(seg.dyRaw) || 1;

    // Phase A — slot-internal shorts.
    while (Math.abs(remDx) > EPSILON) {
      // Slot reach along the segment's direction from the current cursor.
      const slotEdgeRaw = carriageXRaw + signX * slotHalfRaw;
      const reachAlongDir = (slotEdgeRaw - cursorXRaw) * signX;
      if (reachAlongDir <= EPSILON) break;

      // First-pass piece sizing (slot reach + envelope caps).
      let aDx = signX * Math.min(
        Math.abs(remDx),
        reachAlongDir,
        SHORT_DX_INT8_MAX,
        maxNeedleDxRaw,
      );
      // Proportional dy with integer rounding, sign-preserving — match
      // the piece dy to the segment's slope so the needle lands on the
      // segment line at the piece's endpoint.
      let aDy = remDx !== 0 ? Math.round((remDy * aDx) / remDx) : 0;

      // If proportional dy exceeds the Y cap, clip dy and shrink dx to
      // keep the piece on the segment line. Guard against shrinking to
      // zero (very vertical segment with tiny remDx) — clip dx to one
      // raw unit so the loop makes progress.
      if (Math.abs(aDy) > pieceDyCap) {
        aDy = signY * pieceDyCap;
        if (remDy !== 0) {
          const scaledDx = Math.round((remDx * aDy) / remDy);
          aDx = signX * Math.max(1, Math.min(Math.abs(scaledDx), reachAlongDir, SHORT_DX_INT8_MAX, maxNeedleDxRaw, Math.abs(remDx)));
        }
      }

      cursorXRaw += aDx;
      cursorYRaw += aDy;
      remDx -= aDx;
      remDy -= aDy;
      pushRecord('short', aDx, aDy);

      // Cursor sits at (or past) the slot edge in this direction — stop
      // Phase A and let Phase B walk.
      if (Math.abs(cursorXRaw - carriageXRaw) >= slotHalfRaw - EPSILON) break;
    }

    // Phase B — walking jumps. Distribute the remaining dx as fill-1-mm-
    // first pieces (the firmware cap), with dy allocated cumulatively
    // along the segment line so the running endpoint of piece i lands at
    // the same y as the line would predict for its x.
    if (Math.abs(remDx) > EPSILON) {
      const phaseBStartDxAbs = Math.abs(remDx);
      const phaseBStartDy = remDy;
      const nByDx = Math.ceil(phaseBStartDxAbs / pieceDxCap);
      const nByDy = Math.ceil(Math.abs(phaseBStartDy) / pieceDyCap);
      const n = Math.max(1, nByDx, nByDy);

      let consumedDxAbs = 0;
      let consumedDy = 0;
      for (let i = 0; i < n; i++) {
        const remainingDxAbs = phaseBStartDxAbs - consumedDxAbs;
        // Fill-1-mm-first: every piece but the last takes pieceDxCap; the
        // last carries whatever raw units remain. dy then tracks
        // cumulative line position so per-piece dy ≤ pieceDyCap by
        // construction (n was sized for this).
        const dxPieceAbs = i < n - 1 ? Math.min(pieceDxCap, remainingDxAbs) : remainingDxAbs;
        const dxPiece = signX * dxPieceAbs;
        consumedDxAbs += dxPieceAbs;
        const targetDy = Math.round((phaseBStartDy * consumedDxAbs) / phaseBStartDxAbs);
        const dyPiece = targetDy - consumedDy;
        consumedDy = targetDy;

        const nextCarriage = carriageXRaw + dxPiece;
        if (Math.abs(nextCarriage) > reachHalfRaw + EPSILON) {
          return {
            ok: false,
            error: { code: 'reach', segmentIndex: segIdx },
          };
        }
        cursorXRaw += dxPiece;
        cursorYRaw += dyPiece;
        carriageXRaw = nextCarriage;
        remDx -= dxPiece;
        remDy -= dyPiece;
        pushRecord('jump', dxPiece, dyPiece);
      }
    }

    // Pure-Y carry-over. Phase A skips when |remDx| is 0; Phase B walks
    // dx, not dy. So any remDy left over (either a pure-Y segment from
    // the start, or a Phase-A leftover) is subdivided into shorts here.
    if (Math.abs(remDy) > EPSILON) {
      const remDyAbs = Math.abs(remDy);
      const n = Math.max(1, Math.ceil(remDyAbs / pieceDyCap));
      const stepY = Math.trunc(remDy / n);
      let yRem = remDy - stepY * n;
      for (let i = 0; i < n; i++) {
        const sY = Math.sign(yRem);
        const dyPiece = stepY + sY;
        if (yRem !== 0) yRem -= sY;
        cursorYRaw += dyPiece;
        pushRecord('short', 0, dyPiece);
      }
    }
  }

  return { ok: true, records };
}

/**
 * Variant of {@link planFoot} that returns one bucket per input segment.
 * Lets the preview ask "how many drops belong to segment i?" without
 * re-running the planner per segment — the planner threads cumulative
 * cursor/carriage state through the whole iteration, so per-segment
 * runs in isolation would give different decisions.
 */
export function planFootGroupedBySegment(
  c: CarriageConstraints,
  segments: ReadonlyArray<{ dxRaw: number; dyRaw: number }>,
  opts: PlanFootOptions = {},
): GroupedPlanResult {
  // For each input segment the flat planner emits EITHER one short
  // (entire segment fits in slot AND in the dy cap) OR a piece sequence
  // whose dx/dy sums back to the segment's total. We recover the
  // grouping by walking input segments and peeling records off the front
  // until the bucket's running dx/dy equals the segment's. The piece
  // sequence can mix shorts and jumps now (per-piece decision), so the
  // accumulator is kind-agnostic — we stop once the geometry matches.
  const flat = planFoot(c, segments, opts);
  if (!flat.ok) return flat;
  const buckets: PlannedRecord[][] = [];
  let i = 0;
  for (const seg of segments) {
    if (i >= flat.records.length) {
      buckets.push([]);
      continue;
    }
    const bucket: PlannedRecord[] = [];
    let sumDx = 0;
    let sumDy = 0;
    while (i < flat.records.length) {
      const r = flat.records[i]!;
      bucket.push(r);
      sumDx += r.dxRaw;
      sumDy += r.dyRaw;
      i += 1;
      if (sumDx === seg.dxRaw && sumDy === seg.dyRaw) break;
    }
    buckets.push(bucket);
  }
  return { ok: true, buckets };
}
