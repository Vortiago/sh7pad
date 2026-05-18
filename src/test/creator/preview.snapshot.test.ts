// @vitest-environment jsdom
// Phase 0 characterization: preview SVG snapshot for two fixture projects.
//
// Locks the rendered preview output for a Foot S project (with carriage
// moves) and a Foot B project (single-record shorts/jumps), so the
// pipeline refactor can't silently regress the visual output.
//
// We snapshot a structural summary (element counts by class + key
// attributes) instead of the full outerHTML — full HTML is too noisy
// for diffs and the structural signature catches every meaningful
// pipeline change.

import { describe, it, expect } from 'vitest';
import { renderPreviewScene } from '../../ui/creator/preview/render.js';
import { newProject } from '../../creator/project.js';
import type { Point, Project, Segment } from '../../creator/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const newSvg = (): SVGSVGElement =>
  document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

const CONTAINER = { containerW: 600, containerH: 400 };

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
  'Foot S — wide segments forcing carriage moves',
  [
    { x: 0, y: 0 },
    { x: 12, y: 5 }, // > slot width → planner will emit jumps
    { x: -8, y: 10 },
    { x: 8, y: 15 },
  ],
  'S',
);

const FOOT_B_FIXTURE = projectFromPoints(
  'Foot B — narrow run, all shorts',
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
  rootViewBox: string | null;
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
  return {
    elementsByTag,
    elementsByClass,
    rootViewBox: svg.getAttribute('viewBox'),
  };
}

describe('Phase 0 — preview scene structural snapshot', () => {
  it('Foot S fixture at step=last', () => {
    const svg = newSvg();
    renderPreviewScene(svg, FOOT_S_FIXTURE, 9999, CONTAINER);
    expect(summarizeSvg(svg)).toMatchSnapshot();
  });

  it('Foot B fixture at step=last', () => {
    const svg = newSvg();
    renderPreviewScene(svg, FOOT_B_FIXTURE, 9999, CONTAINER);
    expect(summarizeSvg(svg)).toMatchSnapshot();
  });

  it('Foot S fixture at step=0 (initial state)', () => {
    const svg = newSvg();
    renderPreviewScene(svg, FOOT_S_FIXTURE, 0, CONTAINER);
    expect(summarizeSvg(svg)).toMatchSnapshot();
  });
});
