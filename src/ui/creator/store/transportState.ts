// Compute the preview transport's display state from a StitchSequence and
// the relevant slice of UiState. Pure helper — pulled out of the editor
// orchestrator so the bounds + readout math can be unit-tested.

import type { StitchSequence } from '../../../creator/pipeline/stitch.js';
import type { TransportState } from '../preview/transport.js';

export interface TransportInputs {
  step: number;
  playing: boolean;
  speed: number;
}

/**
 * Pick the stitch the transport should report at `step` (1-indexed; step ≤ 0
 * → no current stitch → x/y default to 0). Reading past the sequence end
 * returns 0 too, which matches today's "no current stitch" rendering.
 */
export function transportStateNow(
  seq: StitchSequence,
  inputs: TransportInputs,
): TransportState {
  const cur = seq[Math.max(0, inputs.step - 1)];
  return {
    step: inputs.step,
    totalSteps: seq.length,
    playing: inputs.playing,
    speed: inputs.speed,
    currentXmm: cur?.x ?? 0,
    currentYmm: cur?.y ?? 0,
  };
}
