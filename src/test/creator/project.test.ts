import { describe, it, expect } from 'vitest';
import {
  newProject,
  migrateProject,
  lockFirstPoint,
  chainEndPointId,
  addPointToProject,
  removeSegment,
  removePoint,
  SAMPLE,
  HOOP_HALF_W,
  HOOP_H,
  DEFAULT_THREAD_TENSION,
} from '../../creator/project.js';
import { SH7_MAX_Y_MM } from '../../creator/sh7Limits.js';
import { DEFAULT_FOOT_ID } from '../../creator/foot.js';
import type { Project } from '../../creator/types.js';

const seq = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

describe('newProject', () => {
  it('produces the expected default shape', () => {
    const p = newProject('Foo', { idGen: seq });
    expect(p.name).toBe('Foo');
    expect(p.hoop).toEqual({ halfW: HOOP_HALF_W, h: HOOP_H });
    expect(p.segments).toEqual([]);
    expect(p.bg).toBeNull();
  });

  it('seeds suggestedFoot and threadTension with the project-wide defaults', () => {
    const p = newProject('Foo', { idGen: seq });
    expect(p.suggestedFoot).toBe(DEFAULT_FOOT_ID);
    expect(p.threadTension).toBe(DEFAULT_THREAD_TENSION);
  });

  it('seeds points with a single start point at (0, 0)', () => {
    const p = newProject('Foo', { idGen: seq });
    expect(p.points.length).toBe(1);
    expect(p.points[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('uses unique IDs across calls when no idGen is provided', () => {
    const a = newProject('A');
    const b = newProject('B');
    expect(a.id).not.toBe(b.id);
  });

  it('accepts a deterministic idGen for tests', () => {
    let n = 0;
    const idGen = () => `${++n}`;
    const p = newProject('Det', { idGen });
    expect(p.id).toBe('p_1');
    expect(p.points[0]?.id).toBe('pt_2');
  });

  it('createdAt and updatedAt are equal at creation', () => {
    const p = newProject('Foo');
    expect(p.createdAt).toBe(p.updatedAt);
  });
});

describe('lockFirstPoint', () => {
  it('syncs points[0] to the canonical Start Stitch (x mirror, y=0)', () => {
    const p: Project = {
      ...newProject('X', { idGen: seq }),
      startStitch: { x: 2 },
      points: [
        { id: 'a', x: 5, y: 10 },
        { id: 'b', x: 7, y: 20 },
      ],
    };
    const out = lockFirstPoint(p);
    expect(out.points[0]?.x).toBe(2); // mirrors startStitch.x
    expect(out.points[0]?.y).toBe(0); // y forced to 0
    expect(out.points[1]).toEqual(p.points[1]); // others unchanged
  });

  it('is a no-op when points[0] already mirrors the Start Stitch', () => {
    const p = newProject('X', { idGen: seq });
    const out = lockFirstPoint(p);
    expect(out.points[0]).toEqual(p.points[0]);
  });

  it('handles empty points safely', () => {
    const p: Project = { ...newProject('X', { idGen: seq }), points: [] };
    expect(() => lockFirstPoint(p)).not.toThrow();
  });
});

describe('migrateProject', () => {
  it('converts a v1-shaped project (hoop.w) to centered hoop with halfW', () => {
    const v1 = {
      id: 'p1',
      name: 'Old',
      createdAt: 1,
      updatedAt: 1,
      hoop: { w: 240, h: 150 } as unknown as { halfW: number; h: number },
      points: [
        { id: 'a', x: 120, y: 0 }, // was the center in v1 coords (w/2)
        { id: 'b', x: 100, y: 30 },
      ],
      segments: [],
      bg: null,
    } as unknown as Project;
    const out = migrateProject(v1);
    expect(out.hoop.halfW).toBe(120);
    // hoop.h gets clamped to the .sh7 file-format limit (was 150 in v1).
    expect(out.hoop.h).toBe(SH7_MAX_Y_MM);
    // After re-centering: x' = x - halfW
    expect(out.points[0]?.x).toBe(0); // 120 - 120 = 0 (already centered)
    expect(out.points[1]?.x).toBe(-20); // 100 - 120
  });

  it('forces first point to X=0 after re-centering', () => {
    const v1 = {
      id: 'p1',
      name: 'Old',
      createdAt: 1,
      updatedAt: 1,
      hoop: { w: 240, h: 150 } as unknown as { halfW: number; h: number },
      points: [
        { id: 'a', x: 50, y: 0 }, // off-center first point
      ],
      segments: [],
      bg: null,
    } as unknown as Project;
    const out = migrateProject(v1);
    expect(out.points[0]?.x).toBe(0);
  });

  it('adds widthStart/widthEnd to satin segments missing them', () => {
    const proj = {
      ...newProject('X', { idGen: seq }),
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'satin', width: 3.2 } as unknown,
      ] as never,
    } as Project;
    const out = migrateProject(proj);
    const s = out.segments[0]!;
    expect(s.type).toBe('satin');
    if (s.type === 'satin') {
      expect(s.widthStart).toBe(3.2);
      expect(s.widthEnd).toBe(3.2);
    }
  });

  it('defaults widthStart/widthEnd to 2.4 when no width info is present', () => {
    const proj = {
      ...newProject('X', { idGen: seq }),
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'satin' } as unknown,
      ] as never,
    } as Project;
    const out = migrateProject(proj);
    const s = out.segments[0]!;
    if (s.type === 'satin') {
      expect(s.widthStart).toBe(2.4);
      expect(s.widthEnd).toBe(2.4);
    }
  });

  it('drops the legacy xLimit field on migrate (X-reach is derived from foot)', () => {
    const proj = { ...newProject('X', { idGen: seq }), xLimit: 'foot7' } as unknown as Project;
    const out = migrateProject(proj);
    expect((out as unknown as { xLimit?: unknown }).xLimit).toBeUndefined();
  });

  it('fills suggestedFoot and threadTension when missing', () => {
    const proj = { ...newProject('X', { idGen: seq }) } as Project;
    delete (proj as { suggestedFoot?: unknown }).suggestedFoot;
    delete (proj as { threadTension?: unknown }).threadTension;
    const out = migrateProject(proj);
    expect(out.suggestedFoot).toBe(DEFAULT_FOOT_ID);
    expect(out.threadTension).toBe(DEFAULT_THREAD_TENSION);
  });

  it('is idempotent (twice returns the same shape as once)', () => {
    const p = SAMPLE({ idGen: seq });
    const once = migrateProject(p);
    const twice = migrateProject(once);
    expect(twice).toEqual(once);
  });

  it('converts old-format imported satins (from at TL corner, to at BR corner) into the detour chain', () => {
    // Pre-fix sh7BinaryImport stored the satin\'s from at the binary cone\'s
    // TL corner and to at BR — making the spine rendered as the TL→BR diagonal.
    // The migration should add detour straights and reposition from/to onto
    // the spine center so the rendered cone is axis-aligned.
    const proj: Project = {
      ...newProject('Stale', { idGen: seq }),
      points: [
        { id: 'p_tl', x: -1, y: 0 },         // chain enters at TL corner
        { id: 'p_br', x: 1, y: 10 },          // chain exits at BR corner
        { id: 'p_next', x: 5, y: 12 },
      ],
      segments: [
        // Old-format satin: from=TL, to=BR. widthStart=2, widthEnd=2.
        // |from.x - to.x| = 2 ≈ (widthStart + widthEnd)/2 = 2 → detected as old.
        {
          id: 's_old', from: 'p_tl', to: 'p_br',
          type: 'satin', widthStart: 2, widthEnd: 2, density: 0.6,
          imported: true,
        },
        { id: 's_after', from: 'p_br', to: 'p_next', type: 'straight', imported: true },
      ],
    };
    const out = migrateProject(proj);
    const satinSegs = out.segments.filter((s) => s.type === 'satin');
    expect(satinSegs).toHaveLength(1);
    const satin = satinSegs[0]!;
    if (satin.type !== 'satin') throw new Error('expected satin');
    const byId = new Map(out.points.map((p) => [p.id, p]));
    const a = byId.get(satin.from)!;
    const b = byId.get(satin.to)!;
    // After migration: from/to should sit on the (vertical) spine.
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.01);
    // Spine top y should match the original TL.y; spine bot y the original BR.y.
    expect(a.y).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(10, 6);
    // Chain still passes through the original TL and BR corners via detour
    // straights flanking the satin.
    const idxSatin = out.segments.findIndex((s) => s.id === 's_old');
    const detourIn = out.segments[idxSatin - 1]!;
    const detourOut = out.segments[idxSatin + 1]!;
    expect(detourIn.type).toBe('straight');
    expect(detourIn.from).toBe('p_tl');
    expect(detourIn.to).toBe(satin.from);
    expect(detourOut.type).toBe('straight');
    expect(detourOut.from).toBe(satin.to);
    expect(detourOut.to).toBe('p_br');
  });

  it('leaves new-format imported satins (from/to on spine) unchanged', () => {
    const proj: Project = {
      ...newProject('Fresh', { idGen: seq }),
      points: [
        { id: 'p_tl', x: -1, y: 0 },
        { id: 'p_top', x: 0, y: 0 },
        { id: 'p_bot', x: 0, y: 10 },
        { id: 'p_br', x: 1, y: 10 },
      ],
      segments: [
        { id: 's_in', from: 'p_tl', to: 'p_top', type: 'straight', imported: true },
        {
          id: 's_satin', from: 'p_top', to: 'p_bot',
          type: 'satin', widthStart: 2, widthEnd: 2, density: 0.6,
          imported: true,
        },
        { id: 's_out', from: 'p_bot', to: 'p_br', type: 'straight', imported: true },
      ],
    };
    const out = migrateProject(proj);
    expect(out.segments).toHaveLength(3);
    expect(out.segments[1]!.type).toBe('satin');
    expect(out.segments[1]!.from).toBe('p_top');
    expect(out.segments[1]!.to).toBe('p_bot');
  });

  it('leaves user-created (non-imported) satins unchanged', () => {
    const proj: Project = {
      ...newProject('User', { idGen: seq }),
      points: [
        { id: 'p_a', x: 0, y: 0 },
        { id: 'p_b', x: 5, y: 10 }, // user clicked these, geometry isn't a corner
      ],
      segments: [
        // No imported flag. User-created satin where from/to span any X.
        { id: 's_user', from: 'p_a', to: 'p_b', type: 'satin', widthStart: 2, widthEnd: 2, density: 0.6 },
      ],
    };
    const out = migrateProject(proj);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.from).toBe('p_a');
    expect(out.segments[0]!.to).toBe('p_b');
  });
});

