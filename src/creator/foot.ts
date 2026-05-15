// Foot — registry of presser-foot facts and the mechanical validators
// that depend on a foot's identity.
//
// Every fact about a foot lives on a Foot record: the file byte the
// firmware reads, the needle slot ("|needle - carriage| ≤ slotHalf"),
// and the carriage's mm reach. The per-record firmware envelope
// (|dxHi| ≤ 1 mm for jumps, |dy| ≤ 4 mm for any record) is the same
// across every foot tested on the machine, so it lives in sh7Limits.
//
// The carriage planner does NOT live here. It reads two numeric
// constraints (needleSlotHalfMm, carriageReachHalfMm) and is otherwise
// foot-agnostic, so it has its own module (./carriagePlanner.ts) and
// accepts any value satisfying its CarriageConstraints interface — Foot
// records satisfy it by structural typing.
//
// V1 supports three ids:
//   - 'B' — Foot B, decorative. Carriage range ±4.5 mm; supports jumps.
//   - 'S' — Foot S, side-motion. Carriage range ±27.25 mm.
//   - 'hidden' — "no foot suggestion" byte (0xFF). Treated like Foot S
//                for editor gating so the user isn't blocked without cause.
//
// Both real feet sit on a movable carriage. Range and slot width are the
// only properties that vary across V1 feet — Foot B and Foot S share the
// same 6 mm needle window today, but the structure leaves room for a
// future foot variant with a different slot. The carriage advances on
// jumps and stays put on needle stitches; trackFoot encodes that mechanic
// foot-agnostically.

import { PER_RECORD_JUMP_CAP_MM } from './sh7Limits.js';

export type FootId = 'B' | 'S' | 'hidden';

export interface Foot {
  id: FootId;
  /** Label shown in the UI dropdown. */
  name: string;
  /** Byte the machine looks at to decide which foot icon to show. */
  byte: number;
  /** Maximum |needle − carriage| in mm. The mechanical needle window. */
  needleSlotHalfMm: number;
  /** Maximum |carriage X| in mm. The wide-carriage reach bound (Foot S vs Foot B). */
  carriageReachHalfMm: number;
}

/**
 * Half-width of the needle slot — the mechanical swing window around
 * the carriage. The sewing-machine manual gives the stitch width as
 * 0..7 mm; that's the slot total, so half = 3.5 mm.
 * The slot is foot-agnostic on this machine family — Foot S's wider
 * reach comes from the carriage sliding sideways (side-motion), not
 * from a wider slot.
 *
 * Important: the slot bounds the cursor's RANGE within a run of
 * consecutive shorts (between jumps), NOT |cursor − carriage| at each
 * individual stitch. The carriage sits somewhere inside the slot
 * window — its position within the slot is variable (the firmware can
 * anchor the carriage at the leading edge of an upcoming sweep), so
 * every run of shorts has up to 7 mm of cursor sweep available, even
 * when the cursor ends up 4+ mm from the planted carriage. See memory
 * `feedback_slot_is_run_span_not_per_stitch_lag.md`.
 *
 * Exported so callers (planFoot's slot test, needleAllowedAt's
 * placement gate, the preview's drawn foot-slot rectangle, and tests
 * that assert against the slot) all read from a single source — no
 * drift if the spec ever changes.
 */
export const NEEDLE_SLOT_HALF_MM = 3.5; // machine spec: 7 mm needle window total → 3.5 mm half
/** Convenience: full needle-slot width (= NEEDLE_SLOT_HALF_MM × 2). */
export const NEEDLE_SLOT_WIDTH_MM = NEEDLE_SLOT_HALF_MM * 2;

const FOOT_B_REACH_HALF_MM = 4.5;       // empirical, foot-B reference design is 9 mm wide with 2 jumps
const SIDE_MOTION_REACH_HALF_MM = 27.25; // Foot S carriage reach

