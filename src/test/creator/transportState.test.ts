import { describe, it, expect } from 'vitest';
import { transportStateNow } from '../../ui/creator/store/transportState.js';
import type { StitchSequence } from '../../creator/pipeline/stitch.js';

function seq(): StitchSequence {
  return [
    { kind: 'start',  x: 0,  y: 0,  sourceIndex: -1, carriageXMm: 0 },
    { kind: 'needle', x: 5,  y: 7,  dxRaw: 40, dyRaw: 84, sourceIndex: 0, carriageXMm: 0 },
    { kind: 'needle', x: 10, y: 14, dxRaw: 40, dyRaw: 84, sourceIndex: 1, carriageXMm: 0 },
  ];
}

const inputs = (over: Partial<{ step: number; playing: boolean; speed: number }> = {}) => ({
  step: 0, playing: false, speed: 8, ...over,
});

describe('transportStateNow', () => {
  it('reports step 0 with x/y defaulting to 0 (no current stitch)', () => {
    const out = transportStateNow(seq(), inputs({ step: 0 }));
    expect(out.step).toBe(0);
    expect(out.totalSteps).toBe(3);
    expect(out.currentXmm).toBe(0);
    expect(out.currentYmm).toBe(0);
  });

  it('step 1 reports the start marker coords', () => {
    const out = transportStateNow(seq(), inputs({ step: 1 }));
    expect(out.currentXmm).toBe(0);
    expect(out.currentYmm).toBe(0);
  });

  it('step 2 reports the first needle stitch coords', () => {
    const out = transportStateNow(seq(), inputs({ step: 2 }));
    expect(out.currentXmm).toBe(5);
    expect(out.currentYmm).toBe(7);
  });

  it('step past the end defaults to 0/0 (no stitch at that index)', () => {
    const out = transportStateNow(seq(), inputs({ step: 99 }));
    expect(out.currentXmm).toBe(0);
    expect(out.currentYmm).toBe(0);
  });

  it('passes through playing and speed', () => {
    const out = transportStateNow(seq(), inputs({ step: 1, playing: true, speed: 12 }));
    expect(out.playing).toBe(true);
    expect(out.speed).toBe(12);
  });

  it('totalSteps reflects the full sequence length', () => {
    const out = transportStateNow(seq(), inputs());
    expect(out.totalSteps).toBe(3);
  });

  it('empty sequence reports totalSteps 0 and zeroed coords', () => {
    const empty: StitchSequence = [];
    const out = transportStateNow(empty, inputs());
    expect(out.totalSteps).toBe(0);
    expect(out.currentXmm).toBe(0);
    expect(out.currentYmm).toBe(0);
  });
});
