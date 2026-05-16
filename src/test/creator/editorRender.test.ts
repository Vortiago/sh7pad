import { describe, it, expect } from 'vitest';
import { renderEditorScene } from '../../ui/creator/editor/render.js';
import { computeView } from '../../ui/creator/editor/view.js';
import { newProject } from '../../creator/project.js';
import { addManualStitch } from '../../creator/manualStitch.js';
import { sequenceFromProject } from '../../creator/pipeline/encodeDesign.js';
import { NEEDLE_SLOT_WIDTH_MM } from '../../creator/foot.js';
import type { Point, Project, Segment } from '../../creator/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const newSvg = (): SVGSVGElement =>
  document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

const view = (project: Project) =>
  computeView({ w: 600, h: 600 }, project.hoop, 1, { x: 0, y: 0 });

const pt = (id: string, x: number, y: number): Point => ({ id, x, y });

const projectWith = (points: Point[], segments: Segment[]): Project => {
  const fresh = newProject('Test');
  return { ...fresh, points, segments };
};

describe('renderEditorScene — basic structure', () => {
  it('renders the hoop background rect', () => {
    const project = newProject('X');
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    expect(svg.querySelector('rect.ed-hoop')).not.toBeNull();
  });

  it('renders one <g[data-point-id]> per point', () => {
    const points = [pt('a', 0, 0), pt('b', 10, 0), pt('c', -5, 5)];
    const project = projectWith(points, []);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    const groups = svg.querySelectorAll('g[data-point-id]');
    expect(groups.length).toBe(3);
    expect(groups[0]?.getAttribute('data-point-id')).toBe('a');
  });

  it('flags the first point as data-role="start"', () => {
    const points = [pt('a', 0, 0), pt('b', 10, 0)];
    const project = projectWith(points, []);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    const first = svg.querySelector('g[data-point-id="a"]');
    expect(first?.getAttribute('data-role')).toBe('start');
  });
});

describe('renderEditorScene — segments', () => {
  it('renders one <line[data-segment-id]> per straight segment', () => {
    const points = [pt('a', 0, 0), pt('b', 5, 5)];
    const segs: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
    ];
    const project = projectWith(points, segs);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    const line = svg.querySelector('line[data-segment-id="s1"]');
    expect(line).not.toBeNull();
  });

  it('renders satin segments as <g[data-segment-id]> with a <polygon>', () => {
    const points = [pt('a', 0, 0), pt('b', 0, 10)];
    const segs: Segment[] = [{
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2, widthEnd: 2, density: 0.6,
    }];
    const project = projectWith(points, segs);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    const group = svg.querySelector('g[data-segment-id="s1"]');
    expect(group).not.toBeNull();
    expect(group?.querySelector('polygon')).not.toBeNull();
  });

  it('renders zigzag <line.satin-stitch> elements inside the satin group, matching the debug view', () => {
    const points = [pt('a', 0, 0), pt('b', 0, 10)];
    const segs: Segment[] = [{
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2, widthEnd: 2, density: 1,
    }];
    const project = projectWith(points, segs);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    const lines = svg.querySelectorAll('g[data-segment-id="s1"] line.satin-stitch');
    expect(lines.length).toBeGreaterThanOrEqual(5);
    // First stitch starts on the LEFT side of the spine: undo screen-space
    // offset by checking that x1 sits to the left of the spine x at y1.
    // For a vertical spine at x=0 with widthStart=2, the TL-corner x in
    // screen space is offsetX - 1*zoom — so x1 < offsetX.
    const first = lines[0]!;
    const spineLine = svg.querySelector('g[data-segment-id="s1"] line.satin-spine')!;
    const spineX1 = Number(spineLine.getAttribute('x1'));
    expect(Number(first.getAttribute('x1'))).toBeLessThan(spineX1);
  });

  it('marks the selected segment with class "selected"', () => {
    const points = [pt('a', 0, 0), pt('b', 5, 5)];
    const segs: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
    ];
    const project = projectWith(points, segs);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, { kind: 'segment', id: 's1' });
    const line = svg.querySelector('line[data-segment-id="s1"]');
    expect(line?.classList.contains('selected')).toBe(true);
  });

  it('marks only the last segment with class "last"', () => {
    const points = [pt('a', 0, 0), pt('b', 5, 5), pt('c', 10, 10)];
    const segs: Segment[] = [
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ];
    const project = projectWith(points, segs);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    expect(svg.querySelector('line[data-segment-id="s1"]')?.classList.contains('last')).toBe(false);
    expect(svg.querySelector('line[data-segment-id="s2"]')?.classList.contains('last')).toBe(true);
  });

  it('the to-endpoint of the last segment has class "end" (not the last point in the points array)', () => {
    // Post-subdivide of a→b: points = [a, b, c, mid], segments = [a→mid, mid→b, b→c].
    // The "end" point should be 'c' (the to of the last segment), NOT 'mid' (which is last in the points array).
    const points = [pt('a', 0, 0), pt('b', 0, 10), pt('c', 5, 20), pt('mid', 0, 5)];
    const segs: Segment[] = [
      { id: 's1a', from: 'a', to: 'mid', type: 'straight' },
      { id: 's1b', from: 'mid', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ];
    const project = projectWith(points, segs);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    const cGroup = svg.querySelector('g[data-point-id="c"]');
    const midGroup = svg.querySelector('g[data-point-id="mid"]');
    expect(cGroup?.classList.contains('end')).toBe(true);
    expect(cGroup?.getAttribute('data-role')).toBe('end');
    expect(midGroup?.classList.contains('end')).toBe(false);
  });
});

