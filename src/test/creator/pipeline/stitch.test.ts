// Pipeline canonical types — Stitch discriminated union and StitchSequence
// shape. The encoder bookkeeping fields (sourceIndex, carriageXMm) are
// required on every record by construction; there's no longer a "keep three
// parallel arrays in lockstep" invariant to enforce by hand.

import { describe, it, expect } from 'vitest';
import type { Stitch, StitchSequence } from '../../../creator/pipeline/stitch.js';
import { EMPTY_SEQUENCE } from '../../../creator/pipeline/stitch.js';

describe('Stitch discriminated union', () => {
  it('narrows on kind="start" to the no-delta shape', () => {
    const s: Stitch = { kind: 'start', x: 0, y: 0, sourceIndex: -1, carriageXMm: 0 };
    if (s.kind === 'start') {
      expect(s.x).toBe(0);
      expect(s.y).toBe(0);
      // @ts-expect-error 'start' has no dxRaw
      void s.dxRaw;
    }
  });

  it('narrows on kind="needle" to expose dxRaw and dyRaw', () => {
    const s: Stitch = { kind: 'needle', x: 1, y: 2, dxRaw: 8, dyRaw: 12, sourceIndex: 0, carriageXMm: 0 };
    if (s.kind === 'needle') {
      expect(s.dxRaw).toBe(8);
      expect(s.dyRaw).toBe(12);
    }
  });

  it('narrows on kind="jump" the same shape as needle', () => {
    const s: Stitch = { kind: 'jump', x: 1, y: 0, dxRaw: 8, dyRaw: 0, sourceIndex: 0, carriageXMm: 1 };
    if (s.kind === 'jump') {
      expect(s.dxRaw).toBe(8);
      expect(s.dyRaw).toBe(0);
    }
  });

  it('every Stitch carries sourceIndex and carriageXMm', () => {
    // Replaces the old "three parallel arrays in lockstep" invariant — the
    // bookkeeping fields are now required on each record by construction.
    const s: Stitch = { kind: 'needle', x: 0, y: 0, dxRaw: 0, dyRaw: 0, sourceIndex: 5, carriageXMm: 1.5 };
    expect(s.sourceIndex).toBe(5);
    expect(s.carriageXMm).toBe(1.5);
  });
});

describe('StitchSequence', () => {
  it('EMPTY_SEQUENCE is an empty array', () => {
    const seq: StitchSequence = EMPTY_SEQUENCE;
    expect(seq).toHaveLength(0);
  });

  it('is a flat readonly array of Stitch', () => {
    const seq: StitchSequence = [
      { kind: 'start',  x: 0, y: 0, sourceIndex: -1, carriageXMm: 0 },
      { kind: 'needle', x: 1, y: 0, dxRaw: 8, dyRaw: 0, sourceIndex: 0, carriageXMm: 0 },
      { kind: 'jump',   x: 2, y: 0, dxRaw: 8, dyRaw: 0, sourceIndex: 0, carriageXMm: 1 },
    ];
    expect(seq.length).toBe(3);
    expect(seq[0]!.kind).toBe('start');
    expect(seq[2]!.carriageXMm).toBe(1);
  });
});
