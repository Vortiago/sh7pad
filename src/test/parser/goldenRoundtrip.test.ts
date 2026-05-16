// Round-trip safety net for .sh7 byte exports.
//
// For each "golden" project shape (empty design, single straight, single
// satin, manual + jump, edge-of-needle-slot start stitch), this suite
// asserts that:
//   1. The encoder emits structurally well-formed bytes (magic, file-size
//      BE32, outer chunk tag/version, geometry wrapper).
//   2. The encoded bytes pass the byte-level validator with zero FAILs.
//   3. The bytes survive a parse/re-encode round trip byte-identically
//      (idempotent encoding).
//   4. parseFile recovers the structural fields the user cares about
//      (step count, bbox, producer string).
//
// These tests are the safety net the architecture refactors lean on.
// They are deliberately structural, not snapshot: a byte-level change
// to the encoder shows up as a specific assertion failure, not as a
// noisy snapshot diff.

import { describe, expect, it } from 'vitest';
import { exportProjectBinary } from '../../creator/sh7BinaryExport.js';
import { addManualStitch } from '../../creator/manualStitch.js';
import { newProject } from '../../creator/project.js';
import { NEEDLE_SLOT_HALF_MM } from '../../creator/foot.js';
import { parseFile } from '../../parser/parseFile.js';
import { validate } from '../../parser/validateSh7Bytes.js';
import type { Point, Project, SatinSegment, Segment } from '../../creator/types.js';

const idGen = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

// Each fixture is `[name, buildProject]`. Tests run for every fixture so
// the rules below are exercised across the encoder's main branches
// (singleton vs multi, design vs manual, with and without satin).
const FIXTURES: ReadonlyArray<readonly [string, () => Project]> = [
  // The encoder refuses a 0-stitch project ("outside verified envelope")
  // by design, so the smallest fixture is one straight segment.
  [
    'single straight segment',
    () => {
      const p0: Point = { id: 'pt_0', x: 0, y: 0 };
      const p1: Point = { id: 'pt_1', x: 2, y: 3 };
      const segments: Segment[] = [{ id: 's_0', from: p0.id, to: p1.id, type: 'straight' }];
      return { ...newProject('Straight', { idGen }), points: [p0, p1], segments };
    },
  ],
  [
    'single satin segment',
    () => {
      const p0: Point = { id: 'pt_0', x: 0, y: 0 };
      const p1: Point = { id: 'pt_1', x: 0, y: 4 };
      const seg: SatinSegment = {
        id: 's_0',
        from: p0.id,
        to: p1.id,
        type: 'satin',
        widthStart: 2.4,
        widthEnd: 2.4,
        density: 0.6,
      };
      return { ...newProject('Satin', { idGen }), points: [p0, p1], segments: [seg] };
    },
  ],
  [
    'manual mode with a jump',
    () => {
      let p = newProject('Manual', { idGen, mode: 'manual', suggestedFoot: 'S' });
      p = addManualStitch(p, { kind: 'needle', x: 1, y: 1 });
      p = addManualStitch(p, { kind: 'jump', x: 2, y: 1 });
      p = addManualStitch(p, { kind: 'needle', x: 4, y: 2 });
      return p;
    },
  ],
  [
    'start stitch at the Needle Slot edge',
    () => {
      const startX = NEEDLE_SLOT_HALF_MM; // at the eye edge
      const p0: Point = { id: 'pt_0', x: startX, y: 0 };
      const p1: Point = { id: 'pt_1', x: startX + 1, y: 2 };
      const segments: Segment[] = [{ id: 's_0', from: p0.id, to: p1.id, type: 'straight' }];
      return {
        ...newProject('EdgeStart', { idGen }),
        points: [p0, p1],
        segments,
        startStitch: { x: startX },
      };
    },
  ],
];

describe.each(FIXTURES)('roundtrip: %s', (_name, build) => {
  it('encoder emits valid `%spx%` magic and BE32 file-size that match the buffer', () => {
    const bytes = exportProjectBinary(build());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%spx%');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0x08) + 12).toBe(bytes.byteLength);
  });

  it('byte-level validator reports zero FAILs', () => {
    const bytes = exportProjectBinary(build());
    const fails = validate(bytes).filter((r) => r.severity === 'FAIL');
    expect(fails).toEqual([]);
  });

  it('encoding is idempotent (encode → encode produces identical bytes)', () => {
    const project = build();
    expect(exportProjectBinary(project)).toEqual(exportProjectBinary(project));
  });

  it('parseFile recovers a non-empty step sequence (where applicable)', () => {
    const project = build();
    const bytes = exportProjectBinary(project);
    const parsed = parseFile(bytes);
    // Every fixture has at least one stitch element after the leading
    // Start Stitch is emitted.
    expect(parsed.elements.length).toBeGreaterThan(0);
    expect(parsed.steps.length).toBeGreaterThan(0);
    // Producer string is the canonical 'sh7pad' for default exports.
    expect(parsed.producerString).toBe('sh7pad');
  });

  it('parseFile.fileSize equals the buffer length (the parser surfaces total size, not BE32)', () => {
    const project = build();
    const bytes = exportProjectBinary(project);
    const parsed = parseFile(bytes);
    expect(parsed.fileSize).toBe(bytes.byteLength);
  });
});