export const FEET: readonly Foot[] = [
  {
    id: 'S',
    name: 'Foot S (Side-motion)',
    byte: 0x07,
    needleSlotHalfMm: NEEDLE_SLOT_HALF_MM,
    carriageReachHalfMm: SIDE_MOTION_REACH_HALF_MM,
  },
  {
    id: 'B',
    name: 'Foot B (Decorative)',
    byte: 0x02,
    needleSlotHalfMm: NEEDLE_SLOT_HALF_MM,
    carriageReachHalfMm: FOOT_B_REACH_HALF_MM,
  },
  {
    id: 'hidden',
    name: 'No suggestion',
    byte: 0xff,
    needleSlotHalfMm: NEEDLE_SLOT_HALF_MM,
    // Treat the no-suggestion case as the wider side-motion range so the
    // editor doesn't gate the user's design without cause.
    carriageReachHalfMm: SIDE_MOTION_REACH_HALF_MM,
  },
];

export const DEFAULT_FOOT_ID: FootId = 'S';

export function foot(id: FootId): Foot {
  return FEET.find((f) => f.id === id) ?? FEET[0]!;
}

/** Map a raw foot byte from the binary file onto the V1 Foot record. */
export function footFromByte(byte: number): Foot {
  const match = FEET.find((f) => f.byte === byte);
  return match ?? foot(DEFAULT_FOOT_ID);
}

/**
 * Frame snapshot — needle position + virtual carriage X. The shape
 * trackFoot emits and validateManualStitch consumes. Defined here so
 * foot.ts is a leaf module with no dependencies on the pipeline.
 */
export interface FootFrame {
  /** Virtual carriage X in mm. Starts at 0; advances by jump dx. */
  carriageXMm: number;
  /** Absolute needle X in mm. */
  needleXMm: number;
  /** Absolute needle Y in mm. */
  needleYMm: number;
}

const EPSILON = 1e-6;

/**
 * Is a needle stitch allowed at absolute X = `xMm` given the foot frame?
 * Checks the foot's mechanical needle window. Callers also clamp Y to
 * the hoop and reject the click if the project is in design mode.
 */
export function needleAllowedAt(
  f: Foot,
  frame: FootFrame,
  xMm: number,
): { ok: true } | { ok: false; reason: string } {
  const dxFromCarriage = Math.abs(xMm - frame.carriageXMm);
  if (dxFromCarriage > f.needleSlotHalfMm + EPSILON) {
    return {
      ok: false,
      reason: `needle ${xMm.toFixed(2)} mm is outside the foot's ±${f.needleSlotHalfMm} mm window (carriage at ${frame.carriageXMm.toFixed(2)} mm)`,
    };
  }
  return { ok: true };
}

/**
 * Is a jump to absolute X = `xMm` allowed given the foot frame?
 * Validates the per-record dx cap (firmware envelope, |dxHi| ≤ 1 mm)
 * and that the resulting carriage position stays inside the foot's reach.
 */
export function jumpAllowedTo(
  f: Foot,
  frame: FootFrame,
  xMm: number,
): { ok: true } | { ok: false; reason: string } {
  const jumpDxMm = xMm - frame.needleXMm;
  if (Math.abs(jumpDxMm) - PER_RECORD_JUMP_CAP_MM > EPSILON) {
    return {
      ok: false,
      reason: `jump dx=${jumpDxMm.toFixed(2)} mm exceeds the firmware envelope of ${PER_RECORD_JUMP_CAP_MM} mm per record`,
    };
  }
  const nextCarriage = frame.carriageXMm + jumpDxMm;
  if (Math.abs(nextCarriage) > f.carriageReachHalfMm + EPSILON) {
    return {
      ok: false,
      reason: `jump would land carriage at ${nextCarriage.toFixed(2)} mm, beyond foot ${f.id}'s ±${f.carriageReachHalfMm} mm range`,
    };
  }
  return { ok: true };
}
