// trackFoot — thin facade tests. The encoder owns carriage motion;
// trackFoot just reshapes each Stitch into the FootFrame consumers expect.
//
// Behavioural tests (carriage walks with jumps, stays planted under
// short hops, rides the spine through satin chunks) live where the
// behaviour is produced — encodeDesign.test.ts and the multi-block
// emit tests — not here.

import { describe, it, expect } from 'vitest';
import { trackFoot } from '../../../creator/pipeline/trackFoot.js';
import type { StitchSequence } from '../../../creator/pipeline/stitch.js';

describe('trackFoot — empty sequence', () => {
  it('yields an empty track', () => {
    const seq: StitchSequence = [];
    expect(trackFoot(seq)).toEqual([]);
  });
});

describe('trackFoot — reads carriageXMm verbatim from each Stitch', () => {
  it('reports carriageXMm verbatim from the sequence', () => {
    const seq: StitchSequence = [
      { kind: 'start',  x: 0, y: 0, sourceIndex: -1, carriageXMm: 0 },
      { kind: 'needle', x: 2, y: 0, dxRaw: 16, dyRaw: 0, sourceIndex: 0, carriageXMm: 0 },
      { kind: 'jump',   x: 2, y: 1, dxRaw: 0, dyRaw: 12, sourceIndex: 0, carriageXMm: 1.5 },
    ];
    expect(trackFoot(seq)).toEqual([
      { carriageXMm: 0, needleXMm: 0, needleYMm: 0 },
      { carriageXMm: 0, needleXMm: 2, needleYMm: 0 },
      { carriageXMm: 1.5, needleXMm: 2, needleYMm: 1 },
    ]);
  });

  it('needle X / Y come from each stitch position', () => {
    const seq: StitchSequence = [
      { kind: 'start',  x: 0, y: 0, sourceIndex: -1, carriageXMm: 0 },
      { kind: 'needle', x: 2, y: 3, dxRaw: 16, dyRaw: 36, sourceIndex: 0, carriageXMm: 0 },
      { kind: 'jump',   x: 5, y: 7, dxRaw: 24, dyRaw: 48, sourceIndex: 0, carriageXMm: 3 },
    ];
    const track = trackFoot(seq);
    expect(track[1]?.needleXMm).toBe(2);
    expect(track[1]?.needleYMm).toBe(3);
    expect(track[2]?.needleXMm).toBe(5);
    expect(track[2]?.needleYMm).toBe(7);
  });
});