describe('chainEndPointId', () => {
  it('returns null when there are no points', () => {
    const p: Project = { ...newProject('X', { idGen: seq }), points: [] };
    expect(chainEndPointId(p)).toBeNull();
  });

  it('returns the only point id when there are no segments yet', () => {
    const p = newProject('X', { idGen: seq });
    expect(chainEndPointId(p)).toBe(p.points[0]!.id);
  });

  it('returns the to-endpoint of the last segment', () => {
    const p: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 0, y: 10 },
        { id: 'c', x: 5, y: 20 },
      ],
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'straight' },
        { id: 's2', from: 'b', to: 'c', type: 'straight' },
      ],
    };
    expect(chainEndPointId(p)).toBe('c');
  });

  it('ignores orphan points appended after a split — chain end stays at the last segment.to', () => {
    // Post-subdivide of a→b: points = [a, b, c, mid], segments = [a→mid, mid→b, b→c]
    const p: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 0, y: 10 },
        { id: 'c', x: 5, y: 20 },
        { id: 'mid', x: 0, y: 5 },
      ],
      segments: [
        { id: 's1a', from: 'a', to: 'mid', type: 'straight' },
        { id: 's1b', from: 'mid', to: 'b', type: 'straight' },
        { id: 's2', from: 'b', to: 'c', type: 'straight' },
      ],
    };
    // Even though 'mid' is the last entry in points[], the chain end is 'c'.
    expect(chainEndPointId(p)).toBe('c');
  });
});

