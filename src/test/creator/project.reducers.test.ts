import { describe, it, expect } from 'vitest';
import {
  newProject,
  subdivideSegment,
  movePointPreservingSatinSpines,
  updateSegment,
  setProjectName,
  setThreadTension,
  setBgImage,
  updateBgImage,
  clearBgImage,
  moveBgImage,
  DEFAULT_SATIN_DENSITY_MM,
  DEFAULT_SATIN_WIDTH_MM,
  TENSION_MAX,
  TENSION_MIN,
} from '../../creator/project.js';
import { SH7_MAX_Y_MM } from '../../creator/sh7Limits.js';
import type { BgImage, Project, Segment } from '../../creator/types.js';

const seq = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

const subdivideIds = { pointId: 'pt_mid', segmentAId: 's_A', segmentBId: 's_B' };

function projectWith(points: Project['points'], segments: Project['segments']): Project {
  return { ...newProject('X', { idGen: seq }), points, segments };
}

describe('subdivideSegment', () => {
  it('splits a straight segment at the midpoint and inserts the halves at the original index', () => {
    const project = projectWith(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 8, y: 12 },
        { id: 'c', x: 16, y: 24 },
      ],
      [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
        { id: 's_bc', from: 'b', to: 'c', type: 'straight' },
      ],
    );
    const out = subdivideSegment(project, 's_ab', subdivideIds, 100);
    expect(out.segments).toHaveLength(3);
    expect(out.segments[0]).toMatchObject({ id: 's_A', from: 'a', to: 'pt_mid', type: 'straight' });
    expect(out.segments[1]).toMatchObject({ id: 's_B', from: 'pt_mid', to: 'b', type: 'straight' });
    expect(out.segments[2]).toMatchObject({ id: 's_bc' });
    const mid = out.points.find((p) => p.id === 'pt_mid')!;
    expect(mid.x).toBe(4);
    expect(mid.y).toBe(6);
    expect(out.updatedAt).toBe(100);
  });

  it('splits a satin segment, averaging widthStart and widthEnd at the midpoint', () => {
    const project = projectWith(
      [
        { id: 'top', x: 0, y: 0 },
        { id: 'bot', x: 0, y: 10 },
      ],
      [
        { id: 's_satin', from: 'top', to: 'bot', type: 'satin', widthStart: 2, widthEnd: 6, density: 0.6 },
      ],
    );
    const out = subdivideSegment(project, 's_satin', subdivideIds, 1);
    expect(out.segments).toHaveLength(2);
    const a = out.segments[0]!;
    const b = out.segments[1]!;
    if (a.type !== 'satin' || b.type !== 'satin') throw new Error('expected satin halves');
    expect(a.widthStart).toBe(2);
    expect(a.widthEnd).toBe(4);
    expect(b.widthStart).toBe(4);
    expect(b.widthEnd).toBe(6);
    expect(a.density).toBe(0.6);
    expect(b.density).toBe(0.6);
  });

  it('returns the project unchanged when the segment id is unknown', () => {
    const project = newProject('X', { idGen: seq });
    const out = subdivideSegment(project, 'missing', subdivideIds, 1);
    expect(out).toBe(project);
  });

  it('returns the project unchanged when the segment references missing points', () => {
    const project = projectWith(
      [{ id: 'a', x: 0, y: 0 }],
      [{ id: 's_orphan', from: 'a', to: 'gone', type: 'straight' }],
    );
    const out = subdivideSegment(project, 's_orphan', subdivideIds, 1);
    expect(out).toBe(project);
  });
});

