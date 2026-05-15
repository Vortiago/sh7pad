// Preview scene — presser foot, X-limit guides, motif history (the
// previous iteration above the active motif) and motif repeats (the
// future iterations below). Cluster around "what does the motif look
// like in context" — the threads themselves render in sceneThread.

import { svgEl } from '../../svgDom.js';
import { motifOffsetMm } from '../../../creator/bbox.js';
import type { Stitch } from '../../../creator/pipeline/stitch.js';
import {
  FOOT_BODY_HEIGHT_MM,
  FOOT_SLOT_HEIGHT_MM,
  MAX_REPEATS,
  pathOf,
  pathOfKind,
  projectPx,
  type PreviewView,
  type ScreenView,
} from './scene.js';
import { renderStitchPunctures } from './sceneThread.js';

export function renderFoot(
  view: ScreenView,
  carriageXMm: number,
  needleYMm: number,
  bodyWidthMm: number,
  slotWidthMm: number,
): SVGGElement {
  const g = svgEl('g', {}, ['presser-foot']);
  const bodyW = bodyWidthMm * view.zoom;
  const bodyH = FOOT_BODY_HEIGHT_MM * view.zoom;
  const slotW = slotWidthMm * view.zoom;
  const slotH = FOOT_SLOT_HEIGHT_MM * view.zoom;
  const cx = carriageXMm * view.zoom + view.offsetX;
  const cy = needleYMm * view.zoom + view.offsetY;
  // Translucent body — fabric / threads beneath read through it. CSS
  // controls fill opacity and stroke; we just supply geometry.
  g.appendChild(svgEl('rect', {
    x: cx - bodyW / 2,
    y: cy - bodyH / 2,
    width: bodyW,
    height: bodyH,
    rx: Math.min(2, bodyW / 6),
  }, ['foot-body']));
  // Inner eye — the carriage's mechanical needle window. CSS gives this
  // its own visible edge so the user can pick it out inside the body.
  g.appendChild(svgEl('rect', {
    x: cx - slotW / 2,
    y: cy - slotH / 2,
    width: slotW,
    height: slotH,
    rx: Math.min(1.5, slotW / 8),
  }, ['foot-slot']));
  return g;
}

export function renderXLimitGuides(xLim: number, view: ScreenView): SVGGElement {
  const g = svgEl('g', {}, ['pv-x-limit']);
  const lx = xLim * view.zoom + view.offsetX;
  const rx = -xLim * view.zoom + view.offsetX;
  g.appendChild(svgEl('line', {
    x1: lx, y1: view.yTop, x2: lx, y2: view.yBot,
  }, ['pv-x-limit-line']));
  g.appendChild(svgEl('line', {
    x1: rx, y1: view.yTop, x2: rx, y2: view.yBot,
  }, ['pv-x-limit-line']));
  return g;
}

export function renderMotifHistory(
  allDrops: readonly Stitch[],
  view: ScreenView,
  threadDiameterMm: number,
  threadColor: string,
  bgColor: string,
): SVGGElement {
  const g = svgEl('g', {}, ['history']);
  if (allDrops.length < 2) return g;
  // Same machine-truth offset as below-repeats, but applied negatively so
  // the history motif's lastDrop coincides with the active motif's first.
  const { dx, dy } = motifOffsetMm(allDrops);
  const dxPx = dx * view.zoom;
  const dyPx = dy * view.zoom;
  if (Math.abs(dxPx) < 1e-6 && Math.abs(dyPx) < 1e-6) return g;
  const d = pathOf(allDrops, view);
  const threadPx = threadDiameterMm * view.zoom;
  const outlinePx = threadPx + Math.max(1.2, 0.10 * view.zoom);
  const highlightPx = Math.max(0.4, threadPx * 0.3);
  g.setAttribute('transform', `translate(${-dxPx} ${-dyPx})`);
  g.appendChild(svgEl('path', { d, 'stroke-width': outlinePx }, ['thread-outline']));
  const needleD = pathOfKind(allDrops, view, 'needle') || d;
  const jumpD = pathOfKind(allDrops, view, 'jump');
  g.appendChild(svgEl('path', { d: needleD, 'stroke-width': threadPx }, ['real-thread']));
  if (jumpD) {
    g.appendChild(svgEl('path', { d: jumpD, 'stroke-width': threadPx }, ['real-thread-jump']));
  }
  g.appendChild(svgEl('path', {
    d, transform: 'translate(-0.3 -0.5)', 'stroke-width': highlightPx,
  }, ['real-highlight']));
  g.appendChild(renderStitchPunctures(allDrops, view, threadDiameterMm, threadColor, bgColor));
  return g;
}

