// Editor scene primitives — segments (straight + satin), points,
// manual-thread visualization, hover crosshair. Pure DOM/SVG; no
// project state lookup beyond what's passed in.

import { svgEl } from '../../svgDom.js';
import { coneCorners, satinStitches, spineToEdges } from '../../../shared/satinShape.js';
import type { Point, SatinSegment, Segment } from '../../../creator/types.js';
import type { StitchSequence } from '../../../creator/pipeline/stitch.js';

export type Px = (mmX: number, mmY: number) => { x: number; y: number };

export interface HoverHoop {
  x: number;
  y: number;
  /**
   * Manual-mode validity flag from editorInteract's onHoverValidity
   * signal. When `false`, the renderer paints an `ed-hover-reject` glyph
   * instead of the regular crosshair dot. Absent / undefined means the
   * caller hasn't computed a manual-mode validity (design mode, or the
   * cursor isn't over the canvas) — render as before.
   */
  valid?: boolean;
}

export function renderSegment(
  seg: Segment,
  a: Point,
  b: Point,
  px: Px,
  selected: boolean,
  isLast: boolean,
): SVGElement {
  const cls = ['ed-segment', `kind-${seg.type}`];
  if (selected) cls.push('selected');
  if (isLast) cls.push('last');
  if (seg.imported) cls.push('imported');

  if (seg.type === 'satin') {
    return renderSatinSegment(seg, a, b, px, cls);
  }

  const ap = px(a.x, a.y);
  const bp = px(b.x, b.y);
  const line = svgEl('line', {
    x1: ap.x, y1: ap.y, x2: bp.x, y2: bp.y,
    'data-segment-id': seg.id,
  }, cls);
  return line;
}

function renderSatinSegment(
  seg: SatinSegment,
  a: Point,
  b: Point,
  px: Px,
  cls: string[],
): SVGGElement {
  const g = svgEl('g', { 'data-segment-id': seg.id }, cls);
  // Compute the cone in mm using the shared satin module, then project.
  const edges = spineToEdges({
    from: { x: a.x, y: a.y },
    to: { x: b.x, y: b.y },
    widthStart: seg.widthStart,
    widthEnd: seg.widthEnd,
  });
  const corners = coneCorners(edges);
  const tl = px(corners.tl.x, corners.tl.y);
  const tr = px(corners.tr.x, corners.tr.y);
  const bl = px(corners.bl.x, corners.bl.y);
  const br = px(corners.br.x, corners.br.y);
  g.appendChild(svgEl('polygon', {
    points: `${tl.x},${tl.y} ${bl.x},${bl.y} ${br.x},${br.y} ${tr.x},${tr.y}`,
  }, ['satin-cone']));
  // Zigzag stitch lines — same algorithm the parser uses for the debug view.
  for (const stitch of satinStitches(edges, seg.density)) {
    const s = px(stitch.start.x, stitch.start.y);
    const e = px(stitch.end.x, stitch.end.y);
    g.appendChild(svgEl('line', {
      x1: s.x, y1: s.y, x2: e.x, y2: e.y,
    }, ['satin-stitch']));
  }
  // A simple spine line so the segment can be clicked easily.
  const ap = px(a.x, a.y);
  const bp = px(b.x, b.y);
  g.appendChild(svgEl('line', {
    x1: ap.x, y1: ap.y, x2: bp.x, y2: bp.y,
  }, ['satin-spine']));
  return g;
}

export function renderPoint(
  point: Point,
  sp: { x: number; y: number },
  isFirst: boolean,
  isLast: boolean,
  isSelected: boolean,
): SVGGElement {
  const cls = ['ed-point'];
  if (isFirst) cls.push('start');
  if (isLast) cls.push('end');
  if (isSelected) cls.push('selected');
  const role = isFirst ? 'start' : isLast ? 'end' : 'mid';
  const g = svgEl('g', {
    transform: `translate(${sp.x} ${sp.y})`,
    'data-point-id': point.id,
    'data-role': role,
  }, cls);
  if (isFirst) {
    g.appendChild(svgEl('circle', { r: 11, fill: 'none' }, ['start-halo']));
    g.appendChild(svgEl('circle', { r: 7 }, ['start-disc']));
  } else {
    g.appendChild(svgEl('circle', { r: isSelected ? 7 : 5 }, ['point-disc']));
    g.appendChild(svgEl('circle', { r: isSelected ? 3 : 2.2 }, ['point-dot']));
  }
  return g;
}