describe('movePointPreservingSatinSpines', () => {
  it('moves a point and clamps Y into the hoop', () => {
    const project = projectWith(
      [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 5, y: 5 }],
      [],
    );
    const out = movePointPreservingSatinSpines(project, 'b', { x: 7, y: -3 }, 1);
    const moved = out.points.find((p) => p.id === 'b')!;
    expect(moved.x).toBe(7);
    expect(moved.y).toBe(0); // clamped from -3
  });

  it('clamps Y to the hoop top when dragged below', () => {
    const project = projectWith(
      [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 5, y: 5 }],
      [],
    );
    const out = movePointPreservingSatinSpines(project, 'b', { x: 7, y: 1000 }, 1);
    const moved = out.points.find((p) => p.id === 'b')!;
    expect(moved.y).toBe(SH7_MAX_Y_MM);
  });

  it('drags the OTHER endpoint of a satin segment so the spine stays vertical', () => {
    // Spine: top=(3, 0) → bot=(3, 10). Drag top to x=8 → bot's X must follow.
    const project = projectWith(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'top', x: 3, y: 0 },
        { id: 'bot', x: 3, y: 10 },
      ],
      [
        { id: 's_satin', from: 'top', to: 'bot', type: 'satin', widthStart: 2, widthEnd: 2, density: 0.6 },
      ],
    );
    const out = movePointPreservingSatinSpines(project, 'top', { x: 8, y: 1 }, 1);
    const top = out.points.find((p) => p.id === 'top')!;
    const bot = out.points.find((p) => p.id === 'bot')!;
    expect(top.x).toBe(8);
    expect(top.y).toBe(1);
    expect(bot.x).toBe(8);
    expect(bot.y).toBe(10); // unchanged
  });

  it('drags both tied endpoints when a point sits on two satin segments', () => {
    // Chain: a → spineA → spineB → spineC (two satins back to back). Dragging
    // spineB in X must drag spineA AND spineC since spineB is tied to both.
    const project = projectWith(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'spineA', x: 5, y: 5 },
        { id: 'spineB', x: 5, y: 10 },
        { id: 'spineC', x: 5, y: 15 },
      ],
      [
        { id: 's1', from: 'spineA', to: 'spineB', type: 'satin', widthStart: 2, widthEnd: 2, density: 0.6 },
        { id: 's2', from: 'spineB', to: 'spineC', type: 'satin', widthStart: 2, widthEnd: 2, density: 0.6 },
      ],
    );
    const out = movePointPreservingSatinSpines(project, 'spineB', { x: 12, y: 10 }, 1);
    expect(out.points.find((p) => p.id === 'spineA')!.x).toBe(12);
    expect(out.points.find((p) => p.id === 'spineB')!.x).toBe(12);
    expect(out.points.find((p) => p.id === 'spineC')!.x).toBe(12);
    // Y on tied endpoints must be unchanged (only spineB's Y can change).
    expect(out.points.find((p) => p.id === 'spineA')!.y).toBe(5);
    expect(out.points.find((p) => p.id === 'spineC')!.y).toBe(15);
  });

  it('does not drag straight-segment neighbours', () => {
    const project = projectWith(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
        { id: 'c', x: 10, y: 10 },
      ],
      [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
        { id: 's_bc', from: 'b', to: 'c', type: 'straight' },
      ],
    );
    const out = movePointPreservingSatinSpines(project, 'b', { x: 8, y: 6 }, 1);
    expect(out.points.find((p) => p.id === 'a')!.x).toBe(0); // unchanged
    expect(out.points.find((p) => p.id === 'c')!.x).toBe(10); // unchanged
  });
});

describe('updateSegment patch semantics', () => {
  // These cover the segment-level merge rules (formerly tested directly
  // against mergeSegmentPatch, now exercised through the public reducer).
  const points: Project['points'] = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 5, y: 5 },
  ];
  const straightProject = (imported = false): Project =>
    projectWith(points, [
      imported
        ? { id: 's', from: 'a', to: 'b', type: 'straight', imported: true }
        : { id: 's', from: 'a', to: 'b', type: 'straight' },
    ]);
  const satinProject = (): Project =>
    projectWith(points, [{
      id: 's', from: 'a', to: 'b', type: 'satin',
      widthStart: 3, widthEnd: 5, density: 0.7,
    }]);

  it('applies a no-op patch as identity-ish (same shape)', () => {
    const p = straightProject();
    const out = updateSegment(p, 's', {}, 1);
    expect(out.segments[0]).toEqual(p.segments[0]);
  });

  it('merges scalar fields without changing type', () => {
    const out = updateSegment(satinProject(), 's', { widthStart: 9 } as Partial<Segment>, 1);
    const seg = out.segments[0]!;
    expect(seg.type).toBe('satin');
    if (seg.type === 'satin') expect(seg.widthStart).toBe(9);
  });

  it('straight → satin fills missing widths and density with the project defaults', () => {
    const out = updateSegment(straightProject(), 's', { type: 'satin' } as Partial<Segment>, 1);
    const seg = out.segments[0]!;
    expect(seg.type).toBe('satin');
    if (seg.type === 'satin') {
      expect(seg.widthStart).toBe(DEFAULT_SATIN_WIDTH_MM);
      expect(seg.widthEnd).toBe(DEFAULT_SATIN_WIDTH_MM);
      expect(seg.density).toBe(DEFAULT_SATIN_DENSITY_MM);
    }
  });

  it('straight → satin uses caller-supplied widths when present', () => {
    const out = updateSegment(straightProject(), 's', {
      type: 'satin', widthStart: 1, widthEnd: 2, density: 0.4,
    } as Partial<Segment>, 1);
    const seg = out.segments[0]!;
    if (seg.type === 'satin') {
      expect(seg.widthStart).toBe(1);
      expect(seg.widthEnd).toBe(2);
      expect(seg.density).toBe(0.4);
    }
  });

  it('satin → straight drops the satin-only fields', () => {
    const out = updateSegment(satinProject(), 's', { type: 'straight' } as Partial<Segment>, 1);
    const seg = out.segments[0]!;
    expect(seg.type).toBe('straight');
    expect((seg as unknown as { widthStart?: number }).widthStart).toBeUndefined();
  });

  it('preserves the imported flag across a type swap', () => {
    const out = updateSegment(straightProject(true), 's', { type: 'satin' } as Partial<Segment>, 1);
    expect(out.segments[0]!.imported).toBe(true);
  });
});

