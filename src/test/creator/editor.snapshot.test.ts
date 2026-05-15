// Phase 0 characterization: editor SVG snapshot for two fixture projects.
// Same structural signature approach as preview.snapshot.test.ts.

import { describe, it, expect } from 'vitest';
import { renderEditorScene } from '../../ui/creator/editor/render.js';
import { computeView } from '../../ui/creator/editor/view.js';
import { newProject } from '../../creator/project.js';
import type { Point, Project, Segment } from '../../creator/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const newSvg = (): SVGSVGElement =>
  document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

function projectFromPoints(
  name: string,
  pts: { x: number; y: number }[],
  foot: 'B' | 'S',
): Project {
  const points: Point[] = pts.map((p, i) => ({ id: `p${i}`, x: p.x, y: p.y }));
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    segments.push({ id: `s${i}`, from: points[i - 1]!.id, to: points[i]!.id, type: 'straight' });
  }
  return {
    ...newProject(name),
    suggestedFoot: foot,
    points,
    segments,
  };
}

const FOOT_S_FIXTURE = projectFromPoints(
  'Foot S — wide segments',
  [
    { x: 0, y: 0 },
    { x: 12, y: 5 },
    { x: -8, y: 10 },
    { x: 8, y: 15 },
  ],
  'S',
);

const FOOT_B_FIXTURE = projectFromPoints(
  'Foot B — narrow run',
  [
    { x: 0, y: 0 },
    { x: 2, y: 3 },
    { x: -1, y: 6 },
    { x: 1, y: 9 },
  ],
  'B',
);

function summarizeSvg(svg: SVGSVGElement): {
  elementsByTag: Record<string, number>;
  elementsByClass: Record<string, number>;
  pointIds: string[];
  segmentIds: string[];
} {
  const elementsByTag: Record<string, number> = {};
  const elementsByClass: Record<string, number> = {};
  for (const el of Array.from(svg.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    elementsByTag[tag] = (elementsByTag[tag] ?? 0) + 1;
    const cls = el.getAttribute('class');
    if (cls) {
      for (const c of cls.split(/\s+/).filter(Boolean)) {
        elementsByClass[c] = (elementsByClass[c] ?? 0) + 1;
      }
    }
  }
  const pointIds = Array.from(svg.querySelectorAll('[data-point-id]'))
    .map((el) => el.getAttribute('data-point-id') ?? '')
    .sort();
  const segmentIds = Array.from(svg.querySelectorAll('[data-segment-id]'))
    .map((el) => el.getAttribute('data-segment-id') ?? '')
    .sort();
  return { elementsByTag, elementsByClass, pointIds, segmentIds };
}

describe('Phase 0 — editor scene structural snapshot', () => {
  it('Foot S fixture', () => {
    const view = computeView({ w: 600, h: 600 }, FOOT_S_FIXTURE.hoop, 1, { x: 0, y: 0 });
    const svg = newSvg();
    renderEditorScene(svg, FOOT_S_FIXTURE, view, null, null);
    expect(summarizeSvg(svg)).toMatchSnapshot();
  });

  it('Foot B fixture', () => {
    const view = computeView({ w: 600, h: 600 }, FOOT_B_FIXTURE.hoop, 1, { x: 0, y: 0 });
    const svg = newSvg();
    renderEditorScene(svg, FOOT_B_FIXTURE, view, null, null);
    expect(summarizeSvg(svg)).toMatchSnapshot();
  });
});
