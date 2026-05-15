// Preview scene — visible thread (3-layer realistic outline + body +
// highlight), per-stitch puncture markers, and the needle-tip marker
// at the current step. The motif-history and repeat copies of these
// renderings live in sceneMotif.ts but reuse renderStitchPunctures
// from here.

import { svgEl } from '../../svgDom.js';
import type { Stitch } from '../../../creator/pipeline/stitch.js';
import {
  mixColor,
  pathOf,
  pathOfKind,
  projectPx,
  type ScreenView,
} from './scene.js';

export function renderRealisticThread(
  drops: readonly Stitch[],
  view: ScreenView,
  threadDiameterMm: number,
  threadColor: string,
  bgColor: string,
): SVGGElement {
  const g = svgEl('g', {}, ['realistic-thread']);
  if (drops.length < 2) return g;
  const d = pathOf(drops, view);
  const threadPx = threadDiameterMm * view.zoom;
  const outlinePx = threadPx + Math.max(1.2, 0.10 * view.zoom);
  const highlightPx = Math.max(0.4, threadPx * 0.3);
  // Outline — darker silhouette behind the thread for legibility, drawn
  // continuously across the WHOLE path (needles + jumps). It also shows
  // through the gaps in the dashed jump overlay below, which is what
  // makes a same-color dashed line read as a dashed line.
  g.appendChild(svgEl('path', { d, 'stroke-width': outlinePx }, ['thread-outline']));
  // Thread body — split by record kind for Foot S so jumps can render
  // dashed (in the same color) without painting over them with a solid
  // body. Non-Foot-S sequences contain only needle stitches, so this
  // resolves to the full path and matches the pre-pipeline behavior.
  const needleD = pathOfKind(drops, view, 'needle') || d;
  const jumpD = pathOfKind(drops, view, 'jump');
  g.appendChild(svgEl('path', { d: needleD, 'stroke-width': threadPx }, ['real-thread']));
  if (jumpD) {
    g.appendChild(svgEl('path', { d: jumpD, 'stroke-width': threadPx }, ['real-thread-jump']));
  }
  // Highlight.
  g.appendChild(svgEl('path', {
    d, transform: 'translate(-0.3 -0.5)', 'stroke-width': highlightPx,
  }, ['real-highlight']));
  // Stitch punctures — a small darker dot at every drop so the thread reads
  // as discrete stitches rather than one continuous line. Painted on top of
  // the highlight so the puncture is the last thing drawn at each junction.
  g.appendChild(renderStitchPunctures(drops, view, threadDiameterMm, threadColor, bgColor));
  return g;
}

export function renderStitchPunctures(
  drops: readonly Stitch[],
  view: ScreenView,
  threadDiameterMm: number,
  threadColor: string,
  bgColor: string,
): SVGGElement {
  const g = svgEl('g', {}, ['stitch-punctures']);
  // Two-layer puncture so the marker stays visible against any thread
  // pick:
  //   • outer recess — a darker derivation of the thread color. Reads as
  //     a shadow at the puncture against light threads.
  //   • inner hole — the fabric color. Reads as the fabric peeking through
  //     against dark threads, where the recess alone would blend in.
  // Together they always have at least one of (recess, hole) high-contrast
  // against the thread. Sized slightly larger than the original single dot
  // so the puncture is easier to read at a glance.
  const recessR = threadDiameterMm * view.zoom * 0.65;
  const holeR = threadDiameterMm * view.zoom * 0.32;
  const recessFill = mixColor(threadColor, '#000000', 0.55);
  for (const d of drops) {
    const p = projectPx(d, view);
    g.appendChild(svgEl('circle', {
      cx: p.x, cy: p.y, r: recessR, fill: recessFill,
    }, ['stitch-puncture']));
    g.appendChild(svgEl('circle', {
      cx: p.x, cy: p.y, r: holeR, fill: bgColor,
    }, ['stitch-puncture-hole']));
  }
  return g;
}

export function renderNeedleMarker(
  x: number, y: number,
  needleSizeNm: number,
  viewZoom: number,
): SVGGElement {
  const g = svgEl('g', {}, ['needle-marker']);
  const shaftPx = (needleSizeNm / 100) * viewZoom;
  const halfTip = shaftPx / 2;
  g.appendChild(svgEl('circle', { cx: x, cy: y, r: 10, fill: 'none' }, ['needle-pulse']));
  g.appendChild(svgEl('line', {
    x1: x, y1: y - 22, x2: x, y2: y - halfTip,
    'stroke-width': shaftPx,
  }, ['needle-shaft']));
  g.appendChild(svgEl('polygon', {
    points: `${x - halfTip},${y - halfTip} ${x + halfTip},${y - halfTip} ${x},${y + halfTip}`,
  }, ['needle-tip']));
  g.appendChild(svgEl('circle', { cx: x, cy: y, r: Math.max(1.2, halfTip * 1.3) }, ['needle-dot']));
  return g;
}