describe('renderEditorScene — touchable area', () => {
  // The fabric rect = the intersection of hoop Y-bounds and X-limit. Outside
  // of it is wrap bg, which IS the boundary cue — there's no separate
  // X-limit or Y-bound guide overlay any more.

  it('Foot B sizes the fabric rect to ±4.5 mm (Foot B carriage range)', () => {
    const project: Project = { ...newProject('X', { suggestedFoot: 'B' }) };
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const hoop = svg.querySelector('rect.ed-hoop')!;
    expect(Number(hoop.getAttribute('width'))).toBeCloseTo(4.5 * 2 * v.zoom);
  });

  it('Foot S sizes the fabric rect to ±27.25 mm (side-motion range)', () => {
    const project: Project = { ...newProject('X', { suggestedFoot: 'S' }) };
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const hoop = svg.querySelector('rect.ed-hoop')!;
    // Foot S reach (27.25) is narrower than the hoop halfW (60), so the
    // touchable rect clamps to 27.25 × 2.
    expect(Number(hoop.getAttribute('width'))).toBeCloseTo(27.25 * 2 * v.zoom);
  });
});

describe('renderEditorScene — background image', () => {
  it('renders an <image> only when project.bg is non-null', () => {
    const project = newProject('X');
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    expect(svg.querySelector('image')).toBeNull();
  });

  it('renders the BG image with the caller-supplied object URL', () => {
    const project: Project = {
      ...newProject('X'),
      bg: {
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        x: 5, y: 10, scale: 1.5, rotate: 0, opacity: 0.5,
      },
    };
    const svg = newSvg();
    const url = 'blob:fake-object-url-for-test';
    renderEditorScene(svg, project, view(project), null, null, undefined, undefined, url);
    const img = svg.querySelector('image');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('href')).toBe(url);
  });

  it('skips rendering the <image> when bg is set but no objectUrl is supplied', () => {
    const project: Project = {
      ...newProject('X'),
      bg: {
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        x: 5, y: 10, scale: 1.5, rotate: 0, opacity: 0.5,
      },
    };
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    expect(svg.querySelector('image')).toBeNull();
  });
});

describe('renderEditorScene — hover crosshair', () => {
  it('renders the hover crosshair group when hoverHoop is provided', () => {
    const project = newProject('X');
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), { x: 5, y: 10 }, null);
    expect(svg.querySelector('g.hover-crosshair')).not.toBeNull();
  });

  it('does NOT render the hover crosshair when hoverHoop is null', () => {
    const project = newProject('X');
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    expect(svg.querySelector('g.hover-crosshair')).toBeNull();
  });
});

