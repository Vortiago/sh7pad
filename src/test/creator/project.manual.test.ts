// Phase 5: manual source data model + invariants.

import { describe, it, expect } from 'vitest';
import { newProject, lockProjectInvariants, migrateProject } from '../../creator/project.js';
import { createProjectStore } from '../../creator/projectStore.js';
import {
  addManualSatinSegment,
  addManualStitch,
  removeLastManualStitch,
  replaceManualStitches,
  updateManualSatin,
  validateManualStitch,
} from '../../creator/manualStitch.js';
import type { Project, Segment } from '../../creator/types.js';

const idGen = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

describe('newProject — mode/foot are creation-only and default sensibly', () => {
  it('defaults to design mode and the default suggested foot', () => {
    const p = newProject('A', { idGen });
    expect(p.mode).toBe('design');
    expect(p.manualStitches).toEqual([]);
  });

  it('accepts mode: "manual" + a suggestedFoot at creation', () => {
    const p = newProject('B', { idGen, mode: 'manual', suggestedFoot: 'B' });
    expect(p.mode).toBe('manual');
    expect(p.suggestedFoot).toBe('B');
    expect(p.manualStitches).toEqual([]);
  });
});

describe('lockProjectInvariants', () => {
  it('rejects mode mutations after creation', () => {
    const prev = newProject('A', { idGen, mode: 'design' });
    const next: Project = { ...prev, mode: 'manual' };
    expect(lockProjectInvariants(prev, next).mode).toBe('design');
  });

  it('rejects suggestedFoot mutations after creation', () => {
    const prev = newProject('A', { idGen, suggestedFoot: 'S' });
    const next: Project = { ...prev, suggestedFoot: 'B' };
    expect(lockProjectInvariants(prev, next).suggestedFoot).toBe('S');
  });

  it('clears stray manualStitches when mode === design', () => {
    const prev = newProject('A', { idGen });
    const next: Project = {
      ...prev,
      manualStitches: [{ kind: 'needle', x: 1, y: 0, dxRaw: 8, dyRaw: 0 }],
    };
    expect(lockProjectInvariants(prev, next).manualStitches).toEqual([]);
  });

  it('clears stray segments when mode === manual', () => {
    const prev = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const seg: Segment = { id: 'g', from: 'a', to: 'b', type: 'straight' };
    const next: Project = { ...prev, segments: [seg] };
    expect(lockProjectInvariants(prev, next).segments).toEqual([]);
  });

  it('does NOT revert mode/foot when prev and next are different projects (swap)', () => {
    const prev = newProject('A', { idGen, mode: 'design', suggestedFoot: 'S' });
    const next = newProject('B', { idGen, mode: 'manual', suggestedFoot: 'B' });
    const locked = lockProjectInvariants(prev, next);
    expect(locked.mode).toBe('manual');
    expect(locked.suggestedFoot).toBe('B');
  });

  // startXMm lock — per-mode rule (see project.ts:isStartLocked):
  //   design mode → always free (the encoder re-plans on every render)
  //   manual mode → locked once at least one manual stitch exists
  // Imported binaries set this from xElem; subsequent UI drags pass
  // through the invariant before reaching the store.
  it('design mode: startXMm stays free even after segments are added', () => {
    const prev: Project = { ...newProject('A', { idGen }), startXMm: 1 };
    const seg: Segment = { id: 'g', from: 'a', to: 'b', type: 'straight' };
    const next: Project = { ...prev, segments: [seg], startXMm: 20 };
    expect(lockProjectInvariants(prev, next).startXMm).toBe(20);
  });

  it('manual mode with no stitches: startXMm stays free', () => {
    const prev = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const next: Project = { ...prev, startXMm: 5 };
    expect(lockProjectInvariants(prev, next).startXMm).toBe(5);
  });

  it('manual mode after a stitch is placed: reverts startXMm to prev value', () => {
    const prev: Project = {
      ...newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' }),
      startXMm: -0.75,
      manualStitches: [{ kind: 'needle', x: 0, y: 0, dxRaw: 0, dyRaw: 0 }],
    };
    const next: Project = { ...prev, startXMm: 2 };
    expect(lockProjectInvariants(prev, next).startXMm).toBe(-0.75);
  });

  it('project swap (different id) is never locked even in manual mode with stitches', () => {
    // sidebar.onSelect — switching the active project must adopt the
    // new project's startXMm verbatim, no carry-over from prev.
    const prev: Project = {
      ...newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' }),
      startXMm: -0.75,
      manualStitches: [{ kind: 'needle', x: 0, y: 0, dxRaw: 0, dyRaw: 0 }],
    };
    const next: Project = {
      ...newProject('B', { idGen, mode: 'manual', suggestedFoot: 'S' }),
      startXMm: 1.25,
      manualStitches: [{ kind: 'needle', x: 0, y: 0, dxRaw: 0, dyRaw: 0 }],
    };
    expect(lockProjectInvariants(prev, next).startXMm).toBe(1.25);
  });
});

