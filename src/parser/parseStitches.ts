import { walkRecords } from '../format/recordCodec.js';
import type { ElementStep } from './types.js';

/**
 * Parse a `02 01 01` stitch-chunk payload into the annotated step stream
 * the rest of the codebase consumes. Record-level layout (short vs.
 * long-jump byte shape, dxHi/dxLow split) is owned by
 * [recordCodec](../format/recordCodec.ts); this function adds the
 * positional decoration (`elementIndex`, `stepInElement`, absolute
 * `byteOffset`, `byteLength`) the parser needs.
 */
export function parseStitchChunk(
  payload: Uint8Array,
  payloadOffset: number,
  options: { elementIndex?: number } = {},
): ElementStep[] {
  const elementIndex = options.elementIndex ?? 0;
  const steps: ElementStep[] = [];
  for (const r of walkRecords(payload)) {
    if (r.kind === 'jump') {
      steps.push({
        kind: 'jump',
        dx: r.dx,
        dy: r.dy,
        flag: r.flag,
        byteOffset: payloadOffset + r.recordOffset,
        byteLength: 7,
        elementIndex,
        stepInElement: steps.length,
      });
    } else {
      steps.push({
        kind: 'short',
        dx: r.dx,
        dy: r.dy,
        byteOffset: payloadOffset + r.recordOffset,
        byteLength: 2,
        elementIndex,
        stepInElement: steps.length,
      });
    }
  }
  return steps;
}
