// End-to-end test for the byte-level validator driver. Exercises
// validateSh7Bytes.ts (`validate(buf)`) on real encoder output and on
// deliberately-mutated copies, so the per-domain validators are tested
// together as the driver wires them.

import { describe, expect, it } from 'vitest';
import { exportProjectBinary } from '../../../creator/sh7BinaryExport.js';
import { newProject } from '../../../creator/project.js';
import { validate } from '../../../parser/validateSh7Bytes.js';
import type { Point, Project, Segment } from '../../../creator/types.js';

function tinyDesignProject(): Project {
  const base = newProject('Tiny');
  const p0: Point = { id: 'pt_0', x: 0, y: 0 };
  const p1: Point = { id: 'pt_1', x: 1, y: 2 };
  const segments: Segment[] = [{ id: 's_0', from: p0.id, to: p1.id, type: 'straight' }];
  return { ...base, points: [p0, p1], segments };
}

describe('validate (driver)', () => {
  it('emits zero FAIL results on a freshly-exported tiny design', () => {
    const bytes = exportProjectBinary(tinyDesignProject());
    const fails = validate(bytes).filter((r) => r.severity === 'FAIL');
    expect(fails).toEqual([]);
  });

  it('FAILs the magic-byte rule when the first 5 bytes are wiped', () => {
    const bytes = exportProjectBinary(tinyDesignProject());
    bytes.set([0, 0, 0, 0, 0], 0);
    const fails = validate(bytes).filter((r) => r.severity === 'FAIL');
    expect(fails.some((r) => r.rule === 'magic')).toBe(true);
  });

  it('FAILs the file-too-short rule on a 5-byte buffer', () => {
    const fails = validate(new Uint8Array(5)).filter((r) => r.severity === 'FAIL');
    expect(fails.some((r) => r.rule === 'file too short')).toBe(true);
  });

  it('FAILs the outer-chunk version when the version byte is mutated', () => {
    const bytes = exportProjectBinary(tinyDesignProject());
    // The outer chunk tag (0x07) sits at offset 0x0E + producer-byte-length.
    // For the 'sh7pad' producer (12 bytes UTF-16BE) it is at offset 0x1A;
    // its version byte is the third byte of the chunk.
    const outerOff = 0x0e + 12;
    expect(bytes[outerOff]).toBe(0x07);
    bytes[outerOff + 2] = 0x05; // ver
    const fails = validate(bytes).filter((r) => r.severity === 'FAIL');
    expect(fails.some((r) => r.rule === 'outer chunk version')).toBe(true);
  });
});