describe('createProjectStore — invariants applied on every setState', () => {
  it('initial state is invariant-locked', () => {
    const initial = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const seg: Segment = { id: 'g', from: 'a', to: 'b', type: 'straight' };
    const store = createProjectStore({ ...initial, segments: [seg] });
    expect(store.getState().segments).toEqual([]);
  });

  it('rejects mode flips through setState', () => {
    const initial = newProject('A', { idGen, mode: 'design', suggestedFoot: 'S' });
    const store = createProjectStore(initial);
    store.setState((p) => ({ ...p, mode: 'manual' }));
    expect(store.getState().mode).toBe('design');
  });

  it('rejects suggestedFoot flips through setState', () => {
    const initial = newProject('A', { idGen, suggestedFoot: 'S' });
    const store = createProjectStore(initial);
    store.setState((p) => ({ ...p, suggestedFoot: 'B' }));
    expect(store.getState().suggestedFoot).toBe('S');
  });

  it('swapping the active project (different id) keeps the new project\'s mode + foot', () => {
    // Sidebar "switch project" calls setState(otherProject). That's a swap,
    // not an in-place mutation, so the invariant must NOT revert mode/foot.
    const designProj = newProject('A', { idGen, mode: 'design', suggestedFoot: 'S' });
    const store = createProjectStore(designProj);
    const manualProj = newProject('B', { idGen, mode: 'manual', suggestedFoot: 'B' });
    store.setState(manualProj);
    expect(store.getState().id).toBe(manualProj.id);
    expect(store.getState().mode).toBe('manual');
    expect(store.getState().suggestedFoot).toBe('B');
  });
});

describe('addManualStitch — Foot B (jumps allowed, ±4.5 mm carriage range, ±3.5 mm needle reach)', () => {
  function manualB(): Project {
    return newProject('A', { idGen, mode: 'manual', suggestedFoot: 'B' });
  }

  it('accepts a needle inside the ±3.5 mm window', () => {
    const p = manualB();
    const next = addManualStitch(p, { kind: 'needle', x: 2, y: 0 });
    expect(next.manualStitches).toHaveLength(1);
    expect(next.manualStitches[0]).toMatchObject({ kind: 'needle', x: 2, y: 0 });
  });

  it('rejects a needle outside the ±3.5 mm window', () => {
    const p = manualB();
    const next = addManualStitch(p, { kind: 'needle', x: 4, y: 0 });
    expect(next.manualStitches).toEqual([]);
  });

  it('accepts a 1 mm jump and advances the carriage', () => {
    // the foot-B reference design is 9 mm wide on Foot B with 2 jumps — the foot is not
    // stationary, the carriage walks within ±4.5 mm.
    const p1 = addManualStitch(manualB(), { kind: 'jump', x: 1, y: 0 });
    expect(p1.manualStitches).toHaveLength(1);
    // Carriage now at 1 mm; a needle at x = 4 is valid (|4 − 1| = 3 ≤ 3.5).
    const p2 = addManualStitch(p1, { kind: 'needle', x: 4, y: 0 });
    expect(p2.manualStitches).toHaveLength(2);
  });

  it('rejects a jump exceeding 1 mm dx (firmware envelope, same as Foot S)', () => {
    const p = manualB();
    const next = addManualStitch(p, { kind: 'jump', x: 1.5, y: 0 });
    expect(next.manualStitches).toEqual([]);
  });

  it('rejects a jump that would push the carriage past ±4.5 mm', () => {
    let p = manualB();
    // Walk the carriage to +4 mm via 4 jumps of 1 mm each.
    for (let i = 0; i < 4; i++) {
      p = addManualStitch(p, { kind: 'jump', x: i + 1, y: 0 });
    }
    expect(p.manualStitches).toHaveLength(4);
    // Next 1 mm jump → 5 mm, beyond ±4.5 → rejected.
    const next = addManualStitch(p, { kind: 'jump', x: 5, y: 0 });
    expect(next.manualStitches).toHaveLength(4);
  });

  it('reports the rejection reason via validateManualStitch', () => {
    const p = manualB();
    expect(validateManualStitch(p, { kind: 'needle', x: 5, y: 0 }).ok).toBe(false);
    expect(validateManualStitch(p, { kind: 'jump', x: 1.5, y: 0 }).ok).toBe(false);
  });
});