describe('updateSegment', () => {
  it('returns the project unchanged when the segment id is unknown', () => {
    const project = projectWith(
      [{ id: 'a', x: 0, y: 0 }],
      [],
    );
    const out = updateSegment(project, 'missing', { type: 'straight' }, 1);
    expect(out).toBe(project);
  });

  it('updates only the matching segment and bumps updatedAt', () => {
    const project = projectWith(
      [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 5, y: 5 }, { id: 'c', x: 10, y: 10 }],
      [
        { id: 's1', from: 'a', to: 'b', type: 'straight' },
        { id: 's2', from: 'b', to: 'c', type: 'straight' },
      ],
    );
    const out = updateSegment(project, 's2', { type: 'satin' } as Partial<Segment>, 42);
    expect(out.segments[0]!.type).toBe('straight');
    expect(out.segments[1]!.type).toBe('satin');
    expect(out.updatedAt).toBe(42);
  });
});

describe('setProjectName', () => {
  it('updates the name and updatedAt', () => {
    const p = newProject('Old', { idGen: seq });
    const out = setProjectName(p, 'New', 999);
    expect(out.name).toBe('New');
    expect(out.updatedAt).toBe(999);
  });
});

describe('setThreadTension', () => {
  it('clamps below the minimum', () => {
    const p = newProject('X', { idGen: seq });
    const out = setThreadTension(p, TENSION_MIN - 5, 1);
    expect(out.threadTension).toBe(TENSION_MIN);
  });

  it('clamps above the maximum', () => {
    const p = newProject('X', { idGen: seq });
    const out = setThreadTension(p, TENSION_MAX + 5, 1);
    expect(out.threadTension).toBe(TENSION_MAX);
  });

  it('passes a value within range through unchanged', () => {
    const p = newProject('X', { idGen: seq });
    const v = (TENSION_MIN + TENSION_MAX) / 2;
    const out = setThreadTension(p, v, 1);
    expect(out.threadTension).toBe(v);
  });
});

describe('background image reducers', () => {
  const sampleBg: BgImage = {
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    x: 1, y: 2, scale: 1, rotate: 0, opacity: 0.5,
  };

  it('setBgImage replaces the bg field', () => {
    const p = newProject('X', { idGen: seq });
    const out = setBgImage(p, sampleBg, 1);
    expect(out.bg).toEqual(sampleBg);
    expect(out.updatedAt).toBe(1);
  });

  it('updateBgImage applies a partial when bg is set', () => {
    const p = setBgImage(newProject('X', { idGen: seq }), sampleBg, 1);
    const out = updateBgImage(p, { opacity: 0.9, locked: true }, 2);
    expect(out.bg!.opacity).toBe(0.9);
    expect(out.bg!.locked).toBe(true);
    // Unchanged fields preserved.
    expect(out.bg!.x).toBe(1);
    expect(out.bg!.blob).toBe(sampleBg.blob);
  });

  it('updateBgImage is a no-op when no bg is set (returns the same reference)', () => {
    const p = newProject('X', { idGen: seq });
    expect(p.bg).toBeNull();
    const out = updateBgImage(p, { opacity: 0.5 }, 1);
    expect(out).toBe(p);
  });

  it('clearBgImage sets bg to null', () => {
    const p = setBgImage(newProject('X', { idGen: seq }), sampleBg, 1);
    const out = clearBgImage(p, 2);
    expect(out.bg).toBeNull();
    expect(out.updatedAt).toBe(2);
  });

  it('moveBgImage translates x and y when bg is set', () => {
    const p = setBgImage(newProject('X', { idGen: seq }), sampleBg, 1);
    const out = moveBgImage(p, 3, -1, 2);
    expect(out.bg!.x).toBe(4); // 1 + 3
    expect(out.bg!.y).toBe(1); // 2 - 1
    expect(out.updatedAt).toBe(2);
  });

  it('moveBgImage is a no-op when no bg is set', () => {
    const p = newProject('X', { idGen: seq });
    const out = moveBgImage(p, 5, 5, 1);
    expect(out).toBe(p);
  });
});
