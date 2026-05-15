// File-format limits derived from the .sh7 0x06 chunk encoding.
//
// In the 0x06 metadata, the design's Y dimension is stored twice — as
// `Y_µm` at val[1] (BE16) and as `Y_µm × 1.5` at val[2] (BE16). The 1.5×
// pair encodes the asymmetric 1/8 mm × 1/12 mm stitch grid (FORMAT.md §
// "The 1.5× Y-pair"). Because val[2] must fit in a BE16 (max = 65535),
// the design's Y dimension is capped at:
//
//     Y_µm ≤ 65535 / 1.5 = 43,690 µm = 43.69 mm
//
// This is the FILE-FORMAT limit on the overall design height. Splitting a
// design into multi-element ("n=3 multi-element") sub-blocks does not relax it:
// the 0x06 chunk records the design's *overall* dimensions regardless of
// how many element/satin sub-blocks the geometry is split into.

import { Y_UNITS_PER_MM } from '../parser/units.js';

/** Maximum design Y dimension in mm enforceable by the .sh7 file format. */
export const SH7_MAX_Y_MM = 43.69;

// Per-record firmware Y envelope: |dy| ≤ 4 mm for both short stitches and
// long-jump records. Empirical bound from the observed sample files and
// the verified-good the reference baselines (singleton + multi-element) baselines, where both kinds cap at
// 48 raw on the Y axis (1/12 mm/unit → 4 mm exactly).
export const STITCH_DY_MAX_MM = 4;
export const STITCH_DY_MAX_RAW = STITCH_DY_MAX_MM * Y_UNITS_PER_MM;

// Per-record firmware X envelope on jump records: |dxHi| ≤ 1, i.e. each
// long-jump record advances the carriage by at most 1 mm. Same value across
// every foot tested on the machine — a property of the firmware, not the
// foot — so it lives here next to the dy cap rather than on the Foot record.
export const PER_RECORD_JUMP_CAP_MM = 1;

// Satin cone widthStart / widthEnd envelope. Inside a satin chunk the
// firmware sweeps the needle to deposit the zigzag fill — the carriage
// stays planted — so cone widths greater than the needle window can't be
// sewn. Empirical: across the observed NN=5 sample files widthStart and
// widthEnd both top out at 7 mm exactly. On-machine probes confirmed
// widthStart=6 mm loads + renders, widthStart=8 mm loads-but-blank,
// widthStart=10 mm rejects the file. 7 mm is the data-supported ceiling.
export const SATIN_WIDTH_MAX_MM = 7;
// Smallest cone width observed across samples; one raw stitch X unit
// (1/8 mm) — the quantization floor of the format.
export const SATIN_WIDTH_MIN_MM = 0.25;

/** Clamp a hoop height to the file-format-supported maximum. */
export function clampHoopH(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return SH7_MAX_Y_MM;
  return Math.min(h, SH7_MAX_Y_MM);
}

/** Clamp a Y coordinate (mm) into [0, hoopH] (or [0, SH7_MAX_Y_MM] when no hoop given). */
export function clampStitchY(y: number, hoopH: number = SH7_MAX_Y_MM): number {
  if (!Number.isFinite(y)) return 0;
  if (y < 0) return 0;
  const max = Math.min(hoopH, SH7_MAX_Y_MM);
  return Math.min(y, max);
}