describe('addManualStitch — Foot S (jumps move the carriage)', () => {
  function manualS(): Project {
    return newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
  }

  it('accepts a needle inside the ±3.5 mm window of the current carriage X', () => {
    const p = manualS();
    const next = addManualStitch(p, { kind: 'needle', x: 3, y: 0 });
    expect(next.manualStitches).toHaveLength(1);
  });

  it('rejects a needle whose distance from the carriage exceeds 3.5 mm', () => {
    const p = manualS();
    const next = addManualStitch(p, { kind: 'needle', x: 4, y: 0 });
    expect(next.manualStitches).toEqual([]);
  });

  it('accepts a 1 mm jump and advances the carriage', () => {
    const p1 = addManualStitch(manualS(), { kind: 'jump', x: 1, y: 0 });
    expect(p1.manualStitches).toHaveLength(1);
    // Now a needle at x=4 is valid (carriage at 1, |4-1|=3 ≤ 3.5).
    const p2 = addManualStitch(p1, { kind: 'needle', x: 4, y: 0 });
    expect(p2.manualStitches).toHaveLength(2);
  });

  it('rejects a jump exceeding 1 mm dx (firmware envelope)', () => {
    const p = manualS();
    const next = addManualStitch(p, { kind: 'jump', x: 1.5, y: 0 });
    expect(next.manualStitches).toEqual([]);
  });

  it('rejects a jump that would push the carriage past ±27.25 mm', () => {
    let p = manualS();
    // Walk the carriage to +27 mm via 27 jumps of 1 mm each.
    for (let i = 0; i < 27; i++) {
      p = addManualStitch(p, { kind: 'jump', x: i + 1, y: 0 });
    }
    expect(p.manualStitches).toHaveLength(27);
    // Next 1 mm jump → 28 mm, beyond ±27.25 → rejected.
    const next = addManualStitch(p, { kind: 'jump', x: 28, y: 0 });
    expect(next.manualStitches).toHaveLength(27);
  });
});

describe('addManualStitch — y must stay in the hoop', () => {
  it('rejects y < 0', () => {
    const p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const next = addManualStitch(p, { kind: 'needle', x: 0, y: -1 });
    expect(next.manualStitches).toEqual([]);
  });

  it('rejects y > hoop.h', () => {
    const p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const next = addManualStitch(p, { kind: 'needle', x: 0, y: p.hoop.h + 1 });
    expect(next.manualStitches).toEqual([]);
  });
});