describe('renderEditorScene — manual mode', () => {
  function manualS(stitches: { kind: 'needle' | 'jump'; x: number; y: number }[]): Project {
    let p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    for (const s of stitches) p = addManualStitch(p, s);
    return p;
  }

  it('draws a polyline of ed-manual-segment lines (one per consecutive pair) when project.mode === "manual"', () => {
    const project = manualS([
      { kind: 'needle', x: 1, y: 1 },
      { kind: 'needle', x: 2, y: 2 },
      { kind: 'needle', x: 3, y: 3 },
    ]);
    const seq = sequenceFromProject(project);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null, seq);
    // 5 stitches in the sequence (start + Start Stitch + 3 user) → 4
    // connecting line segments.
    expect(svg.querySelectorAll('line.ed-manual-segment').length).toBe(4);
  });

  it('renders one ed-manual-marker per non-start stitch (including the Start Stitch)', () => {
    const project = manualS([
      { kind: 'needle', x: 1, y: 1 },
      { kind: 'needle', x: 2, y: 2 },
      { kind: 'needle', x: 3, y: 3 },
    ]);
    const seq = sequenceFromProject(project);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null, seq);
    expect(svg.querySelectorAll('g.ed-manual-marker').length).toBe(4);
    // Markers carry a per-stitch index for hit-testing / future selection.
    expect(svg.querySelector('g.ed-manual-marker[data-manual-idx="0"]')).not.toBeNull();
    expect(svg.querySelector('g.ed-manual-marker[data-manual-idx="1"]')).not.toBeNull();
    expect(svg.querySelector('g.ed-manual-marker[data-manual-idx="2"]')).not.toBeNull();
    expect(svg.querySelector('g.ed-manual-marker[data-manual-idx="3"]')).not.toBeNull();
  });

  it('renders jump segments with class kind-jump and needle segments with class kind-needle', () => {
    // Sequence: [start, Start Stitch needle, user-needle@(1,1), user-jump@(2,1), user-needle@(2.5,2)]
    // → 4 connecting lines, classes follow destination.
    const project = manualS([
      { kind: 'needle', x: 1, y: 1 },
      { kind: 'jump',   x: 2, y: 1 },
      { kind: 'needle', x: 2.5, y: 2 },
    ]);
    const seq = sequenceFromProject(project);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null, seq);
    const segs = Array.from(svg.querySelectorAll('line.ed-manual-segment'));
    expect(segs[0]?.classList.contains('kind-needle')).toBe(true); // start → Start Stitch
    expect(segs[1]?.classList.contains('kind-needle')).toBe(true); // Start Stitch → user-needle
    expect(segs[2]?.classList.contains('kind-jump')).toBe(true);
    expect(segs[3]?.classList.contains('kind-needle')).toBe(true);
  });

  it('does not render design-mode segment lines for a manual project (defensive)', () => {
    const project = manualS([{ kind: 'needle', x: 1, y: 0 }]);
    const seq = sequenceFromProject(project);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null, seq);
    expect(svg.querySelector('[data-segment-id]')).toBeNull();
  });

  it('renders nothing manual-related for a manual project with zero stitches', () => {
    const project = manualS([]);
    const seq = sequenceFromProject(project);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null, seq);
    expect(svg.querySelectorAll('line.ed-manual-segment').length).toBe(0);
    expect(svg.querySelectorAll('g.ed-manual-marker').length).toBe(0);
  });

  it('design-mode renders are unchanged when the optional sequence arg is omitted', () => {
    // Sanity: passing no sequence → no manual elements appear, design segments draw as usual.
    const project = newProject('D');
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null);
    expect(svg.querySelectorAll('line.ed-manual-segment').length).toBe(0);
    expect(svg.querySelectorAll('g.ed-manual-marker').length).toBe(0);
  });
});