export function renderManualThread(
  seq: StitchSequence,
  px: Px,
): SVGGElement {
  const g = svgEl('g', { class: 'ed-manual-thread' });
  const stitches = seq;
  // Connecting lines: one per consecutive pair. Class reflects the
  // *destination* stitch's kind so jump segments dash via CSS.
  for (let i = 1; i < stitches.length; i++) {
    const prev = stitches[i - 1]!;
    const cur = stitches[i]!;
    const a = px(prev.x, prev.y);
    const b = px(cur.x, cur.y);
    g.appendChild(svgEl('line', {
      class: `ed-manual-segment kind-${cur.kind}`,
      x1: String(a.x), y1: String(a.y),
      x2: String(b.x), y2: String(b.y),
    }));
  }
  // Drop markers: one per non-start stitch, indexed so a future selection
  // pass can highlight rows ↔ markers.
  let manualIdx = 0;
  for (let i = 1; i < stitches.length; i++) {
    const s = stitches[i]!;
    const sp = px(s.x, s.y);
    const marker = svgEl('g', {
      class: `ed-manual-marker kind-${s.kind}`,
      'data-manual-idx': String(manualIdx),
      transform: `translate(${sp.x},${sp.y})`,
    });
    marker.appendChild(svgEl('circle', { r: '3', class: 'ed-manual-dot' }));
    g.appendChild(marker);
    manualIdx++;
  }
  return g;
}

export interface StartMarkerInput {
  /** Carriage start X in hoop mm. */
  startXMm: number;
  /** Y of the chain anchor (first point), used to position the marker. */
  chainAnchorY: number;
  /** True when the project state has frozen the start (manual mode after
   *  the first stitch is placed). Drives the locked class + tooltip text. */
  locked: boolean;
  /** Foot body width in mm — Foot S 20 mm, Foot B 16 mm. */
  bodyWidthMm: number;
  /** Foot body height in mm (shared constant from preview/scene). */
  bodyHeightMm: number;
  /** Half-width of the foot's inner needle slot in mm. */
  slotHalfWMm: number;
  /** Inner slot height in mm (shared constant from preview/scene). */
  slotHeightMm: number;
}

export function renderStartMarker(
  input: StartMarkerInput,
  px: Px,
  zoom: number,
): SVGGElement {
  const { startXMm, chainAnchorY, locked, bodyWidthMm, bodyHeightMm, slotHalfWMm, slotHeightMm } = input;
  const startPx = px(startXMm, chainAnchorY);
  const startG = svgEl('g', {
    'data-role': 'start-marker',
    'data-locked': locked ? 'true' : 'false',
    transform: `translate(${startPx.x} ${startPx.y})`,
  }, ['ed-start-marker', ...(locked ? ['ed-start-marker-locked'] : [])]);
  // Native browser tooltip on hover, and the same string is exposed to
  // screen readers via `<title>` (the SVG accessibility convention).
  const startTooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  startTooltip.textContent = locked
    ? `Carriage start: X = ${startXMm.toFixed(2)} mm. Locked — manual-mode designs freeze the start once the first stitch is placed.`
    : `Carriage start: X = ${startXMm.toFixed(2)} mm. Drag to move the carriage's design-start position.`;
  startG.appendChild(startTooltip);
  // Foot body + inner slot, geometry-identical to the preview foot so
  // the icon reads the same in both modes.
  const bodyW = bodyWidthMm * zoom;
  const bodyH = bodyHeightMm * zoom;
  const slotW = slotHalfWMm * 2 * zoom;
  const slotH = slotHeightMm * zoom;
  startG.appendChild(svgEl('rect', {
    x: -bodyW / 2,
    y: -bodyH / 2,
    width: bodyW,
    height: bodyH,
    rx: Math.min(2, bodyW / 6),
  }, ['ed-start-body']));
  startG.appendChild(svgEl('rect', {
    x: -slotW / 2,
    y: -slotH / 2,
    width: slotW,
    height: slotH,
    rx: Math.min(1.5, slotW / 8),
  }, ['ed-start-slot']));
  return startG;
}

export function renderHover(
  hover: HoverHoop,
  halfW: number,
  H: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): SVGGElement {
  const g = svgEl('g', {}, ['hover-crosshair']);
  const xp = hover.x * zoom + offsetX;
  const yp = hover.y * zoom + offsetY;
  g.appendChild(svgEl('line', {
    x1: offsetX - halfW * zoom, x2: offsetX + halfW * zoom,
    y1: yp, y2: yp,
  }, ['hover-line', 'hover-h']));
  g.appendChild(svgEl('line', {
    x1: xp, x2: xp,
    y1: offsetY, y2: offsetY + H * zoom,
  }, ['hover-line', 'hover-v']));
  if (hover.valid === false) {
    // Manual-mode rejected hover — swap the regular dot for a circled
    // slash glyph so the user can tell at a glance that this click
    // would be a no-op. The cursor:not-allowed flip on the wrap is the
    // primary affordance; this is the on-canvas confirmation.
    const reject = svgEl('g', {
      transform: `translate(${xp},${yp})`,
    }, ['ed-hover-reject']);
    reject.appendChild(svgEl('circle', { r: 6 }, ['ed-hover-reject-ring']));
    reject.appendChild(svgEl('line', {
      x1: -4, y1: -4, x2: 4, y2: 4,
    }, ['ed-hover-reject-slash']));
    g.appendChild(reject);
    return g;
  }
  // Outer ring + inner filled dot. The dot tracks the cursor 1:1 so users
  // see the precise mm position the next click will place — no jump on click.
  g.appendChild(svgEl('circle', { cx: xp, cy: yp, r: 4 }, ['hover-target']));
  g.appendChild(svgEl('circle', { cx: xp, cy: yp, r: 1.5 }, ['hover-target-dot']));
  return g;
}
