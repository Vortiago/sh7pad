// Mapping between StitchSequence step indices and stitch-list RowIds.
//
// step is 1-indexed: step=0 means "before the start marker", step=1 selects
// the start marker, step=N selects seq[N-1]. The stitch list has three row
// kinds:
//   • 'start'         — the chain anchor (rendered first)
//   • '0', '1', …     — segment indices in design mode
//   • 'm0', 'm1', …   — manual-stitch indices in manual mode
//
// Pulled out of mountCreator so the mapping can be unit-tested without DOM.

import type { StitchSequence } from '../../creator/pipeline/stitch.js';
import type { ProjectMode } from '../../creator/types.js';
import type { RowId } from './stitchListPanel/panel.js';

/** Encode a manual-stitch index into the row-id format. */
export function manualRowId(idx: number): RowId {
  return `m${idx}`;
}

/** Parse a manual-stitch row id back to its index, or null when the row
 *  isn't a manual row (e.g. 'start', a segment index). */
export function parseManualRowId(row: RowId | string): number | null {
  if (typeof row !== 'string' || !row.startsWith('m')) return null;
  const idx = Number(row.slice(1));
  return Number.isFinite(idx) ? idx : null;
}

/**
 * Map a 1-indexed step to its stitch-list RowId.
 *
 *   step <= 0       → null (no row highlighted)
 *   step === 1      → 'start'
 *   stitch.kind === 'start' → 'start' (defensive — re-pinning to the anchor)
 *   manual mode     → 'm{step-2}' (one row per manualStitch; the start marker
 *                                  takes step 1, so manual i sits at step i+2)
 *   design mode     → string(seq[step-1].sourceIndex) (segment index)
 */
export function currentRowFromStep(
  seq: StitchSequence,
  step: number,
  mode: ProjectMode,
): RowId | null {
  if (step <= 0) return null;
  if (step === 1) return 'start';
  const cur = seq[step - 1];
  if (!cur) return null;
  if (cur.kind === 'start') return 'start';
  if (mode === 'manual') return manualRowId(step - 2);
  return String(cur.sourceIndex);
}

/**
 * Inverse of {@link currentRowFromStep}: given a row, return the step index
 * that should be highlighted in the transport / playback.
 *
 *   'start'         → 1
 *   'm{i}'          → i + 2 (clamped to seq length)
 *   numeric segIdx  → step of the LAST stitch from that segment (so clicking
 *                     a segment row jumps preview to its endpoint)
 *   anything else   → 1 (defensive fall-back)
 */
export function stepFromRow(seq: StitchSequence, row: RowId): number {
  if (row === 'start') return 1;
  const mIdx = parseManualRowId(row);
  if (mIdx !== null) return Math.min(mIdx + 2, seq.length);
  const segIdx = Number(row);
  for (let i = seq.length - 1; i >= 0; i--) {
    if (seq[i]!.sourceIndex === segIdx) return i + 1;
  }
  return 1;
}
