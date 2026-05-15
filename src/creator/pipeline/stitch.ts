// Pipeline canonical types.
//
// The Source → Encoder → FootTracker → Renderers pipeline passes around a
// `StitchSequence` as the single representation of "what the machine will do".
// Every consumer (preview, editor, stitch list panel, binary writer) reads
// from this shape; new sources (manual stitch mode) plug in by emitting a
// `StitchSequence` directly without going through the segment encoder.
//
// Each Stitch carries everything a consumer needs at that index:
//   • kind + (x, y) coords + raw deltas (the "what gets sewn")
//   • sourceIndex (back-pointer to the originating segment — for design
//     mode; manual mode uses -1 throughout, start markers always -1)
//   • carriageXMm (firmware's carriage X after this record — the encoder
//     is the one place that knows the firmware's chain mechanics, so the
//     tracker reads this verbatim instead of re-deriving it)
//
// Earlier the sequence was three parallel arrays (stitches / sourceIndex
// / carriageXMm) producers had to keep in lockstep by hand. Folding the
// two bookkeeping fields onto each Stitch makes the lockstep invariant
// structural — there's nothing to keep in sync.
//
// User-facing vocabulary is "needle" / "jump"; the byte-level term "short"
// stays inside sh7BinaryExport.ts.
//
// dxRaw / dyRaw are signed integer stitch units (X: 8 / mm, Y: 12 / mm) and
// are populated for needle and jump stitches alike — they're what the binary
// writer emits and what the planner reasons about. The 'start' marker has
// no delta; only x/y.

export interface StartStitch {
  kind: 'start';
  x: number;
  y: number;
  /** Always -1 for the start marker (no originating segment). */
  sourceIndex: -1;
  /** Carriage X (mm) at the start of the sequence — equals the
   *  chain-anchor-relative `startXMm` for the project. */
  carriageXMm: number;
}

export interface NeedleStitch {
  kind: 'needle';
  x: number;
  y: number;
  dxRaw: number;
  dyRaw: number;
  /**
   * Originating segment index in design mode; -1 in manual mode and for
   * the start marker. Used by the stitch-list panel to map a playback
   * step back to a row, and inverse for click-to-jump.
   */
  sourceIndex: number;
  /**
   * Virtual carriage X (mm) after this record executes. Written by the
   * encoder, which is the one place that knows the firmware's chain
   * mechanics:
   *   • short stitches leave the carriage planted (only the needle
   *     swings within the foot's slot); the feed dog moves the fabric
   *     in Y but does not move it in X;
   *   • jumps slide the carriage by `dxHi` mm (or `dxRaw / X_UNITS_PER_MM`
   *     when dxHi is unset — equal for encoder-emitted jumps where
   *     dxLow = 0);
   *   • inside a satin chunk the carriage rides the cone's spine.
   * trackFoot reads this verbatim. Consumers don't infer carriage
   * motion from kind+dxRaw any more — that rule was leaky and led to
   * the visible post-satin foot lag.
   */
  carriageXMm: number;
}

export interface JumpStitch {
  kind: 'jump';
  x: number;
  y: number;
  dxRaw: number;
  dyRaw: number;
  /**
   * Signed dxHi field of the 7-byte long-jump record (in mm, ±127 valid
   * range but firmware-capped to ±1). The total cursor displacement of
   * the record is `dxLow + dxHi × 8` raw; the carriage actually slides
   * by `dxHi` mm (firmware envelope), while the remaining `dxLow / 8`
   * mm is an additional in-slot needle swing on top.
   *
   * Optional: encoder-emitted jumps cap |dx| at 8 raw, so dxHi = dx/8
   * and dxLow = 0 — both carriage models agree and dxHi can be derived
   * from dxRaw. Imported binary jumps (parsedStitchFileToManualProject)
   * set this explicitly because dxLow may differ from 0, in which case
   * the firmware-faithful carriage walk uses dxHi rather than dxRaw/8.
   */
  dxHi?: number;
  /** See {@link NeedleStitch.sourceIndex}. */
  sourceIndex: number;
  /** See {@link NeedleStitch.carriageXMm}. */
  carriageXMm: number;
}

export type Stitch = StartStitch | NeedleStitch | JumpStitch;

/**
 * Linear list of stitches in chain order. Always starts with a 'start'
 * marker when non-empty.
 */
export type StitchSequence = readonly Stitch[];

export const EMPTY_SEQUENCE: StitchSequence = [];
