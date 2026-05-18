// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderPreviewScene } from '../../ui/creator/preview/render.js';
import { DEFAULT_BG_COLOR, DEFAULT_THREAD_COLOR } from '../../ui/creator/preview/constants.js';
import { newProject, SAMPLE } from '../../creator/project.js';
import { NEEDLE_SLOT_HALF_MM, NEEDLE_SLOT_WIDTH_MM } from '../../creator/foot.js';
import type { Project, Segment } from '../../creator/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const newSvg = (): SVGSVGElement =>
  document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

const CONTAINER = { containerW: 600, containerH: 400 };

// Build a two-point project: anchor at (0,0) → end at (endX, endY) via
// a single straight segment. Lets us reason about firstDrop vs lastDrop
// directly from the inputs.
function driftProject(endX: number, endY: number): Project {
  const proj = newProject('drift');
  const anchorId = proj.points[0]!.id;
  const endId = 'pt_end';
  const segId = 's_drift';
  const seg: Segment = { id: segId, from: anchorId, to: endId, type: 'straight' };
  return {
    ...proj,
    points: [...proj.points, { id: endId, x: endX, y: endY }],
    segments: [seg],
  };
}

function parseTranslate(transform: string | null): { x: number; y: number } {
  if (!transform) throw new Error('no transform');
  const m = /translate\(([-\d.eE+]+)[\s,]+([-\d.eE+]+)\)/.exec(transform);
  if (!m) throw new Error(`unparseable transform: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

// Pull the (x,y) vertices from an SVG path "M a b L c d L e f ...".
function parsePathPoints(d: string): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const tokens = d.replace(/[ML]/g, ' ').trim().split(/\s+/);
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    pts.push({ x: Number(tokens[i]), y: Number(tokens[i + 1]) });
  }
  return pts;
}

describe('renderPreviewScene', () => {
  it('always renders the X=0 axis line', () => {
    const project = newProject('X');
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER);
    expect(svg.querySelector('line.x-axis')).not.toBeNull();
  });

  it('renders an empty-state group when there are no drops', () => {
    const project = newProject('X'); // single point, no segments
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER);
    expect(svg.querySelector('g.pv-empty')).not.toBeNull();
  });

  it('always renders the realistic thread (no schematic/needle artifacts)', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER);
    expect(svg.querySelector('path.real-thread')).not.toBeNull();
    // Old non-realistic artifacts must NOT be rendered.
    expect(svg.querySelector('path.thread-path')).toBeNull();
    expect(svg.querySelector('circle.drop')).toBeNull();
    expect(svg.querySelector('path.ghost-path')).toBeNull();
  });

  it('paints Foot S jump segments as a separate path so CSS can dash them', () => {
    // The jump overlay is the same element class everywhere it appears
    // (active motif, history, repeats); CSS gives it `stroke-dasharray`
    // so it reads as dashed against the user's chosen thread color, not
    // a different color. We just verify the selector exists with a
    // non-empty `d` here; the dashing is asserted in CSS-rule tests.
    const proj = newProject('jumps');
    const anchor = proj.points[0]!.id;
    const seg: Segment = { id: 's1', from: anchor, to: 'pt_end', type: 'straight' };
    const project: Project = {
      ...proj,
      suggestedFoot: 'S',
      points: [...proj.points, { id: 'pt_end', x: 12, y: 0 }],
      segments: [seg],
    };
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const jumpPath = svg.querySelector('g.realistic-thread path.real-thread-jump');
    expect(jumpPath).not.toBeNull();
    expect(jumpPath!.getAttribute('d') ?? '').not.toBe('');
  });

  it('does NOT render a jump overlay for in-slot projects (no jump records emitted)', () => {
    // A 2 mm-wide design fits inside the foot's slot half (NEEDLE_SLOT_HALF_MM),
    // so the unified planner emits a single needle record with no jumps. The
    // jump overlay path therefore isn't drawn for this project.
    const proj = newProject('inSlot');
    const anchor = proj.points[0]!.id;
    const project: Project = {
      ...proj,
      suggestedFoot: 'B',
      points: [...proj.points, { id: 'pt_end', x: 2, y: 0 }],
      segments: [{ id: 's1', from: anchor, to: 'pt_end', type: 'straight' }],
    };
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    expect(svg.querySelector('g.realistic-thread path.real-thread-jump')).toBeNull();
  });

  it('renders a translucent glass foot for Foot S that walks with each jump step', () => {
    // Glass foot: a translucent body that follows the carriage X and the
    // current needle Y. The inner eye (slot) has its own visible edge so
    // the user can see exactly where the needle window is inside the
    // body. A 12 mm rightward bust splits into 1 Phase-A short reaching
    // the slot edge (cursor 0 → NEEDLE_SLOT_HALF_MM, carriage planted at
    // 0) followed by walking jumps that carry the carriage the remaining
    // (12 − NEEDLE_SLOT_HALF_MM) mm. So the body shifts right by
    // (12 − NEEDLE_SLOT_HALF_MM) mm × zoom between the post-Phase-A
    // frame and the final frame.
    const SEG_LEN_MM = 12;
    const proj = newProject('walk');
    const anchor = proj.points[0]!.id;
    const project: Project = {
      ...proj,
      suggestedFoot: 'S',
      points: [...proj.points, { id: 'pt_end', x: SEG_LEN_MM, y: 0 }],
      segments: [{ id: 's1', from: anchor, to: 'pt_end', type: 'straight' }],
    };

    const a = newSvg();
    renderPreviewScene(a, project, 1, CONTAINER, 1);
    const footA = a.querySelector<SVGGElement>('g.presser-foot');
    expect(footA).not.toBeNull();
    const bodyA = footA!.querySelector<SVGRectElement>('rect.foot-body')!;
    const slotA = footA!.querySelector<SVGRectElement>('rect.foot-slot')!;
    expect(bodyA).not.toBeNull();
    expect(slotA).not.toBeNull();
    const xA = Number(bodyA.getAttribute('x'));
    const wBody = Number(bodyA.getAttribute('width'));
    const wSlot = Number(slotA.getAttribute('width'));

    // Body is wider than the slot — the slot is the inner eye.
    expect(wBody).toBeGreaterThan(wSlot);

    const b = newSvg();
    // Step counter: 1 = Start Stitch (no-op needle drop). 2 = Phase A.
    // 3..N = Phase B walks. Stepping to 12 covers the full sequence
    // (Start Stitch + Phase A + 9 walks ≈ 11 records + safety margin).
    renderPreviewScene(b, project, 12, CONTAINER, 1);
    const xB = Number(
      b.querySelector<SVGRectElement>('g.presser-foot rect.foot-body')!.getAttribute('x'),
    );

    // Deduce zoom from the rendered slot width and the slot constant.
    const zoom = wSlot / NEEDLE_SLOT_WIDTH_MM;
    const expectedCarriageWalkMm = SEG_LEN_MM - NEEDLE_SLOT_HALF_MM;
    expect(xB - xA).toBeCloseTo(expectedCarriageWalkMm * zoom, 4);
  });

  it("Foot B's foot-slot Y tracks the visible needle stitch (not the start)", () => {
    // Parallel to the Foot S alignment test below: at every step, the
    // foot-slot's vertical centre MUST equal the needle marker's screen Y.
    // Foot B previously anchored the foot at view.startY (the first stitch
    // Y) and stayed there as the needle marched downward — that's the
    // "different behaviour" we're unifying.
    //
    // Foot B has no side-motion, so the fixture only needs Y stepping at
    // X=0 to drive the needle marker through several rows.
    const proj = newProject('foot-b-y-tracking');
    const points = [
      { id: 'p0', x: 0, y: 0 },
      { id: 'p1', x: 0, y: 3 },
      { id: 'p2', x: 0, y: 8 },
      { id: 'p3', x: 0, y: 15 },
      { id: 'p4', x: 0, y: 22 },
    ];
    const segments: Segment[] = [
      { id: 's1', from: 'p0', to: 'p1', type: 'straight' },
      { id: 's2', from: 'p1', to: 'p2', type: 'straight' },
      { id: 's3', from: 'p2', to: 'p3', type: 'straight' },
      { id: 's4', from: 'p3', to: 'p4', type: 'straight' },
    ];
    const project: Project = { ...proj, suggestedFoot: 'B', points, segments };

    for (let step = 1; step <= 20; step++) {
      const svg = newSvg();
      renderPreviewScene(svg, project, step, CONTAINER, 1);
      const dot = svg.querySelector('g.needle-marker circle.needle-dot');
      if (!dot) break;
      const needleY = Number(dot.getAttribute('cy'));
      const slotEl = svg.querySelector<SVGRectElement>('g.presser-foot rect.foot-slot');
      if (!slotEl) continue;
      const slotCy =
        Number(slotEl.getAttribute('y')) + Number(slotEl.getAttribute('height')) / 2;
      expect(
        slotCy,
        `step ${step}: slot cy=${slotCy}, needle cy=${needleY}`,
      ).toBeCloseTo(needleY, 1);
    }
  });

  it('Foot B renders the same needle window as Foot S', () => {
    // Both feet have the same mechanical needle window
    // (foot.ts: every Foot has needleSlotHalfMm = NEEDLE_SLOT_HALF_MM).
    // The preview's foot-slot (the visible "eye" inside the foot body)
    // must match that for both. Use an in-reach 4 mm Foot B project;
    // SAMPLE's 15 mm sweeps would refuse under Foot B's ±4.5 mm reach.
    const proj = newProject('footB');
    const anchor = proj.points[0]!.id;
    const project: Project = {
      ...proj,
      suggestedFoot: 'B',
      points: [...proj.points, { id: 'pt_end', x: 4, y: 0 }],
      segments: [{ id: 's1', from: anchor, to: 'pt_end', type: 'straight' }],
    };
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER, 1);
    const body = svg.querySelector<SVGRectElement>('g.presser-foot rect.foot-body')!;
    const slot = svg.querySelector<SVGRectElement>('g.presser-foot rect.foot-slot')!;
    expect(body).not.toBeNull();
    expect(slot).not.toBeNull();
    // Deduce zoom from the known 16mm Foot B body width.
    const zoom = Number(body.getAttribute('width')) / 16;
    expect(Number(slot.getAttribute('width'))).toBeCloseTo(NEEDLE_SLOT_WIDTH_MM * zoom, 4);
  });

  it('the glass foot tracks the currently visible needle stitch (not the next one)', () => {
    // User report: at feature-transition steps in a long Foot S design
    // (their "Stitch 10" around stitch 25–26) the foot is "way unaligned"
    // with the needle. Root cause hypothesis: the renderer indexes
    // `track[step]` for the foot but the needle marker is rendered at
    // `drops[step − 1]`. The off-by-one is invisible when consecutive
    // stitches are close together, but at any transition where stitch N
    // has a large delta from stitch N−1 the foot leaps to the *next*
    // position while the needle is still drawn at the previous one.
    //
    // Build a project whose 5th stitch has a big leap in BOTH X (right
    // across the slot, triggering jumps) and Y (downward by many mm).
    // The foot's vertical center MUST match the visible needle marker's
    // screen Y at every step, regardless of what the next stitch does.
    const proj = newProject('alignment');
    const points = [
      { id: 'p0', x: 0, y: 0 },
      { id: 'p1', x: 1, y: 2 },
      { id: 'p2', x: 2, y: 4 },
      { id: 'p3', x: 0, y: 6 },
      { id: 'p4', x: 0, y: 20 }, // pure-Y leap of 14 mm — single needle.
      { id: 'p5', x: 8, y: 22 }, // 8 mm right + 2 mm down — triggers jumps.
      { id: 'p6', x: 8, y: 30 },
    ];
    const segments: Segment[] = [
      { id: 's1', from: 'p0', to: 'p1', type: 'straight' },
      { id: 's2', from: 'p1', to: 'p2', type: 'straight' },
      { id: 's3', from: 'p2', to: 'p3', type: 'straight' },
      { id: 's4', from: 'p3', to: 'p4', type: 'straight' },
      { id: 's5', from: 'p4', to: 'p5', type: 'straight' },
      { id: 's6', from: 'p5', to: 'p6', type: 'straight' },
    ];
    const project: Project = {
      ...proj,
      suggestedFoot: 'S',
      points,
      segments,
    };

    // For each rendered step, the foot's slot center MUST sit on the
    // needle marker's screen position. If the renderer indexes one
    // step ahead, the foot leaps to the next stitch while the needle is
    // still at drops[step-1].
    for (let step = 1; step <= 30; step++) {
      const svg = newSvg();
      renderPreviewScene(svg, project, step, CONTAINER, 1);
      const dot = svg.querySelector('g.needle-marker circle.needle-dot');
      if (!dot) break;
      const needleX = Number(dot.getAttribute('cx'));
      const needleY = Number(dot.getAttribute('cy'));
      const slotEl = svg.querySelector<SVGRectElement>('g.presser-foot rect.foot-slot');
      if (!slotEl) continue;
      const slotCx = Number(slotEl.getAttribute('x')) + Number(slotEl.getAttribute('width')) / 2;
      const slotCy = Number(slotEl.getAttribute('y')) + Number(slotEl.getAttribute('height')) / 2;
      // The slot is centered on the carriage X and the current needle Y;
      // the slot's vertical center MUST equal the needle's screen Y, and
      // the carriage X MUST sit within slotHalf of the needle X (a needle
      // can be anywhere inside the slot, not necessarily centered).
      expect(
        slotCy,
        `step ${step}: slot cy=${slotCy}, needle cy=${needleY}`,
      ).toBeCloseTo(needleY, 1);
      const slotHalfPx = Number(slotEl.getAttribute('width')) / 2;
      expect(
        Math.abs(needleX - slotCx),
        `step ${step}: needle x=${needleX}, slot cx=${slotCx}, |Δ|=${Math.abs(needleX - slotCx).toFixed(2)} > slotHalf ${slotHalfPx.toFixed(2)}`,
      ).toBeLessThanOrEqual(slotHalfPx + 1);
    }
  });

  it('renders the needle marker only when step > 0', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 0, CONTAINER);
    expect(a.querySelector('g.needle-marker')).toBeNull();

    const b = newSvg();
    renderPreviewScene(b, project, 3, CONTAINER);
    expect(b.querySelector('g.needle-marker')).not.toBeNull();
  });

  it('renders the start indicator whenever drops exist', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER);
    expect(svg.querySelector('g.start-indicator')).not.toBeNull();
  });

  it('repeats the motif downward (g.repeats with >= 1 path child)', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const reps = svg.querySelector('g.repeats');
    expect(reps).not.toBeNull();
    expect(reps!.querySelectorAll('path.real-thread').length).toBeGreaterThan(0);
  });

  it('renders a presser-foot at the top of the canvas, sized in mm × view.zoom', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 0, CONTAINER, 1);
    const foot = a.querySelector('g.presser-foot');
    expect(foot).not.toBeNull();

    // Foot scales with zoom too: doubling userZoom doubles its visible width.
    const rectA = a.querySelector<SVGRectElement>('g.presser-foot rect.foot-body');
    const wA = Number(rectA!.getAttribute('width'));
    const b = newSvg();
    renderPreviewScene(b, project, 0, CONTAINER, 2);
    const rectB = b.querySelector<SVGRectElement>('g.presser-foot rect.foot-body');
    const wB = Number(rectB!.getAttribute('width'));
    expect(wB / wA).toBeCloseTo(2, 2);

    // Foot lives in the upper half of the canvas.
    const yA = Number(rectA!.getAttribute('y'));
    expect(yA).toBeLessThan(CONTAINER.containerH / 2);
  });

  it('renders a visible thread outline strictly thicker than the thread itself', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const outline = svg.querySelector('path.thread-outline');
    const thread = svg.querySelector('path.real-thread');
    expect(outline).not.toBeNull();
    expect(thread).not.toBeNull();
    const wOutline = Number(outline!.getAttribute('stroke-width'));
    const wThread = Number(thread!.getAttribute('stroke-width'));
    expect(wOutline).toBeGreaterThan(wThread);
  });

  it('thread stroke-width follows the threadDiameterMm option', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1, { threadDiameterMm: 0.20, needleSizeNm: 80 });
    const wA = Number(a.querySelector('path.real-thread')!.getAttribute('stroke-width'));

    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 1, { threadDiameterMm: 0.40, needleSizeNm: 80 });
    const wB = Number(b.querySelector('path.real-thread')!.getAttribute('stroke-width'));

    expect(wB / wA).toBeCloseTo(2, 2);
  });

  it('needle shaft stroke-width follows the needleSizeNm option', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 3, CONTAINER, 1, { threadDiameterMm: 0.22, needleSizeNm: 70 });
    const wA = Number(a.querySelector('line.needle-shaft')!.getAttribute('stroke-width'));

    const b = newSvg();
    renderPreviewScene(b, project, 3, CONTAINER, 1, { threadDiameterMm: 0.22, needleSizeNm: 110 });
    const wB = Number(b.querySelector('line.needle-shaft')!.getAttribute('stroke-width'));

    expect(wB / wA).toBeCloseTo(110 / 70, 2);
  });

  it('needle shaft stroke-width scales linearly with userZoom (NM/100 × view.zoom)', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 3, CONTAINER, 1);
    const wA = Number(a.querySelector('line.needle-shaft')!.getAttribute('stroke-width'));

    const b = newSvg();
    renderPreviewScene(b, project, 3, CONTAINER, 2);
    const wB = Number(b.querySelector('line.needle-shaft')!.getAttribute('stroke-width'));

    expect(wA).toBeGreaterThan(0);
    expect(wB / wA).toBeCloseTo(2, 2);
  });

  it('thread stroke-width scales linearly with userZoom (mm × view.zoom)', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1);
    const wA = Number(a.querySelector('path.real-thread')!.getAttribute('stroke-width'));

    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 2);
    const wB = Number(b.querySelector('path.real-thread')!.getAttribute('stroke-width'));

    expect(wA).toBeGreaterThan(0);
    expect(wB / wA).toBeCloseTo(2, 2);
  });

  it('presser-foot width follows project.suggestedFoot (S=20mm, B=16mm)', () => {
    // Use an in-reach 4 mm project for both feet — SAMPLE's wide sweeps
    // would refuse under Foot B's ±4.5 mm reach in the unified planner.
    const makeProj = (foot: 'S' | 'B'): Project => {
      const proj = newProject('width');
      const anchor = proj.points[0]!.id;
      return {
        ...proj,
        suggestedFoot: foot,
        points: [...proj.points, { id: 'pt_end', x: 4, y: 0 }],
        segments: [{ id: 's1', from: anchor, to: 'pt_end', type: 'straight' }],
      };
    };
    const a = newSvg();
    renderPreviewScene(a, makeProj('B'), 0, CONTAINER, 1);
    const wB = Number(a.querySelector<SVGRectElement>('g.presser-foot rect.foot-body')!.getAttribute('width'));

    const b = newSvg();
    renderPreviewScene(b, makeProj('S'), 0, CONTAINER, 1);
    const wS = Number(b.querySelector<SVGRectElement>('g.presser-foot rect.foot-body')!.getAttribute('width'));

    expect(wS / wB).toBeCloseTo(20 / 16, 2);
  });

  it('always renders X-limit guides at the active foot\'s mechanical reach', () => {
    const project: Project = { ...SAMPLE() };
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER);
    expect(svg.querySelector('g.pv-x-limit')).not.toBeNull();
  });

  // Machine truth: each motif chunk replays from where the needle came to
  // rest at the end of the previous one. The preview must mirror that —
  // per-repeat offset = (lastDrop − firstDrop) in mm × zoom.
  it('repeats translate by (lastDrop − firstDrop) × zoom, not by bbox height', () => {
    const project = driftProject(4, 12);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const reps = svg.querySelectorAll<SVGGElement>('g.repeats > g.repeat');
    expect(reps.length).toBeGreaterThan(0);
    const t = parseTranslate(reps[0]!.getAttribute('transform'));
    // Full thread path (outline) covers every drop regardless of kind,
    // so first/last points coincide with the chain's first/last drops —
    // the per-motif offset the preview's repeats translate by.
    const path = svg.querySelector<SVGPathElement>(
      'g.realistic-thread path.thread-outline',
    )!.getAttribute('d')!;
    const pts = parsePathPoints(path);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    expect(t.x).toBeCloseTo(last.x - first.x, 5);
    expect(t.y).toBeCloseTo(last.y - first.y, 5);
  });

  it('the kth repeat is translated by k × the per-motif offset', () => {
    const project = driftProject(2, 6);
    const svg = newSvg();
    // Auto-fit targets ~TARGET_REPEATS motifs, so dial zoom < 1 to leave
    // room for several repeats below the active one.
    renderPreviewScene(svg, project, 999, CONTAINER, 0.5);
    const reps = svg.querySelectorAll<SVGGElement>('g.repeats > g.repeat');
    expect(reps.length).toBeGreaterThanOrEqual(2);
    const t1 = parseTranslate(reps[0]!.getAttribute('transform'));
    const t2 = parseTranslate(reps[1]!.getAttribute('transform'));
    expect(t2.x).toBeCloseTo(2 * t1.x, 5);
    expect(t2.y).toBeCloseTo(2 * t1.y, 5);
  });

  it('auto-fit zooms more aggressively when the motif step (dy) is smaller than the bbox', () => {
    // Both designs span y ∈ [0, 50]. Wide-step returns to top (dy=50);
    // narrow-step returns near the start (dy=5) — but the bounding box
    // is the same. With the old "viewH × TARGET_REPEATS" auto-fit both
    // collapsed to the same zoom; the fix divides by motifHeight + (N-1)·dy
    // so the narrow design fits more aggressively.
    const wide = driftProject(0, 50);
    const proj = newProject('narrow');
    const anchorId = proj.points[0]!.id;
    const farId = 'pt_far';
    const backId = 'pt_back';
    const narrow: Project = {
      ...proj,
      points: [
        ...proj.points,
        { id: farId, x: 10, y: 50 },
        { id: backId, x: 0, y: 5 },
      ],
      segments: [
        { id: 's_a', from: anchorId, to: farId, type: 'straight' },
        { id: 's_b', from: farId, to: backId, type: 'straight' },
      ],
    };
    const a = newSvg();
    renderPreviewScene(a, wide, 999, CONTAINER, 1);
    const b = newSvg();
    renderPreviewScene(b, narrow, 999, CONTAINER, 1);
    const wA = Number(a.querySelector('path.real-thread')!.getAttribute('stroke-width'));
    const wB = Number(b.querySelector('path.real-thread')!.getAttribute('stroke-width'));
    expect(wB).toBeGreaterThan(wA * 1.3);
  });

  it('foot is drawn AFTER history thread so it covers the seam (higher z)', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const groups = [...svg.children];
    const histIdx = groups.findIndex((c) => (c as Element).classList?.contains('history'));
    const footIdx = groups.findIndex((c) => (c as Element).classList?.contains('presser-foot'));
    expect(histIdx).toBeGreaterThan(-1);
    expect(footIdx).toBeGreaterThan(histIdx);
  });

  it('renders one history iteration above the active motif by default', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const hist = svg.querySelector<SVGGElement>('g.history');
    expect(hist).not.toBeNull();
    expect(hist!.querySelectorAll('path.real-thread').length).toBe(1);
    // History sits above the active motif: translate dy is negative.
    const t = parseTranslate(hist!.getAttribute('transform'));
    expect(t.y).toBeLessThan(0);
  });

  it('hides the history iteration when showHistory is false', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1, {
      needleSizeNm: 80,
      threadDiameterMm: 0.3,
      showHistory: false,
    });
    expect(svg.querySelector('g.history')).toBeNull();
  });

  // The history toggle controls "example stitches surrounding the active
  // motif" — both the iteration above (history) and the iterations below
  // (future repeats). Hiding only the past confused users into thinking the
  // repeats below were the active stitching.
  it('hides the future repeats when showHistory is false', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1, {
      needleSizeNm: 80,
      threadDiameterMm: 0.3,
      showHistory: false,
    });
    expect(svg.querySelectorAll('g.repeats > g.repeat').length).toBe(0);
  });

  it('still renders future repeats when showHistory is true (default)', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    expect(svg.querySelectorAll('g.repeats > g.repeat').length).toBeGreaterThan(0);
  });

  // With both above-history and below-repeats hidden, the auto-fit no longer
  // needs to reserve room for them — the active motif fills more canvas.
  it('zooms the active motif larger when showHistory is false', () => {
    const project = driftProject(0, 30);
    const baseOpts = { needleSizeNm: 80, threadDiameterMm: 0.3 };
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1, { ...baseOpts, showHistory: true });
    const wOn = Number(a.querySelector('path.real-thread')!.getAttribute('stroke-width'));
    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 1, { ...baseOpts, showHistory: false });
    const wOff = Number(b.querySelector('path.real-thread')!.getAttribute('stroke-width'));
    expect(wOff).toBeGreaterThan(wOn);
  });

  it('hides the presser foot when showFoot is false', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1, {
      needleSizeNm: 80,
      threadDiameterMm: 0.3,
      showFoot: false,
    });
    expect(svg.querySelector('g.presser-foot')).toBeNull();
  });

  // The preview now supports a pan offset (middle/right/Alt+drag in the UI).
  // It applies before the foot/start anchoring so all derived screen-space
  // marks (foot, needle, X-axis line, X-limit guides, threads) translate
  // together — mirroring the editor's camera.
  it('pan {0,0} renders identically to omitting pan (back-compat)', () => {
    const project = driftProject(0, 30);
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1);
    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, pan: { x: 0, y: 0 },
    });
    const dA = a.querySelector('path.real-thread')!.getAttribute('d');
    const dB = b.querySelector('path.real-thread')!.getAttribute('d');
    expect(dB).toBe(dA);
  });

  it('pan shifts the active thread by (pan.x, pan.y)', () => {
    const project = driftProject(0, 30);
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1);
    const firstA = parsePathPoints(a.querySelector('path.real-thread')!.getAttribute('d')!)[0]!;
    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, pan: { x: 50, y: 30 },
    });
    const firstB = parsePathPoints(b.querySelector('path.real-thread')!.getAttribute('d')!)[0]!;
    expect(firstB.x - firstA.x).toBeCloseTo(50, 5);
    expect(firstB.y - firstA.y).toBeCloseTo(30, 5);
  });

  it('pan shifts the X=0 axis horizontally', () => {
    const project = driftProject(0, 30);
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1);
    const xA = Number(a.querySelector<SVGLineElement>('line.x-axis')!.getAttribute('x1'));
    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, pan: { x: 40, y: 0 },
    });
    const xB = Number(b.querySelector<SVGLineElement>('line.x-axis')!.getAttribute('x1'));
    expect(xB - xA).toBeCloseTo(40, 5);
  });

  it('renders a fabric background group with a tiled rect filling the canvas', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER, 1);
    const fabric = svg.querySelector('g.pv-fabric');
    expect(fabric).not.toBeNull();
    // The fill rect spans the whole container and uses url(#…) for the
    // basket-weave pattern defined in the same group's <defs>.
    const fillRect = fabric!.querySelector<SVGRectElement>('rect.pv-fabric-fill')!;
    expect(Number(fillRect.getAttribute('width'))).toBe(CONTAINER.containerW);
    expect(Number(fillRect.getAttribute('height'))).toBe(CONTAINER.containerH);
    expect(fillRect.getAttribute('fill')).toMatch(/^url\(#pv-fabric-/);
    // The pattern itself derives weft/warp shades from the bg color, so
    // the defs block has at least the base rect plus the four basket-weave
    // half-cells.
    expect(fabric!.querySelectorAll('defs pattern rect').length).toBeGreaterThanOrEqual(5);
  });

  it('the fabric pattern uses the bgColor option for its base fill', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, bgColor: '#abcdef',
    });
    // The first rect inside the pattern is the base fill (full tile).
    const baseRect = svg.querySelector<SVGRectElement>('g.pv-fabric defs pattern rect');
    expect(baseRect).not.toBeNull();
    expect(baseRect!.getAttribute('fill')).toBe('#abcdef');
  });

  it('threadColor option sets the --threadColor CSS custom property on the svg', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, threadColor: '#ff0000',
    });
    expect(svg.style.getPropertyValue('--threadColor')).toBe('#ff0000');
    // Outline is derived (mixed with black) — should be present and not equal
    // the thread color itself.
    const outline = svg.style.getPropertyValue('--threadOutlineColor');
    expect(outline).not.toBe('');
    expect(outline).not.toBe('#ff0000');
  });

  // Regression guard: when the caller omits threadColor / bgColor entirely,
  // the renderer must fall back to DEFAULT_THREAD_COLOR / DEFAULT_BG_COLOR.
  // Removing the `?? DEFAULT_*` fallbacks would leave the CSS var blank
  // (string ''), and the fabric base rect would have a non-color fill —
  // this test would catch both.
  it('falls back to DEFAULT_THREAD_COLOR / DEFAULT_BG_COLOR when options omit colors', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    expect(svg.style.getPropertyValue('--threadColor')).toBe(DEFAULT_THREAD_COLOR);
    const baseRect = svg.querySelector<SVGRectElement>('g.pv-fabric defs pattern rect');
    expect(baseRect!.getAttribute('fill')).toBe(DEFAULT_BG_COLOR);
  });

  // Regression guard: outline must be a *darkened* derivation of the user's
  // thread color, not a constant. Two different thread picks must produce
  // two different outline values; otherwise the outline derivation has been
  // replaced with a hardcoded shade and we've lost legibility against light
  // colors.
  it('--threadOutlineColor varies with --threadColor (per-color derivation)', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, threadColor: '#ff0000',
    });
    const oA = a.style.getPropertyValue('--threadOutlineColor');

    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, threadColor: '#00ff00',
    });
    const oB = b.style.getPropertyValue('--threadOutlineColor');

    expect(oA).not.toBe('');
    expect(oB).not.toBe('');
    expect(oA).not.toBe(oB);
    // Both should be darker (lower lightness) than their source — sanity-check
    // by ensuring the outline isn't accidentally the same as the source.
    expect(oA).not.toBe('#ff0000');
    expect(oB).not.toBe('#00ff00');
  });

  // Regression guard: the fabric pattern id is generated from a per-call
  // counter so repeated renders against the same document don't collide. If
  // the counter is removed (or the id becomes a fixed string), two renders
  // in a row would produce the same id and the second pattern would shadow
  // the first — visible as the wrong fabric color in the previously rendered
  // SVG. This test asserts ids are distinct.
  it('emits a unique fabric pattern id per renderPreviewScene call', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    const b = newSvg();
    renderPreviewScene(a, project, 0, CONTAINER, 1);
    renderPreviewScene(b, project, 0, CONTAINER, 1);
    const idA = a.querySelector('g.pv-fabric defs pattern')!.getAttribute('id');
    const idB = b.querySelector('g.pv-fabric defs pattern')!.getAttribute('id');
    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();
    expect(idA).not.toBe(idB);
  });

  // Fabric should feel like part of the same scene as the threads — so the
  // weave tile must scale with view.zoom rather than stay locked to a fixed
  // pixel size. Doubling userZoom doubles view.zoom, which should double
  // the pattern tile dimensions.
  it('fabric pattern tile scales linearly with view.zoom', () => {
    const project: Project = SAMPLE();
    const a = newSvg();
    renderPreviewScene(a, project, 0, CONTAINER, 1);
    const wA = Number(a.querySelector('g.pv-fabric defs pattern')!.getAttribute('width'));
    const b = newSvg();
    renderPreviewScene(b, project, 0, CONTAINER, 2);
    const wB = Number(b.querySelector('g.pv-fabric defs pattern')!.getAttribute('width'));
    expect(wA).toBeGreaterThan(0);
    expect(wB / wA).toBeCloseTo(2, 1);
  });

  // Stitch-puncture marks make the thread read as discrete stitches instead
  // of one continuous line — there's a small dot at each drop where the
  // needle would have punched the fabric.
  it('renders a stitch-puncture circle for each visible drop on the active thread', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const path = svg.querySelector('g.realistic-thread path.real-thread')!.getAttribute('d')!;
    const drops = parsePathPoints(path);
    const punctures = svg.querySelectorAll('g.realistic-thread circle.stitch-puncture');
    expect(drops.length).toBeGreaterThan(0);
    expect(punctures.length).toBe(drops.length);
  });

  it('renders no stitch-puncture circles when step is 0', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER);
    expect(svg.querySelectorAll('g.realistic-thread circle.stitch-puncture').length).toBe(0);
  });

  it('stitch-puncture radius scales with threadDiameterMm', () => {
    const project = driftProject(0, 30);
    const a = newSvg();
    renderPreviewScene(a, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.20,
    });
    const rA = Number(
      a.querySelector('g.realistic-thread circle.stitch-puncture')!.getAttribute('r'),
    );
    const b = newSvg();
    renderPreviewScene(b, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.40,
    });
    const rB = Number(
      b.querySelector('g.realistic-thread circle.stitch-puncture')!.getAttribute('r'),
    );
    expect(rA).toBeGreaterThan(0);
    expect(rB / rA).toBeCloseTo(2, 1);
  });

  // Pan should drag the fabric along with the rest of the scene — otherwise
  // the woven texture stays locked to the screen while the threads + foot
  // slide over it, which feels detached.
  it('fabric pattern translates by the pan offset (panTransform translate)', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 0, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3, pan: { x: 50, y: 30 },
    });
    const t = svg.querySelector('g.pv-fabric defs pattern')!.getAttribute('patternTransform') ?? '';
    const m = /translate\(\s*([-\d.eE+]+)\s*[,\s]\s*([-\d.eE+]+)\s*\)/.exec(t);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(50, 1);
    expect(Number(m![2])).toBeCloseTo(30, 1);
  });

  // The original single-circle puncture lost contrast against dark thread
  // picks. The two-layer rendering pairs a dark recess (visible against
  // light thread) with a fabric-coloured inner hole (visible against dark
  // thread) so the puncture reads against any thread + fabric combination.
  it('renders a fabric-coloured stitch-puncture-hole inside each puncture', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1, {
      needleSizeNm: 80, threadDiameterMm: 0.3,
      threadColor: '#000000', bgColor: '#abcdef',
    });
    const path = svg.querySelector('g.realistic-thread path.real-thread')!.getAttribute('d')!;
    const drops = parsePathPoints(path);
    const holes = svg.querySelectorAll<SVGCircleElement>(
      'g.realistic-thread circle.stitch-puncture-hole',
    );
    expect(holes.length).toBe(drops.length);
    expect(holes[0]!.getAttribute('fill')).toBe('#abcdef');
  });

  it('stitch-puncture-hole radius is strictly smaller than the recess', () => {
    const project = driftProject(0, 30);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const recess = svg.querySelector<SVGCircleElement>(
      'g.realistic-thread circle.stitch-puncture',
    );
    const hole = svg.querySelector<SVGCircleElement>(
      'g.realistic-thread circle.stitch-puncture-hole',
    );
    expect(recess).not.toBeNull();
    expect(hole).not.toBeNull();
    expect(Number(hole!.getAttribute('r'))).toBeLessThan(Number(recess!.getAttribute('r')));
    expect(Number(hole!.getAttribute('r'))).toBeGreaterThan(0);
  });

  it('fabric is the first child group so all other content paints on top', () => {
    const project: Project = SAMPLE();
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const first = svg.firstElementChild as Element;
    expect(first.classList.contains('pv-fabric')).toBe(true);
  });

  // Regression: the old logic was `floor((canvasH - yBot) / step)` which
  // dropped any motif that didn't fully fit below the active one. The user
  // wants any repeat whose bbox overlaps the viewport — even partially —
  // to render so the pattern reads as continuous up to the canvas edge.
  it('renders trailing partial repeats whose bbox still overlaps the canvas', () => {
    // Small dy gives lots of room for repeats; the last one will be a
    // partial overflow with the new logic, where the old logic dropped it.
    const project = driftProject(0, 8);
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const reps = svg.querySelectorAll<SVGGElement>('g.repeats > g.repeat');
    expect(reps.length).toBeGreaterThan(0);

    const ty1 = parseTranslate(reps[0]!.getAttribute('transform')!).y;
    const path = svg.querySelector<SVGPathElement>(
      'g.realistic-thread path.real-thread',
    )!.getAttribute('d')!;
    const pts = parsePathPoints(path);
    const yTop = Math.min(...pts.map((p) => p.y));

    // Every rendered repeat has at least a sliver inside the canvas
    // (top < containerH).
    for (let i = 0; i < reps.length; i++) {
      const ty = parseTranslate(reps[i]!.getAttribute('transform')!).y;
      expect(yTop + ty).toBeLessThan(CONTAINER.containerH);
    }
    // We didn't stop short: the next theoretical repeat (k = N+1) is
    // wholly past the canvas, OR we're already at the MAX_REPEATS=8 cap.
    const N = reps.length;
    if (N < 8) {
      const nextTop = yTop + (N + 1) * ty1;
      expect(nextTop).toBeGreaterThanOrEqual(CONTAINER.containerH);
    }
  });

  it('a closed-loop motif (last drop ≡ first drop) renders no repeats', () => {
    // Out and back: 0,0 → 5,10 → 0,0. lastDrop ≡ firstDrop, so on the
    // machine each repeat would stitch the exact same coordinates as the
    // active motif — showing stacked copies would be a visual lie.
    const proj = newProject('loop');
    const anchorId = proj.points[0]!.id;
    const midId = 'pt_mid';
    const backId = 'pt_back';
    const project: Project = {
      ...proj,
      points: [
        ...proj.points,
        { id: midId, x: 5, y: 10 },
        { id: backId, x: 0, y: 0 },
      ],
      segments: [
        { id: 's_out', from: anchorId, to: midId, type: 'straight' },
        { id: 's_back', from: midId, to: backId, type: 'straight' },
      ],
    };
    const svg = newSvg();
    renderPreviewScene(svg, project, 999, CONTAINER, 1);
    const reps = svg.querySelectorAll('g.repeats > g.repeat');
    expect(reps.length).toBe(0);
  });
});