describe('renderEditorScene — live needle window overlay', () => {
  function manualS(stitches: { kind: 'needle' | 'jump'; x: number; y: number }[]): Project {
    let p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    for (const s of stitches) p = addManualStitch(p, s);
    return p;
  }

  it('renders an .ed-needle-window band centered at carriageX with the full slot width when manual + add + needle', () => {
    const project = manualS([]);
    const seq = sequenceFromProject(project);
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null, seq, { tool: 'add', activeStitch: 'needle' });
    const band = svg.querySelector('rect.ed-needle-window');
    expect(band).not.toBeNull();
    // Band spans NEEDLE_SLOT_WIDTH_MM in hoop space → that × zoom px wide.
    expect(Number(band!.getAttribute('width'))).toBeCloseTo(NEEDLE_SLOT_WIDTH_MM * v.zoom);
  });

  it('renders a tighter ±1 mm band around the current needle X when activeStitch="jump"', () => {
    const project = manualS([]);
    const seq = sequenceFromProject(project);
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null, seq, { tool: 'add', activeStitch: 'jump' });
    const band = svg.querySelector('rect.ed-needle-window');
    expect(band).not.toBeNull();
    expect(Number(band!.getAttribute('width'))).toBeCloseTo(2 * v.zoom);
  });

  it('renders no overlay when tool !== "add" (Select/Move/Pan are visually quiet)', () => {
    const project = manualS([]);
    const seq = sequenceFromProject(project);
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null, seq, { tool: 'select', activeStitch: 'needle' });
    expect(svg.querySelector('rect.ed-needle-window')).toBeNull();
  });

  it('renders no overlay for design-mode projects regardless of tool/activeStitch', () => {
    const project = newProject('D');
    const svg = newSvg();
    renderEditorScene(svg, project, view(project), null, null, undefined, { tool: 'add', activeStitch: 'straight' });
    expect(svg.querySelector('rect.ed-needle-window')).toBeNull();
  });

  it('paints the hover affordance with ed-hover-reject when hover.valid === false', () => {
    const project = manualS([]);
    const seq = sequenceFromProject(project);
    const v = view(project);
    const svg = newSvg();
    // Pass a hover that is "outside" — caller flags it via .valid=false on
    // the HoverHoop object so the renderer can swap the dot for a ⊘ glyph.
    renderEditorScene(svg, project, v, { x: 10, y: 5, valid: false }, null, seq, { tool: 'add', activeStitch: 'needle' });
    expect(svg.querySelector('.ed-hover-reject')).not.toBeNull();
  });

  // Y-cap (firmware envelope |dy| ≤ 4 mm per record). The live window must
  // be a 2D box, not a full-hoop band, so the user can see the Y reach.
  // The Start Stitch is always at Y=0; to position the running needle
  // elsewhere we inject a manual stitch directly (bypassing the dy=4mm
  // validator) so a single test can position the needle anywhere.
  it('clips the band height to ±STITCH_DY_MAX_MM (4 mm) around the current needle Y', () => {
    const p: Project = {
      ...newProject('M', { mode: 'manual', suggestedFoot: 'S' }),
      manualStitches: [{ kind: 'needle', x: 0, y: 10, dxRaw: 0, dyRaw: 120 }],
    };
    const seq = sequenceFromProject(p);
    const v = view(p);
    const svg = newSvg();
    renderEditorScene(svg, p, v, null, null, seq, { tool: 'add', activeStitch: 'needle' });
    const band = svg.querySelector('rect.ed-needle-window')!;
    expect(Number(band.getAttribute('height'))).toBeCloseTo(8 * v.zoom);
    expect(Number(band.getAttribute('y'))).toBeCloseTo(v.offsetY + 6 * v.zoom);
  });

  it('clamps the band to the hoop floor near the top', () => {
    const p: Project = {
      ...newProject('M', { mode: 'manual', suggestedFoot: 'S' }),
      manualStitches: [{ kind: 'needle', x: 0, y: 2, dxRaw: 0, dyRaw: 24 }],
    };
    const seq = sequenceFromProject(p);
    const v = view(p);
    const svg = newSvg();
    renderEditorScene(svg, p, v, null, null, seq, { tool: 'add', activeStitch: 'needle' });
    const band = svg.querySelector('rect.ed-needle-window')!;
    expect(Number(band.getAttribute('y'))).toBeCloseTo(v.offsetY);
    expect(Number(band.getAttribute('height'))).toBeCloseTo(6 * v.zoom);
  });
});