describe('addPointToProject', () => {
  const ids = { pointId: 'newPt', segmentId: 'newSeg' };

  it('with no segments, the first call adds a point only and creates no segment', () => {
    // Fresh project has one point at (0,0); a click adds the second point and the FIRST segment.
    // To exercise the "no points yet" branch we need an empty-points project.
    const empty: Project = { ...newProject('X', { idGen: seq }), points: [] };
    const out = addPointToProject(empty, { x: 4, y: 8 }, 'straight', ids, 1);
    expect(out.points).toHaveLength(1);
    expect(out.segments).toHaveLength(0);
    expect(out.points[0]).toMatchObject({ id: 'newPt', x: 4, y: 8 });
  });

  it('with one point and no segments, the next click creates a straight segment from that point', () => {
    const fresh = newProject('X', { idGen: seq });
    const startId = fresh.points[0]!.id;
    const out = addPointToProject(fresh, { x: 3, y: 7 }, 'straight', ids, 1);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]).toMatchObject({ id: 'newSeg', from: startId, to: 'newPt', type: 'straight' });
  });

  it('after subdividing a MIDDLE segment, adding a new straight chains from the original chain end (not from the midpoint)', () => {
    // Pre-subdivide: a→b→c. Subdivide a→b (midpoint appended to points).
    // Post: points = [a, b, c, mid], segments = [a→mid, mid→b, b→c]. Chain end is c.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 0, y: 10 },
        { id: 'c', x: 5, y: 20 },
        { id: 'mid', x: 0, y: 5 },
      ],
      segments: [
        { id: 's1a', from: 'a', to: 'mid', type: 'straight' },
        { id: 's1b', from: 'mid', to: 'b', type: 'straight' },
        { id: 's2', from: 'b', to: 'c', type: 'straight' },
      ],
    };
    const out = addPointToProject(project, { x: 10, y: 30 }, 'straight', ids, 1);
    expect(out.segments).toHaveLength(4);
    const newSeg = out.segments[3]!;
    expect(newSeg.from).toBe('c'); // NOT 'mid'
    expect(newSeg.to).toBe('newPt');
    expect(newSeg.type).toBe('straight');
  });

  it('after subdividing the LAST segment, adding a new point chains from the new tail (the original "to" point)', () => {
    // Pre: a→b→c. Subdivide b→c. Post: points = [a, b, c, mid], segments = [a→b, b→mid, mid→c].
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 0, y: 10 },
        { id: 'c', x: 5, y: 20 },
        { id: 'mid', x: 2.5, y: 15 },
      ],
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'straight' },
        { id: 's2a', from: 'b', to: 'mid', type: 'straight' },
        { id: 's2b', from: 'mid', to: 'c', type: 'straight' },
      ],
    };
    const out = addPointToProject(project, { x: 10, y: 30 }, 'straight', ids, 1);
    expect(out.segments).toHaveLength(4);
    expect(out.segments[3]!.from).toBe('c');
  });

  it('satin clicks inherit the chain end X (vertical spine) and force Y forward', () => {
    // Chain end at x=12,y=20. Click at (5, 18) — Y is BEFORE chain end, so y is clamped to last.y + 1 = 21.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 12, y: 20 },
      ],
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'straight' },
      ],
    };
    const out = addPointToProject(project, { x: 5, y: 18 }, 'satin', ids, 1);
    const newPt = out.points.find((p) => p.id === 'newPt')!;
    expect(newPt.x).toBe(12);   // inherits chain-end X
    expect(newPt.y).toBe(21);   // clamped to last.y + 1
    expect(out.segments[1]!.type).toBe('satin');
    expect(out.segments[1]!.from).toBe('b');
  });

  it('updatedAt is set to the supplied now', () => {
    const fresh = newProject('X', { idGen: seq });
    const out = addPointToProject(fresh, { x: 1, y: 1 }, 'straight', ids, 12345);
    expect(out.updatedAt).toBe(12345);
  });
});

