// Preview pane orchestrator. Stateless — given a project + current step
// + container size, builds the SVG by composing per-layer renderers
// from the sibling files:
//
//   sceneFabric  — woven cloth background
//   sceneMotif   — presser foot + X-limit guides + history + repeats
//   sceneThread  — visible thread + per-stitch punctures + needle
//
// scene.ts holds the shared types (ScreenView, PreviewView, PreviewOptions),
// the auto-fit math (computeScreenView), and the small colour helpers.
// The transport (play/pause/scrub) is in transport.ts; the animation
// loop lives in main.ts and calls renderPreviewScene each tick.

import './preview.css';
import { svgEl } from '../../svgDom.js';
import { safeSequenceFromProject as sequenceFromProject } from '../../../creator/pipeline/encodeDesign.js';
import { trackFoot } from '../../../creator/pipeline/trackFoot.js';
import { foot } from '../../../creator/foot.js';
import type { Project } from '../../../creator/types.js';
import {
  DEFAULT_NEEDLE_NM, DEFAULT_THREAD_MM, DEFAULT_BG_COLOR, DEFAULT_THREAD_COLOR,
  footWidthMmForFoot,
} from './constants.js';
import {
  computeScreenView,
  mixColor,
  projectPx,
  type PreviewView,
} from './scene.js';
import { renderFabricBackground } from './sceneFabric.js';
import {
  renderFoot,
  renderMotifHistory,
  renderMotifRepeats,
  renderXLimitGuides,
} from './sceneMotif.js';
import {
  renderNeedleMarker,
  renderRealisticThread,
} from './sceneThread.js';

export type { PreviewView } from './scene.js';

export interface PreviewOptions {
  needleSizeNm: number;
  threadDiameterMm: number;
  footWidthMm?: number;
  /**
   * Show one "history" iteration of the motif above the active one — the
   * stitches the machine made on the previous chunk replay, so the active
   * motif visually flows out of completed work. Default: true.
   */
  showHistory?: boolean;
  /**
   * Show the stylized presser foot at the start of the active motif. When
   * hidden, the foot reserve is reclaimed and the motif fills more of the
   * canvas. Default: true.
   */
  showFoot?: boolean;
  /**
   * User pan offset in screen pixels, applied on top of the auto-fit view.
   * Mirrors the editor's camera so middle/right/Alt-drag in the preview
   * shifts the entire scene (foot, threads, axis, X-limit guides). Default
   * is no offset.
   */
  pan?: { x: number; y: number };
  /**
   * Hex color of the visible thread (#rrggbb). The outline is derived from
   * it (mixed with black) so dark/light user colors both stay legible.
   * Default: DEFAULT_THREAD_COLOR.
   */
  threadColor?: string;
  /**
   * Hex color of the fabric background (#rrggbb). Used as the base for the
   * woven cloth pattern; weft/warp shades are derived by mixing with white
   * and black. Default: DEFAULT_BG_COLOR.
   */
  bgColor?: string;
}

export function renderPreviewScene(
  svg: SVGSVGElement,
  project: Project,
  step: number,
  container: PreviewView,
  userZoom: number = 1,
  options: PreviewOptions = { needleSizeNm: DEFAULT_NEEDLE_NM, threadDiameterMm: DEFAULT_THREAD_MM },
): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const drops = sequenceFromProject(project);
  const showHistory = options.showHistory ?? true;
  const showFoot = options.showFoot ?? true;
  const pan = options.pan ?? { x: 0, y: 0 };
  const view = computeScreenView(drops, container, userZoom, showHistory, showFoot, pan);
  const visible = drops.slice(0, step);
  const footWidthMm = options.footWidthMm ?? footWidthMmForFoot(project.suggestedFoot);
  const threadColor = options.threadColor ?? DEFAULT_THREAD_COLOR;
  const bgColor = options.bgColor ?? DEFAULT_BG_COLOR;

  // Apply user-picked thread color via CSS custom properties so the existing
  // .real-thread / .thread-outline rules can fall back to the app defaults
  // when no color is set. Outline is derived (mixed with black) so it stays
  // legible against both light and dark thread choices.
  svg.style.setProperty('--threadColor', threadColor);
  svg.style.setProperty('--threadOutlineColor', mixColor(threadColor, '#000000', 0.55));

  // 0. Fabric background — drawn first so everything else sits on top of it.
  svg.appendChild(renderFabricBackground(container, bgColor, view.zoom, pan));

  // 1. X=0 axis (always visible).
  svg.appendChild(svgEl('line', {
    x1: view.xAxis, y1: view.yTop, x2: view.xAxis, y2: view.yBot,
  }, ['x-axis']));

  // 2. X-limit guides — drawn at the active foot's mechanical reach.
  svg.appendChild(renderXLimitGuides(foot(project.suggestedFoot).carriageReachHalfMm, view));

  if (drops.length === 0) {
    svg.appendChild(svgEl('g', {}, ['pv-empty']));
    return;
  }

  // 3 & 4. Surrounding motif iterations — the future repeats below the
  // active motif and the previous iteration above. Both are "example
  // stitches around the current one", so a single toggle gates both: when
  // off, only the active motif renders, and the auto-fit reclaims the
  // reserved space (see computeScreenView).
  if (showHistory) {
    svg.appendChild(renderMotifRepeats(drops, view, container, options.threadDiameterMm, threadColor, bgColor));
    svg.appendChild(renderMotifHistory(drops, view, options.threadDiameterMm, threadColor, bgColor));
  }

  // 5. Active motif's visible thread (realistic three-layer rendering).
  svg.appendChild(renderRealisticThread(visible, view, options.threadDiameterMm, threadColor, bgColor));

  // 6. Presser foot — drawn AFTER threads so it covers any history thread
  // that approaches the foot from above (fabric goes UNDER the foot). The
  // foot is a translucent body centred on the virtual carriage X and the
  // current needle Y, with an inner 6 mm needle window. Foot B and Foot S
  // share the same render path; only the body width differs (S is a wider
  // side-motion foot, B is the narrower decorative foot). Both feet now have
  // a real carriage range (Foot B ±4.5 mm, Foot S ±27.25 mm), so trackFoot
  // is foot-agnostic and the same frame drives the foot on both.
  if (showFoot && drops.length > 0) {
    const track = trackFoot(drops);
    // The needle marker is rendered at drops[step − 1] (the *currently
    // visible* stitch); the foot frame must come from the same index so
    // the slot's vertical center sits on the needle. Off-by-one here
    // caused visible "foot ahead of needle" misalignment at every
    // feature transition (#stitch-25-26 in user's Stitch 10 design).
    const idx = Math.max(step - 1, 0);
    const clamped = Math.min(idx, track.length - 1);
    const frame = track[clamped]!;
    const slotWidthMm = foot(project.suggestedFoot).needleSlotHalfMm * 2;
    svg.appendChild(
      renderFoot(view, frame.carriageXMm, frame.needleYMm, footWidthMm, slotWidthMm),
    );
  }

  // 7. Start indicator on top of the foot.
  const startSp = projectPx(drops[0]!, view);
  const startG = svgEl('g', {}, ['start-indicator']);
  startG.appendChild(svgEl('circle', {
    cx: startSp.x, cy: startSp.y, r: 5, fill: 'none',
  }, ['start-halo']));
  svg.appendChild(startG);

  // 8. Needle marker — current drop position.
  if (step > 0) {
    const cur = visible[visible.length - 1]!;
    const cp = projectPx(cur, view);
    svg.appendChild(renderNeedleMarker(cp.x, cp.y, options.needleSizeNm, view.zoom));
  }
}
