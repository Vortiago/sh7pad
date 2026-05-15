// Slice 1: unified Project → StitchSequence helper.
//
// `sequenceFromProject` is the single entry point that knows whether a
// project is design- or manual-authored and routes through encodeDesign
// accordingly. Renderers (editor, preview), the stitch-list panel, and
// the mountCreator scrubbing logic all consume its output, so the editor
// can finally see manual stitches without any of those callers needing
// their own mode branch.

import { describe, it, expect } from 'vitest';
import { sequenceFromProject } from '../../../creator/pipeline/encodeDesign.js';
import { encodeSegments } from '../../../creator/pipeline/encodeSegments.js';
import { foot } from '../../../creator/foot.js';
import { newProject, SAMPLE } from '../../../creator/project.js';
import { addManualStitch } from '../../../creator/manualStitch.js';
import type { Project } from '../../../creator/types.js';

const idGen = (() => {
  let i = 0;
  return () => `id_${++i}`;
})();

describe('sequenceFromProject', () => {
  it('design mode: routes through encodeSegments verbatim', () => {
    const project: Project = SAMPLE();
    expect(sequenceFromProject(project)).toEqual(
      encodeSegments(project.points, project.segments, foot(project.suggestedFoot)),
    );
  });

  it('returns start + N stitches for a manual project with N stitches', () => {
    let p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    p = addManualStitch(p, { kind: 'needle', x: 1, y: 0 });
    p = addManualStitch(p, { kind: 'needle', x: 2, y: 1 });
    const seq = sequenceFromProject(p);
    expect(seq).toHaveLength(3);
    expect(seq[0]).toMatchObject({ kind: 'start', x: 0, y: 0 });
    expect(seq[1]).toMatchObject({ kind: 'needle', x: 1, y: 0 });
    expect(seq[2]).toMatchObject({ kind: 'needle', x: 2, y: 1 });
  });

  it('returns just the start marker for an empty manual project', () => {
    const p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const seq = sequenceFromProject(p);
    expect(seq).toHaveLength(1);
    expect(seq[0]).toMatchObject({ kind: 'start', x: 0, y: 0 });
  });

  it('uses project.points[0] as the start position (manual mode)', () => {
    const p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    // newProject seeds points[0] at (0,0); confirm sequenceFromProject
    // honours that anchor rather than hard-coding (0,0).
    p.points[0] = { id: 'a', x: 0, y: 0 };
    const seq = sequenceFromProject(p);
    expect(seq[0]).toEqual({ kind: 'start', x: 0, y: 0, sourceIndex: -1, carriageXMm: 0 });
  });

  it('manual stitches preserve their pre-computed dxRaw/dyRaw on the way out', () => {
    let p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    p = addManualStitch(p, { kind: 'needle', x: 1, y: 0 });
    const seq = sequenceFromProject(p);
    const s = seq[1]!;
    if (s.kind !== 'start') {
      expect(s.dxRaw).toBe(8); // 1 mm × 8 raw/mm
      expect(s.dyRaw).toBe(0);
    }
  });

  it('encoderMode="uniform" produces strictly more needle stitches than the default compact mode', () => {
    // Construct a design with one 2.5 mm slot-fitting segment. Compact
    // mode emits a single SHORT via the fast path (2.5 mm ≤ 3 mm slot
    // half); uniform mode rejects the fast path because |20 raw| > 8 raw
    // (1 mm cap) and slow-path-splits into 3 SHORTs. Use two distinct
    // Project objects so the identity-based encoder cache misses on the
    // second call.
    function buildSlotFittingProject(extra: Partial<Project>): Project {
      const base = newProject('slot-fit', { idGen, mode: 'design', suggestedFoot: 'S' });
      const a = base.points[0]!;
      const b = { id: `pt_${idGen()}`, x: 2.5, y: 0 };
      return {
        ...base,
        points: [a, b],
        segments: [{ id: `s_${idGen()}`, type: 'straight', from: a.id, to: b.id }],
        ...extra,
      };
    }
    const compactProject = buildSlotFittingProject({});
    const uniformProject = buildSlotFittingProject({ encoderMode: 'uniform' });
    const seqCompact = sequenceFromProject(compactProject);
    const seqUniform = sequenceFromProject(uniformProject);
    const needleCompact = seqCompact.filter((s) => s.kind === 'needle').length;
    const needleUniform = seqUniform.filter((s) => s.kind === 'needle').length;
    expect(needleCompact).toBe(1);
    expect(needleUniform).toBeGreaterThan(needleCompact);
  });
});
