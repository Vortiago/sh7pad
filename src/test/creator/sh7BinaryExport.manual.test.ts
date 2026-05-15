// Phase 7: manual-mode .sh7 export.

import { describe, it, expect } from 'vitest';
import {
  exportProjectBinary,
  projectToDesignDraft,
  type DesignDraft,
  type SingletonDesignDraft,
} from '../../creator/sh7BinaryExport.js';
import { parseFile } from '../../parser/parseFile.js';
import { newProject } from '../../creator/project.js';
import { addManualStitch } from '../../creator/manualStitch.js';
import type { Project } from '../../creator/types.js';

function asSingleton(draft: DesignDraft): SingletonDesignDraft {
  if (draft.kind !== 'singleton') {
    throw new Error(`expected a singleton draft (got ${draft.kind})`);
  }
  return draft;
}

const idGen = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

function manualProjectS(stitches: { kind: 'needle' | 'jump'; x: number; y: number }[]): Project {
  let p = newProject('manual', { idGen, mode: 'manual', suggestedFoot: 'S' });
  for (const s of stitches) {
    p = addManualStitch(p, s);
  }
  return p;
}

describe('projectToDesignDraft — manual mode', () => {
  it('a sequence of three in-window needles exports as three short records', () => {
    const project = manualProjectS([
      { kind: 'needle', x: 1, y: 1 },
      { kind: 'needle', x: -1, y: 2 },
      { kind: 'needle', x: 2, y: 3 },
    ]);
    const draft = asSingleton(projectToDesignDraft(project));
    expect(draft.stitches).toHaveLength(3);
    expect(draft.stitches.every((s) => s.kind === 'short')).toBe(true);
    // dxRaw = 8 / mm, dyRaw = 12 / mm.
    expect(draft.stitches[0]).toEqual({ kind: 'short', dxRaw: 8, dyRaw: 12 });
    expect(draft.stitches[1]).toEqual({ kind: 'short', dxRaw: -16, dyRaw: 12 });
    expect(draft.stitches[2]).toEqual({ kind: 'short', dxRaw: 24, dyRaw: 12 });
  });

  it('a 1 mm jump becomes a single jump record with dx=8', () => {
    const project = manualProjectS([
      { kind: 'jump', x: 1, y: 0 },
    ]);
    const draft = asSingleton(projectToDesignDraft(project));
    expect(draft.stitches).toHaveLength(1);
    expect(draft.stitches[0]).toEqual({ kind: 'jump', dxRaw: 8, dyRaw: 0 });
  });

  it('a manual draft exports + reparses back to the same step sequence', () => {
    const project = manualProjectS([
      { kind: 'needle', x: 1, y: 1 },
      { kind: 'jump', x: 2, y: 1 }, // carriage 0 → 1
      { kind: 'needle', x: 4, y: 2 }, // valid: |4 − 1| = 3
    ]);
    const bytes = exportProjectBinary(project);
    const reparsed = parseFile(bytes);
    const steps = reparsed.elements[0]!.steps;
    expect(steps).toHaveLength(3);
    expect(steps[0]?.kind).toBe('short');
    expect(steps[1]?.kind).toBe('jump');
    expect(steps[2]?.kind).toBe('short');
    // Stitch deltas survive the round trip.
    expect(steps[0]).toMatchObject({ dx: 8, dy: 12 });
    expect(steps[1]).toMatchObject({ dx: 8, dy: 0 });
    expect(steps[2]).toMatchObject({ dx: 16, dy: 12 });
  });

  it('design dimensions are derived from the manual stitch bbox, not from points[]', () => {
    const project = manualProjectS([
      { kind: 'needle', x: 2, y: 1 },
      { kind: 'needle', x: -1, y: 5 },
    ]);
    const draft = asSingleton(projectToDesignDraft(project));
    // Bbox: x ∈ [-1, 2], y ∈ [0, 5]. xUm = 3 mm = 3000, yUm = 5 mm = 5000.
    expect(draft.xUm).toBe(3000);
    expect(draft.yUm).toBe(5000);
  });

  it('foot byte and tension byte come from the project as for design mode', () => {
    const project = manualProjectS([{ kind: 'needle', x: 0, y: 1 }]);
    project.threadTension = 5.5;
    const draft = asSingleton(projectToDesignDraft(project));
    expect(draft.footByte).toBe(0x07); // Foot S
    expect(draft.tensionByte).toBe(55);
  });
});