export function renderMotifRepeats(
  allDrops: readonly Stitch[],
  view: ScreenView,
  container: PreviewView,
  threadDiameterMm: number,
  threadColor: string,
  bgColor: string,
): SVGGElement {
  const g = svgEl('g', {}, ['repeats']);
  if (allDrops.length < 2) return g;
  // Machine truth: each motif chunk replays from where the needle came to
  // rest at the end of the previous one, so the per-repeat shift is
  // (lastDrop − firstDrop), NOT the bbox height. A non-zero closing X
  // therefore drifts the pattern sideways every repeat — that's a real
  // machine artifact and the preview must show it.
  const { dx, dy } = motifOffsetMm(allDrops);
  const dxPx = dx * view.zoom;
  const dyPx = dy * view.zoom;
  // Closed-loop motif (end ≡ start) — every repeat would overlay the
  // active motif exactly, so render none rather than lying about repetition.
  if (Math.abs(dxPx) < 1e-6 && Math.abs(dyPx) < 1e-6) return g;
  // Render every repeat whose stitches vertically overlap the canvas
  // (even a sliver). The previous floor-room/step formula dropped partial
  // overflow motifs, so the pattern visibly stopped well before the canvas
  // edge — the user wants the repeats to extend until they're fully
  // off-screen.
  let dropMinY = Infinity;
  let dropMaxY = -Infinity;
  for (const d of allDrops) {
    if (d.y < dropMinY) dropMinY = d.y;
    if (d.y > dropMaxY) dropMaxY = d.y;
  }
  const dropMinPx = dropMinY * view.zoom + view.offsetY;
  const dropMaxPx = dropMaxY * view.zoom + view.offsetY;
  let N = 0;
  for (let k = 1; k <= MAX_REPEATS; k++) {
    const top = dropMinPx + k * dyPx;
    const bot = dropMaxPx + k * dyPx;
    if (top < container.containerH && bot > 0) {
      N = k;
    } else {
      break;
    }
  }
  if (N === 0) return g;
  const d = pathOf(allDrops, view);
  const threadPx = threadDiameterMm * view.zoom;
  const outlinePx = threadPx + Math.max(1.2, 0.10 * view.zoom);
  const highlightPx = Math.max(0.4, threadPx * 0.3);
  const needleD = pathOfKind(allDrops, view, 'needle') || d;
  const jumpD = pathOfKind(allDrops, view, 'jump');
  for (let k = 1; k <= N; k++) {
    const tx = k * dxPx;
    const ty = k * dyPx;
    const repG = svgEl('g', { transform: `translate(${tx} ${ty})` }, ['repeat']);
    repG.appendChild(svgEl('path', { d, 'stroke-width': outlinePx }, ['thread-outline']));
    repG.appendChild(svgEl('path', { d: needleD, 'stroke-width': threadPx }, ['real-thread']));
    if (jumpD) {
      repG.appendChild(svgEl('path', { d: jumpD, 'stroke-width': threadPx }, ['real-thread-jump']));
    }
    repG.appendChild(svgEl('path', {
      d, transform: 'translate(-0.3 -0.5)', 'stroke-width': highlightPx,
    }, ['real-highlight']));
    repG.appendChild(renderStitchPunctures(allDrops, view, threadDiameterMm, threadColor, bgColor));
    g.appendChild(repG);
  }
  return g;
}

// projectPx is also re-exported here so consumers don't need a separate
// import for the simplest of the screen-space helpers.
export { projectPx };
