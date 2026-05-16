// Parity test: assert that the satin zigzag emitted by the deep module
// matches what every caller renders. If the editor stops calling through
// the shared module, or the stitchPath drop sequence drifts from the
// shared module's stitches, this test breaks loudly.
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { satinStitches, spineToEdges } from '../../shared/satinShape.js';
import { renderEditorScene } from '../../ui/creator/editor/render.js';
import { computeView } from '../../ui/creator/editor/view.js';
import { newProject } from '../../creator/project.js';
import { encodeSegments } from '../../creator/pipeline/encodeSegments.js';
import { foot } from '../../creator/foot.js';
import type { Point, Project, Segment } from '../../creator/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildVerticalSatinProject(): { project: Project; spec: { from: { x: number; y: number }; to: { x: number; y: number }; widthStart: number; widthEnd: number; density: number } } {
  const points: Point[] = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 0, y: 10 },
  ];
  const spec = {
    from: { x: 0, y: 0 },
    to: { x: 0, y: 10 },
    widthStart: 2,
    widthEnd: 2,
    density: 0.5,
  };
  const segments: Segment[] = [{
    id: 's1',
    from: 'a',
    to: 'b',
    type: 'satin',
    widthStart: spec.widthStart,
    widthEnd: spec.widthEnd,
    density: spec.density,
  }];
  const project: Project = { ...newProject('Parity'), points, segments };
  return { project, spec };
}

describe('satin geometry parity (Slice 11)', () => {
  it('editor zigzag <line.satin-stitch> endpoints match the shared module', () => {
    const { project, spec } = buildVerticalSatinProject();
    const expected = satinStitches(spineToEdges(spec), spec.density);

    const view = computeView({ w: 600, h: 600 }, project.hoop, 1, { x: 0, y: 0 });
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    renderEditorScene(svg, project, view, null, null);
    const lines = svg.querySelectorAll('g[data-segment-id="s1"] line.satin-stitch');
    expect(lines.length).toBe(expected.length);

    const undo = (px: number, off: number) => (px - off) / view.zoom;
    for (let i = 0; i < expected.length; i++) {
      const line = lines[i]!;
      const x1 = undo(Number(line.getAttribute('x1')), view.offsetX);
      const y1 = undo(Number(line.getAttribute('y1')), view.offsetY);
      const x2 = undo(Number(line.getAttribute('x2')), view.offsetX);
      const y2 = undo(Number(line.getAttribute('y2')), view.offsetY);
      expect(x1).toBeCloseTo(expected[i]!.start.x, 6);
      expect(y1).toBeCloseTo(expected[i]!.start.y, 6);
      expect(x2).toBeCloseTo(expected[i]!.end.x, 6);
      expect(y2).toBeCloseTo(expected[i]!.end.y, 6);
    }
  });

  it('stitchPath stitches match the shared module\'s satin stitches (chain of start + endpoints)', () => {
    const { project, spec } = buildVerticalSatinProject();
    const expected = satinStitches(spineToEdges(spec), spec.density);

    const seq = encodeSegments(project.points, project.segments, foot('B'));
    // Drop the 'start' marker AND the leading Start Stitch (sourceIndex=-1
    // needle at (0, 0)) so we compare against the satin geometry only.
    const satinSt = seq.filter((s) => s.kind !== 'start' && s.sourceIndex !== -1);
    expect(satinSt.length).toBe(expected.length + 1);
    expect(satinSt[0]!.x).toBeCloseTo(expected[0]!.start.x, 6);
    expect(satinSt[0]!.y).toBeCloseTo(expected[0]!.start.y, 6);
    for (let i = 0; i < expected.length; i++) {
      expect(satinSt[i + 1]!.x).toBeCloseTo(expected[i]!.end.x, 6);
      expect(satinSt[i + 1]!.y).toBeCloseTo(expected[i]!.end.y, 6);
    }
  });
});
