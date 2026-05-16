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

  it('returns start + Start Stitch + N stitches for a manual project with N stitches', () => {
    let p = newProject('A', { idGen, mode: 'manual', suggestedFoot: 'S' });
    p = addManualStitch(p, { kind: 'needle', x: 1, y: 0 });
    p = addManualStitch(p, { kind: 'needle', x: 2, y: 1 });
    const seq = sequenceFromProject(p);
    expect(seq).toHaveLength(4);
    expect(seq[0]).toMatchObject({ kind: 'start', x: 0, y: 0 });
    expect(seq[1]).toMatchObject({ kind: 'needle', x: 0, y: 0 }); // Start Stitch
    expect(seq[2]).toMatchObject({ kind: 'needle', x: 1, y: 0 });
    expect(seq[3]).toMatchObject({ kind: 'needle', x: 2, y: 1 });
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
    // seq = [start, Start Stitch needle (dx=0), user-needle (dx=8)]
    const s = seq[2]!;
    if (s.kind !== 'start') {
      expect(s.dxRaw).toBe(8); // 1 mm × 8 raw/mm
      expect(s.dyRaw).toBe(0);
    }
  });

  it('design mode: the start marker sits at startStitch.x (no phantom 0,0 vertex before the leading needle)', () => {
    // The preview's pathOf walks every Stitch in sequence order, drawing
    // a polyline between consecutive vertices. Anchoring the leading
    // 'start' marker at (0, 0) when startStitch.x ≠ 0 produces a visible
    // phantom segment from (0,0) to the Start Stitch in the preview;
    // user-reported bug. The encoder still emits the leading needle's
    // dxRaw = round(startStitch.x × 8) for byte fidelity — only the
    // marker's (x, y) needs to coincide with the first needle drop.
    const a = { id: 'a', x: 0, y: 0 };
    const b = { id: 'b', x: 5, y: 5 };
    const base = newProject('Design', { idGen, mode: 'design', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      points: [a, b],
      segments: [{ id: 's', from: a.id, to: b.id, type: 'straight' }],
      startStitch: { x: 2 },
    };
    const seq = sequenceFromProject(project);
    const start = seq[0]!;
    expect(start.kind).toBe('start');
    expect(start.x).toBeCloseTo(2, 6);
    expect(start.y).toBe(0);
    // The first machine record (the leading needle) still encodes dx=16 so
    // the .sh7 byte stream is unchanged.
    const leadingNeedle = seq[1]!;
    expect(leadingNeedle.kind).toBe('needle');
    if (leadingNeedle.kind === 'needle') {
      expect(leadingNeedle.dxRaw).toBe(16);
    }
  });

  it('manual mode (empty project): the start marker sits at startStitch.x so the jump live window centres there', () => {
    // Same fix on the manual branch: with no user stitches placed the
    // sequence is just [start]. The trackFoot frame derived from this
    // sequence is the only signal currentManualFrame has for "where will
    // the next click land?" — anchoring the marker on startStitch.x makes
    // the jump live window centre on the Start Stitch, not on origin.
    const base = newProject('Manual', { idGen, mode: 'manual', suggestedFoot: 'S' });
    const project: Project = { ...base, startStitch: { x: 2 } };
    const seq = sequenceFromProject(project);
    expect(seq).toHaveLength(1);
    const start = seq[0]!;
    expect(start.kind).toBe('start');
    expect(start.x).toBeCloseTo(2, 6);
    expect(start.y).toBe(0);
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
    // Both include the Start Stitch leading needle (1 record); compact
    // adds 1 user needle, uniform adds 3.
    const needleCompact = seqCompact.filter((s) => s.kind === 'needle').length;
    const needleUniform = seqUniform.filter((s) => s.kind === 'needle').length;
    expect(needleCompact).toBe(2); // Start Stitch + 1 user
    expect(needleUniform).toBeGreaterThan(needleCompact);
  });
});
