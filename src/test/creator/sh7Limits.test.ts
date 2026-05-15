// File-format Y limit + project-level enforcement.
//
// The .sh7 0x06 chunk encodes Y_µm × 1.5 in a BE16, so Y is capped at
// 65535 / 1.5 = 43,690 µm = 43.69 mm. The encoder already throws on
// overflow at export time; these tests pin the *upstream* enforcement so
// the user can never build a project that would fail to export.

import { describe, it, expect } from 'vitest';
import {
  SH7_MAX_Y_MM,
  clampHoopH,
  clampStitchY,
} from '../../creator/sh7Limits.js';
import {
  newProject,
  migrateProject,
  addPointToProject,
} from '../../creator/project.js';
import { encode06Block } from '../../creator/sh7Codec.js';
import type { Project } from '../../creator/types.js';

describe('SH7_MAX_Y_MM', () => {
  it('matches the BE16 / 1.5 derivation (65535 / 1500 mm)', () => {
    // val[2] = round(Y_µm * 1.5) must be ≤ 65535.
    expect(SH7_MAX_Y_MM).toBe(43.69);
  });

  it('the encoder accepts SH7_MAX_Y_MM exactly', () => {
    expect(() =>
      encode06Block({
        footByte: 0,
        tensionByte: 0,
        yUm: SH7_MAX_Y_MM * 1000,
        xUm: 10_000,
      }),
    ).not.toThrow();
  });

  it('the encoder rejects yUm one micrometer over the limit', () => {
    expect(() =>
      encode06Block({
        footByte: 0,
        tensionByte: 0,
        yUm: SH7_MAX_Y_MM * 1000 + 1,
        xUm: 10_000,
      }),
    ).toThrow();
  });
});

describe('clampHoopH', () => {
  it('returns the input when within the limit', () => {
    expect(clampHoopH(20)).toBe(20);
    expect(clampHoopH(SH7_MAX_Y_MM)).toBe(SH7_MAX_Y_MM);
  });

  it('caps at SH7_MAX_Y_MM when input exceeds it', () => {
    expect(clampHoopH(150)).toBe(SH7_MAX_Y_MM);
    expect(clampHoopH(1000)).toBe(SH7_MAX_Y_MM);
  });

  it('falls back to SH7_MAX_Y_MM for non-positive or non-finite input', () => {
    expect(clampHoopH(0)).toBe(SH7_MAX_Y_MM);
    expect(clampHoopH(-5)).toBe(SH7_MAX_Y_MM);
    expect(clampHoopH(NaN)).toBe(SH7_MAX_Y_MM);
  });
});

describe('clampStitchY', () => {
  it('clamps below zero up to zero', () => {
    expect(clampStitchY(-3, SH7_MAX_Y_MM)).toBe(0);
  });

  it('clamps above hoopH down to hoopH', () => {
    expect(clampStitchY(50, SH7_MAX_Y_MM)).toBe(SH7_MAX_Y_MM);
  });

  it('passes a Y inside the range through unchanged', () => {
    expect(clampStitchY(20, SH7_MAX_Y_MM)).toBe(20);
  });

  it('caps at SH7_MAX_Y_MM even when hoopH is larger', () => {
    expect(clampStitchY(100, 200)).toBe(SH7_MAX_Y_MM);
  });
});

describe('project default hoop respects SH7_MAX_Y_MM', () => {
  it('newProject().hoop.h === SH7_MAX_Y_MM', () => {
    const p = newProject('Foo');
    expect(p.hoop.h).toBe(SH7_MAX_Y_MM);
  });
});

describe('migrateProject clamps hoop.h to SH7_MAX_Y_MM', () => {
  it('caps a 150 mm hoop at the file-format limit', () => {
    const p: Project = {
      ...newProject('Tall'),
      hoop: { halfW: 60, h: 150 },
    };
    const out = migrateProject(p);
    expect(out.hoop.h).toBe(SH7_MAX_Y_MM);
  });

  it('clamps points whose y exceeds the new hoop.h', () => {
    const p: Project = {
      ...newProject('Migrated'),
      hoop: { halfW: 60, h: 150 },
      points: [
        { id: 'p0', x: 0, y: 0 },
        { id: 'p1', x: 5, y: 100 },
        { id: 'p2', x: -3, y: 50 },
      ],
    };
    const out = migrateProject(p);
    const ys = out.points.map((pt) => pt.y);
    for (const y of ys) {
      expect(y).toBeLessThanOrEqual(SH7_MAX_Y_MM);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves a hoop already at SH7_MAX_Y_MM untouched', () => {
    const p: Project = {
      ...newProject('Fits'),
      hoop: { halfW: 60, h: SH7_MAX_Y_MM },
    };
    const out = migrateProject(p);
    expect(out.hoop.h).toBe(SH7_MAX_Y_MM);
  });
});

describe('addPointToProject clamps Y to within the hoop', () => {
  const ids = { pointId: 'newPt', segmentId: 'newSeg' };

  it('clicks below the hoop snap to hoop.h', () => {
    const p = newProject('X');
    const out = addPointToProject(p, { x: 0, y: 100 }, 'straight', ids, 1);
    const newPt = out.points.find((pt) => pt.id === 'newPt')!;
    expect(newPt.y).toBe(p.hoop.h);
  });

  it('clicks above zero are clamped to zero', () => {
    const p = newProject('X');
    const out = addPointToProject(p, { x: 5, y: -10 }, 'straight', ids, 1);
    const newPt = out.points.find((pt) => pt.id === 'newPt')!;
    expect(newPt.y).toBe(0);
  });

  it('satin clicks still clamp Y into the hoop after the last.y + 1 floor', () => {
    const p: Project = {
      ...newProject('X'),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 12, y: SH7_MAX_Y_MM - 0.5 },
      ],
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'straight' },
      ],
    };
    // last.y + 1 would be > SH7_MAX_Y_MM, so the clamp must win.
    const out = addPointToProject(p, { x: 5, y: 50 }, 'satin', ids, 1);
    const newPt = out.points.find((pt) => pt.id === 'newPt')!;
    expect(newPt.y).toBeLessThanOrEqual(SH7_MAX_Y_MM);
  });
});
