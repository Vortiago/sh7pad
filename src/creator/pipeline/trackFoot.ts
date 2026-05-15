// FootTracker — thin facade that joins a StitchSequence's per-stitch
// position with the carriage X the encoder already computed. The
// encoder owns the carriage path; the tracker just reshapes each
// Stitch into the FootFrame shape consumers expect.
//
// Why this is a facade and not a re-derivation: the firmware's carriage
// model has subtleties (satin spine pinning, long-short auto-walk) that
// can't be derived from `kind`+`dxRaw` alone, and any rule the tracker
// invents to do so contradicts at least one encoder. Centralising the
// computation in the encoder — where the chain state is tracked — and
// reading it here as plain data eliminates a class of "tracker says X,
// firmware does Y" bugs by construction.

import type { StitchSequence } from './stitch.js';

export interface FootFrame {
  /** Virtual carriage X in mm at this frame, sourced from each Stitch's carriageXMm. */
  carriageXMm: number;
  /** Absolute needle X position in mm at this frame. */
  needleXMm: number;
  /** Absolute needle Y position in mm at this frame. */
  needleYMm: number;
}

export type FootTrack = FootFrame[];

/**
 * Map each Stitch in `seq` to a `FootFrame`. The frame at `track[i]`
 * describes the foot/carriage state immediately *after* the stitch at
 * `seq[i]` has happened.
 */
export function trackFoot(seq: StitchSequence): FootTrack {
  return seq.map((s) => ({
    carriageXMm: s.carriageXMm,
    needleXMm: s.x,
    needleYMm: s.y,
  }));
}