describe('removeSegment', () => {
  it('removing the only segment leaves segments empty, prunes its to point, and keeps the anchor', () => {
    // Fresh project: anchor at (0,0). Add one stitch → one segment, two points.
    const fresh = newProject('X', { idGen: seq });
    const anchorId = fresh.points[0]!.id;
    const built = addPointToProject(
      fresh,
      { x: 5, y: 10 },
      'straight',
      { pointId: 'pt_user', segmentId: 's_user' },
      1,
    );
    expect(built.segments).toHaveLength(1);
    expect(built.points).toHaveLength(2);

    const out = removeSegment(built, 's_user', 2);

    expect(out.segments).toEqual([]);
    expect(out.points).toHaveLength(1);
    expect(out.points[0]?.id).toBe(anchorId);
    expect(out.points[0]?.x).toBe(0);
  });

  it('removing a middle segment re-links the next segment from the removed segment\'s from', () => {
    // Chain a→b→c→d. Remove s_bc. Expect s_cd's from to point at b.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
        { id: 'c', x: 10, y: 10 },
        { id: 'd', x: 15, y: 15 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
        { id: 's_bc', from: 'b', to: 'c', type: 'straight' },
        { id: 's_cd', from: 'c', to: 'd', type: 'straight' },
      ],
    };
    const out = removeSegment(project, 's_bc', 1);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ id: 's_ab', from: 'a', to: 'b' });
    expect(out.segments[1]).toMatchObject({ id: 's_cd', from: 'b', to: 'd' });
  });

  it('prunes the orphaned to-point when no remaining segment references it', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
        { id: 'c', x: 10, y: 10 },
        { id: 'd', x: 15, y: 15 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
        { id: 's_bc', from: 'b', to: 'c', type: 'straight' },
        { id: 's_cd', from: 'c', to: 'd', type: 'straight' },
      ],
    };
    const out = removeSegment(project, 's_bc', 1);
    const ids = out.points.map((p) => p.id);
    expect(ids).not.toContain('c');
    expect(ids).toEqual(['a', 'b', 'd']);
  });

  it('removing the last segment in a multi-segment chain leaves earlier segments untouched', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
        { id: 'c', x: 10, y: 10 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
        { id: 's_bc', from: 'b', to: 'c', type: 'straight' },
      ],
    };
    const out = removeSegment(project, 's_bc', 1);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]).toMatchObject({ id: 's_ab', from: 'a', to: 'b' });
    expect(out.points.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('never prunes the anchor (points[0]), even if it is the removed segment\'s to', () => {
    // Defensive case: a malformed segment whose to-endpoint is the X=0 anchor.
    // Should never happen via the normal "click to add" path, but the reducer
    // must keep the anchor intact regardless.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'anchor', x: 0, y: 0 },
        { id: 'orbit', x: 3, y: 4 },
      ],
      segments: [
        { id: 's_self', from: 'orbit', to: 'anchor', type: 'straight' },
      ],
    };
    const out = removeSegment(project, 's_self', 1);
    expect(out.points.map((p) => p.id)).toContain('anchor');
    expect(out.points[0]?.id).toBe('anchor');
  });

  it('does not prune a to-point that a non-adjacent segment still references', () => {
    // Defensive case for non-linear graphs: the removed segment's to-point is
    // also referenced by a later segment that does NOT chain off it. The
    // re-link logic only rewires the immediately-following segment, so the
    // later reference must keep the point alive.
    //   s1: a→b, s2: b→c, s3: a→c   (s3 references c without chaining)
    //   remove s2 → splice gives [s1, s3]; s3.from = a ≠ removed.to (c),
    //   so no re-link. c is still referenced by s3.to → keep it.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
        { id: 'c', x: 10, y: 10 },
      ],
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'straight' },
        { id: 's2', from: 'b', to: 'c', type: 'straight' },
        { id: 's3', from: 'a', to: 'c', type: 'straight' },
      ],
    };
    const out = removeSegment(project, 's2', 1);
    expect(out.points.map((p) => p.id)).toContain('c');
    expect(out.segments.find((s) => s.id === 's3')?.to).toBe('c');
  });

  it('returns the project reference unchanged when the segment id is unknown', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
      ],
    };
    const out = removeSegment(project, 's_does_not_exist', 999);
    expect(out).toBe(project);
  });

  it('removes a satin segment the same way as a straight (re-link + prune)', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'top', x: 0, y: 5 },
        { id: 'bot', x: 0, y: 15 },
        { id: 'd', x: 5, y: 20 },
      ],
      segments: [
        { id: 's_a_top', from: 'a', to: 'top', type: 'straight' },
        {
          id: 's_satin', from: 'top', to: 'bot',
          type: 'satin', widthStart: 2, widthEnd: 3, density: 0.6,
        },
        { id: 's_bot_d', from: 'bot', to: 'd', type: 'straight' },
      ],
    };
    const out = removeSegment(project, 's_satin', 1);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ id: 's_a_top', from: 'a', to: 'top' });
    expect(out.segments[1]).toMatchObject({ id: 's_bot_d', from: 'top', to: 'd' });
    expect(out.points.map((p) => p.id)).not.toContain('bot');
  });

  it('sets updatedAt to the supplied now on a real delete', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
      ],
      updatedAt: 1,
    };
    const out = removeSegment(project, 's_ab', 12345);
    expect(out.updatedAt).toBe(12345);
  });
});