describe('addManualStitch — |dy| ≤ 4 mm per record (firmware Y envelope)', () => {
  // Empirical bound from the observed sample files and the verified-good
  // the reference baselines (singleton + multi-element) baselines: short stitches and jumps both cap at
  // |dy| = 48 raw = 4 mm per record. Both stitch kinds move in Y, so a
  // single limit covers both.
  function manualS(): Project {
    return newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
  }

  it('accepts a needle with |dy| = 4 mm (boundary)', () => {
    const p = manualS();
    const next = addManualStitch(p, { kind: 'needle', x: 0, y: 4 });
    expect(next.manualStitches).toHaveLength(1);
  });

  it('rejects a needle with |dy| > 4 mm', () => {
    const p = manualS();
    const next = addManualStitch(p, { kind: 'needle', x: 0, y: 4.5 });
    expect(next.manualStitches).toEqual([]);
  });

  it('rejects a needle stepping back > 4 mm in Y', () => {
    let p = manualS();
    // Walk forward to y = 8 first (two 4 mm steps), then try a > 4 mm step back.
    p = addManualStitch(p, { kind: 'needle', x: 0, y: 4 });
    p = addManualStitch(p, { kind: 'needle', x: 0, y: 8 });
    expect(p.manualStitches).toHaveLength(2);
    const next = addManualStitch(p, { kind: 'needle', x: 0, y: 3.5 });
    expect(next.manualStitches).toHaveLength(2);
  });

  it('accepts a jump with |dy| = 4 mm (boundary)', () => {
    const p = manualS();
    // dx = 0 keeps the X envelope happy so the dy gate is what we are
    // exercising here.
    const next = addManualStitch(p, { kind: 'jump', x: 0, y: 4 });
    expect(next.manualStitches).toHaveLength(1);
    expect(next.manualStitches[0]).toMatchObject({ kind: 'jump', y: 4 });
  });

  it('rejects a jump with |dy| > 4 mm', () => {
    const p = manualS();
    const next = addManualStitch(p, { kind: 'jump', x: 0, y: 4.5 });
    expect(next.manualStitches).toEqual([]);
  });

  it('reports the rejection reason via validateManualStitch', () => {
    const p = manualS();
    const v = validateManualStitch(p, { kind: 'needle', x: 0, y: 4.5 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/4 mm/);
  });
});

describe('removeLastManualStitch / replaceManualStitches', () => {
  it('pops the last stitch off the manualStitches list', () => {
    const p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const p1 = addManualStitch(p, { kind: 'needle', x: 1, y: 0 });
    const p2 = addManualStitch(p1, { kind: 'needle', x: 2, y: 1 });
    expect(p2.manualStitches).toHaveLength(2);
    expect(removeLastManualStitch(p2).manualStitches).toHaveLength(1);
  });

  it('replaceManualStitches overwrites the list verbatim', () => {
    const p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const replaced = replaceManualStitches(p, [
      { kind: 'needle', x: 1, y: 0, dxRaw: 8, dyRaw: 0 },
    ]);
    expect(replaced.manualStitches).toHaveLength(1);
  });
});

describe('addManualSatinSegment: degenerate inputs are rejected', () => {
  // The reducer is the last gate before a satin lands on the project.
  // Geometry that would collapse the cone (zero density, zero spine length,
  // non-positive widths) must be rejected so the encoder and renderer never
  // see a degenerate ConeEdges.
  function manualProject(): Project {
    return newProject('M', { idGen, mode: 'manual', suggestedFoot: 'S' });
  }

  it('rejects density <= 0 (would loop / divide by zero in satinStitches)', () => {
    const p = manualProject();
    const after = addManualSatinSegment(p, {
      x: 0, y: 0, toX: 0, toY: 5,
      widthStart: 2, widthEnd: 2, density: 0,
    });
    expect(after.manualStitches).toHaveLength(0);

    const afterNeg = addManualSatinSegment(p, {
      x: 0, y: 0, toX: 0, toY: 5,
      widthStart: 2, widthEnd: 2, density: -0.5,
    });
    expect(afterNeg.manualStitches).toHaveLength(0);
  });

  it('rejects a zero-length spine (cone collapses to a point)', () => {
    const p = manualProject();
    const after = addManualSatinSegment(p, {
      x: 5, y: 5, toX: 5, toY: 5,
      widthStart: 2, widthEnd: 2, density: 0.6,
    });
    expect(after.manualStitches).toHaveLength(0);
  });
});

describe('updateManualSatin: inspector write path for manual-mode satin', () => {
  // The inspector sliders fire this reducer on every input event during a
  // drag, so it must be idempotent (returning a structurally equal but
  // fresh Project object is fine) and pure on the rest of the project.
  function projectWithSatin(): Project {
    const p = newProject('U', { idGen, mode: 'manual', suggestedFoot: 'S' });
    return addManualSatinSegment(p, {
      x: 0, y: 0, toX: 0, toY: 5,
      widthStart: 2, widthEnd: 2, density: 0.6,
    });
  }

  it('applies widthStart / widthEnd / endAt patches and bumps updatedAt', () => {
    const before = projectWithSatin();
    const t0 = before.updatedAt;
    const after = updateManualSatin(before, 0, { widthStart: 3.5, widthEnd: 4, endAt: 'left' }, t0 + 10);
    const sat = after.manualStitches[0];
    expect(sat?.kind).toBe('satin');
    if (sat?.kind !== 'satin') return;
    expect(sat.widthStart).toBeCloseTo(3.5);
    expect(sat.widthEnd).toBeCloseTo(4);
    expect(sat.endAt).toBe('left');
    expect(after.updatedAt).toBe(t0 + 10);
  });

  it('returns the project unchanged when idx is out of range', () => {
    const before = projectWithSatin();
    const after = updateManualSatin(before, 7, { widthStart: 3 });
    expect(after).toBe(before);
  });

  it('returns the project unchanged when idx points at a non-satin entry', () => {
    const base = newProject('N', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const withNeedle: Project = {
      ...base,
      manualStitches: [{ kind: 'needle', x: 0, y: 1, dxRaw: 0, dyRaw: 12 }],
    };
    const after = updateManualSatin(withNeedle, 0, { widthStart: 3 });
    expect(after).toBe(withNeedle);
  });

  it('leaves spine endpoints untouched (only width / density / endAt are patchable)', () => {
    const before = projectWithSatin();
    const after = updateManualSatin(before, 0, { widthStart: 5 });
    const sat = after.manualStitches[0];
    if (sat?.kind !== 'satin') throw new Error('lost satin kind');
    expect(sat.x).toBe(0);
    expect(sat.y).toBe(0);
    expect(sat.toX).toBe(0);
    expect(sat.toY).toBe(5);
  });
});

describe('migrateProject — older projects predate manual mode', () => {
  it('fills mode="design" and manualStitches=[] when missing', () => {
    const stale = {
      id: 'p',
      name: 'Stale',
      createdAt: 0,
      updatedAt: 0,
      hoop: { halfW: 60, h: 40 },
      xLimit: 'omni54',
      suggestedFoot: 'S',
      threadTension: 4.0,
      points: [{ id: 'a', x: 0, y: 0 }],
      segments: [],
      bg: null,
    } as unknown as Project;
    const migrated = migrateProject(stale);
    expect(migrated.mode).toBe('design');
    expect(migrated.manualStitches).toEqual([]);
  });
});