describe('renderEditorScene — start marker', () => {
  // The start marker shows where the carriage sits at design start
  // (project.startXMm, drawn at the chain anchor's Y). It's the
  // editor-visible counterpart of the binary's `xElem` field, and the
  // geometry (body rect + inner slot rect) matches the preview foot
  // so the icon reads consistently across both modes.

  it('renders a draggable start-marker group at (startXMm, chainAnchor.y)', () => {
    const project: Project = { ...newProject('S'), startXMm: 1.25 };
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const marker = svg.querySelector('g.ed-start-marker');
    expect(marker).not.toBeNull();
    expect(marker!.getAttribute('data-role')).toBe('start-marker');
    // Translate transform places it at (startXMm * zoom + offsetX, ...).
    const transform = marker!.getAttribute('transform') ?? '';
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform);
    expect(m).not.toBeNull();
    const tx = Number(m![1]!);
    expect(tx).toBeCloseTo(v.offsetX + 1.25 * v.zoom, 4);
  });

  it('renders at the chain anchor X when startXMm is unset (default 0)', () => {
    // Older projects predating startXMm load with the field undefined;
    // the renderer should treat that as 0 (= chain anchor).
    const fresh = newProject('legacy');
    const project: Project = { ...fresh };
    delete (project as Partial<Project>).startXMm;
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const marker = svg.querySelector('g.ed-start-marker');
    expect(marker).not.toBeNull();
    const transform = marker!.getAttribute('transform') ?? '';
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform);
    expect(Number(m![1]!)).toBeCloseTo(v.offsetX, 4);
  });

  it('renders a foot-body rect plus an inner foot-slot rect (visual match with preview foot)', () => {
    const project: Project = { ...newProject('S', { suggestedFoot: 'S' }), startXMm: 0 };
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const body = svg.querySelector('rect.ed-start-body');
    const slot = svg.querySelector('rect.ed-start-slot');
    expect(body).not.toBeNull();
    expect(slot).not.toBeNull();
    // Body is wider than slot (slot is the inner needle window).
    expect(Number(body!.getAttribute('width'))).toBeGreaterThan(Number(slot!.getAttribute('width')));
    // Slot width tracks NEEDLE_SLOT_WIDTH_MM × zoom.
    expect(Number(slot!.getAttribute('width'))).toBeCloseTo(NEEDLE_SLOT_WIDTH_MM * v.zoom, 4);
  });

  it('carries a <title> tooltip describing the carriage start and how to move it', () => {
    const project: Project = { ...newProject('S'), startXMm: -0.75 };
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const title = svg.querySelector('g.ed-start-marker > title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toContain('Carriage start');
    expect(title!.textContent).toContain('-0.75 mm');
  });

  it('marks the marker as locked in manual mode once a stitch is placed', () => {
    const base = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    const project: Project = {
      ...base,
      startXMm: -0.5,
      manualStitches: [{ kind: 'needle', x: 0, y: 0, dxRaw: 0, dyRaw: 0 }],
    };
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const marker = svg.querySelector('g.ed-start-marker');
    expect(marker?.classList.contains('ed-start-marker-locked')).toBe(true);
    expect(marker?.getAttribute('data-locked')).toBe('true');
    // Tooltip updates to explain the lock so the user knows why drag is
    // ignored.
    expect(marker?.querySelector('title')?.textContent).toContain('Locked');
  });

  it('design mode keeps the marker unlocked even when segments exist', () => {
    const base = newProject('D');
    const project: Project = {
      ...base,
      startXMm: 1,
      // Note: lockProjectInvariants is what actually rejects mode flips
      // / clears stray fields; the renderer just reads the state.
      segments: [{ id: 's1', from: base.points[0]!.id, to: base.points[0]!.id, type: 'straight' }],
    };
    const v = view(project);
    const svg = newSvg();
    renderEditorScene(svg, project, v, null, null);
    const marker = svg.querySelector('g.ed-start-marker');
    expect(marker?.classList.contains('ed-start-marker-locked')).toBe(false);
    expect(marker?.getAttribute('data-locked')).toBe('false');
  });
});
