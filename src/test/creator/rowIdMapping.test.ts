import { describe, it, expect } from 'vitest';
import { currentRowFromStep, stepFromRow } from '../../ui/creator/rowIdMapping.js';
import type { Stitch, StitchSequence } from '../../creator/pipeline/stitch.js';

const start: Stitch = { kind: 'start', x: 0, y: 0, sourceIndex: -1, carriageXMm: 0 };

function seq(): StitchSequence {
  return [
    start,
    { kind: 'needle', x: 1, y: 1, dxRaw: 8, dyRaw: 12, sourceIndex: 0, carriageXMm: 0 },
    { kind: 'needle', x: 2, y: 2, dxRaw: 8, dyRaw: 12, sourceIndex: 0, carriageXMm: 0 },
    { kind: 'jump',   x: 3, y: 3, dxRaw: 8, dyRaw: 12, sourceIndex: 1, carriageXMm: 1 },
  ];
}

describe('currentRowFromStep', () => {
  it('returns null for step ≤ 0', () => {
    expect(currentRowFromStep(seq(), 0, 'design')).toBeNull();
    expect(currentRowFromStep(seq(), -1, 'design')).toBeNull();
  });

  it('returns "start" for step 1 (the start marker)', () => {
    expect(currentRowFromStep(seq(), 1, 'design')).toBe('start');
  });

  it('returns the segment-index string in design mode', () => {
    expect(currentRowFromStep(seq(), 2, 'design')).toBe('0');
    expect(currentRowFromStep(seq(), 3, 'design')).toBe('0');
    expect(currentRowFromStep(seq(), 4, 'design')).toBe('1');
  });

  it('returns the manual row id ("m{i}") in manual mode', () => {
    expect(currentRowFromStep(seq(), 2, 'manual')).toBe('m0');
    expect(currentRowFromStep(seq(), 3, 'manual')).toBe('m1');
    expect(currentRowFromStep(seq(), 4, 'manual')).toBe('m2');
  });

  it('returns null when step is past the end of the sequence', () => {
    expect(currentRowFromStep(seq(), 99, 'design')).toBeNull();
  });
});

describe('stepFromRow', () => {
  it("'start' → step 1", () => {
    expect(stepFromRow(seq(), 'start')).toBe(1);
  });

  it("'m{i}' → step i + 2 (clamped to seq length)", () => {
    expect(stepFromRow(seq(), 'm0')).toBe(2);
    expect(stepFromRow(seq(), 'm1')).toBe(3);
    // Out-of-range manual id clamps to the sequence length.
    expect(stepFromRow(seq(), 'm99')).toBe(4);
  });

  it("'m' with non-numeric tail falls back to step 1", () => {
    expect(stepFromRow(seq(), 'mfoo')).toBe(1);
  });

  it('numeric segIdx → step of the LAST stitch from that segment', () => {
    // Segment 0 spans steps 2 and 3; the last is step 3.
    expect(stepFromRow(seq(), '0')).toBe(3);
    // Segment 1 spans only step 4.
    expect(stepFromRow(seq(), '1')).toBe(4);
  });

  it('unknown segment id falls back to step 1', () => {
    expect(stepFromRow(seq(), '999')).toBe(1);
  });
});