describe('removePoint', () => {
  it('removing a middle point merges adjacent segments and prunes the point', () => {
    // Chain a→b→c→d. Remove point b. The incoming segment s_ab is removed;
    // s_bc has from=b=removed.to → rewired to from=a → becomes a→c.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
        { id: 'c', x: 10, y: 10 },
        { id: 'd', x: 15, y: 15 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
        { id: 's_bc', from: 'b', to: 'c', type: 'straight' },
        { id: 's_cd', from: 'c', to: 'd', type: 'straight' },
      ],
    };
    const out = removePoint(project, 'b', 1);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ id: 's_bc', from: 'a', to: 'c' });
    expect(out.segments[1]).toMatchObject({ id: 's_cd', from: 'c', to: 'd' });
    expect(out.points.map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });

  it('removing the tail point drops the trailing segment', () => {
    // Chain a→b→c. Remove c. The incoming segment s_bc is removed,
    // no next segment to rewire, c is pruned.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
        { id: 'c', x: 10, y: 10 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
        { id: 's_bc', from: 'b', to: 'c', type: 'straight' },
      ],
    };
    const out = removePoint(project, 'c', 1);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]).toMatchObject({ id: 's_ab', from: 'a', to: 'b' });
    expect(out.points.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('removing the anchor (points[0]) is a no-op', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'anchor', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
      ],
      segments: [
        { id: 's_ab', from: 'anchor', to: 'b', type: 'straight' },
      ],
    };
    const out = removePoint(project, 'anchor', 1);
    expect(out).toBe(project);
  });

  it('returns the project reference unchanged when the point id is unknown', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
      ],
    };
    const out = removePoint(project, 'pt_does_not_exist', 999);
    expect(out).toBe(project);
  });

  it('returns the project unchanged for an orphan point with no incoming segment', () => {
    // Edge: a non-anchor point exists but no segment touches it. The point
    // could only be removed by pruning, which removePoint does not do.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'orphan', x: 5, y: 5 },
      ],
      segments: [],
    };
    const out = removePoint(project, 'orphan', 1);
    expect(out).toBe(project);
  });

  it('removing the only stitch endpoint leaves an empty chain with the anchor preserved', () => {
    const fresh = newProject('X', { idGen: seq });
    const anchorId = fresh.points[0]!.id;
    const built = addPointToProject(
      fresh,
      { x: 5, y: 10 },
      'straight',
      { pointId: 'pt_user', segmentId: 's_user' },
      1,
    );
    const out = removePoint(built, 'pt_user', 2);
    expect(out.segments).toEqual([]);
    expect(out.points).toHaveLength(1);
    expect(out.points[0]?.id).toBe(anchorId);
  });

  it('sets updatedAt to the supplied now on a real delete', () => {
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 5 },
      ],
      segments: [
        { id: 's_ab', from: 'a', to: 'b', type: 'straight' },
      ],
      updatedAt: 1,
    };
    const out = removePoint(project, 'b', 12345);
    expect(out.updatedAt).toBe(12345);
  });

  it('removes a satin spine endpoint the same way (re-link + prune)', () => {
    // Chain: a → top —(satin)→ bot → d. Remove point `top`. The incoming
    // straight segment a→top is removed; the satin's from is rewired to a.
    const project: Project = {
      ...newProject('X', { idGen: seq }),
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'top', x: 0, y: 5 },
        { id: 'bot', x: 0, y: 15 },
        { id: 'd', x: 5, y: 20 },
      ],
      segments: [
        { id: 's_a_top', from: 'a', to: 'top', type: 'straight' },
        {
          id: 's_satin', from: 'top', to: 'bot',
          type: 'satin', widthStart: 2, widthEnd: 3, density: 0.6,
        },
        { id: 's_bot_d', from: 'bot', to: 'd', type: 'straight' },
      ],
    };
    const out = removePoint(project, 'top', 1);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ id: 's_satin', from: 'a', to: 'bot', type: 'satin' });
    expect(out.segments[1]).toMatchObject({ id: 's_bot_d', from: 'bot', to: 'd' });
    expect(out.points.map((p) => p.id)).not.toContain('top');
  });
});

describe('SAMPLE', () => {
  it('produces a project with at least 5 points and matching segments', () => {
    const p = SAMPLE();
    expect(p.points.length).toBeGreaterThanOrEqual(5);
    expect(p.segments.length).toBe(p.points.length - 1);
    expect(p.points[0]?.x).toBe(0);
  });

  it('has at least one satin segment so the satin path is exercised', () => {
    const p = SAMPLE();
    const hasSatin = p.segments.some((s) => s.type === 'satin');
    expect(hasSatin).toBe(true);
  });
});
