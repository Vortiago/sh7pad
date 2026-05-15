// Preview-scene shared types and small math/colour helpers used by
// the orchestrator (render.ts) and the per-layer renderers
// (sceneMotif.ts, sceneThread.ts, sceneFabric.ts). Splitting these out
// keeps each renderer file <200 LOC without each one having to
// re-derive ScreenView or projectPx.

import { motifOffsetMm, viewBbox } from '../../../creator/bbox.js';
import type { Stitch } from '../../../creator/pipeline/stitch.js';

export interface PreviewView {
  containerW: number;
  containerH: number;
}

export interface ScreenView {
  zoom: number;
  offsetX: number;
  offsetY: number;
  yTop: number;
  yBot: number;
  xAxis: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Y position (px) of the active motif's first drop on the canvas. */
  startY: number;
}

export const PADDING_PX = 16;
export const MARGIN_MM = 6;
// Reserve at the top of the canvas for the presser-foot rendering.
export const FOOT_RESERVE_PX = 60;
// Try to fit at least this many motif repeats vertically, so the stitch
// reads as a continuous run like on the machine display.
export const TARGET_REPEATS = 2;
// Cap repeats so the SVG doesn't grow without bound.
export const MAX_REPEATS = 8;

export const FOOT_BODY_HEIGHT_MM = 8;
export const FOOT_SLOT_HEIGHT_MM = 3;

export function computeScreenView(
  drops: readonly Stitch[],
  container: PreviewView,
  userZoom = 1,
  showHistory = true,
  showFoot = true,
  pan: { x: number; y: number } = { x: 0, y: 0 },
): ScreenView {
  const bbox = viewBbox(drops, MARGIN_MM);
  const viewW = bbox.maxX - bbox.minX;
  const viewH = bbox.maxY - bbox.minY;
  // Auto-fit so we can show several motifs vertically (true-to-life preview)
  // while still bounding by canvas width. Each repeat shifts the next motif
  // by |lastY−firstY| in mm (machine truth — see renderMotifRepeats), so
  // the vertical extent of N motifs is motifHeight + (N−1)·|dy|, NOT
  // N·motifHeight. Falls back to motifHeight when the chain is closed.
  // When the history iteration is enabled, budget another |dy| above so
  // the previous motif fits between the foot and the canvas edge.
  const footReserve = showFoot ? FOOT_RESERVE_PX : 0;
  const usableH = Math.max(50, container.containerH - PADDING_PX * 2 - footReserve);
  const fitW = (container.containerW - PADDING_PX * 2) / viewW;
  const stepMm = Math.abs(motifOffsetMm(drops).dy);
  // When the history toggle is off, neither the previous iteration above
  // nor the future repeats below render (see renderPreviewScene), so the
  // auto-fit only needs to budget the active motif's bbox.
  const aboveStepsMm = showHistory ? stepMm : 0;
  const repeatsBelow = showHistory ? Math.max(0, TARGET_REPEATS - 1) : 0;
  const stackedMm = viewH + aboveStepsMm + repeatsBelow * stepMm;
  const fitH = usableH / stackedMm;
  const fitZoom = Math.max(0.5, Math.min(fitW, fitH));
  const zoom = fitZoom * userZoom;
  // Pan shifts the entire scene in screen pixels: pan.x slides the X-axis
  // (and everything that derives from offsetX); pan.y slides startY, which
  // carries through to offsetY → yTop/yBot, so the foot, threads, and
  // X-limit guides translate together.
  const offsetX = (container.containerW - viewW * zoom) / 2 - bbox.minX * zoom + pan.x;
  // Anchor the active motif's first drop so its Y on the canvas lives just
  // below the foot reserve (the band reserved for the presser foot, plus
  // any history iteration above the foot). When the foot is hidden we
  // reclaim that reserve so the motif fills more of the canvas.
  const firstDropY = drops.length >= 1 ? drops[0]!.y : bbox.minY;
  const startY = PADDING_PX + aboveStepsMm * zoom + footReserve + pan.y;
  const offsetY = startY - firstDropY * zoom;
  return {
    zoom,
    offsetX,
    offsetY,
    xAxis: 0 * zoom + offsetX,
    yTop: bbox.minY * zoom + offsetY,
    yBot: bbox.maxY * zoom + offsetY,
    minX: bbox.minX,
    maxX: bbox.maxX,
    minY: bbox.minY,
    maxY: bbox.maxY,
    startY,
  };
}

export function projectPx(d: Stitch, view: ScreenView): { x: number; y: number } {
  return { x: d.x * view.zoom + view.offsetX, y: d.y * view.zoom + view.offsetY };
}

export function pathOf(drops: readonly Stitch[], view: ScreenView): string {
  if (drops.length === 0) return '';
  const parts = drops.map((d) => {
    const p = projectPx(d, view);
    return `${p.x} ${p.y}`;
  });
  return 'M ' + parts.join(' L ');
}

// Build an SVG path of just the segments whose end-stitch has the given
// kind. Consecutive same-kind segments are coalesced into a single
// `M…L L L…` sub-path so the path coord count matches the stitch count
// (each drop contributes one coord); a new M starts after every gap of
// other-kind records, so adjacent kinds don't smear into a continuous
// stroke. Returns the empty string when no stitches match (e.g.
// non-Foot-S sequences asking for jumps).
export function pathOfKind(
  drops: readonly Stitch[],
  view: ScreenView,
  kind: 'needle' | 'jump',
): string {
  const parts: string[] = [];
  let inRun = false;
  for (let i = 1; i < drops.length; i++) {
    if (drops[i]!.kind !== kind) {
      inRun = false;
      continue;
    }
    if (!inRun) {
      const a = projectPx(drops[i - 1]!, view);
      parts.push(`M ${a.x} ${a.y}`);
      inRun = true;
    }
    const b = projectPx(drops[i]!, view);
    parts.push(`L ${b.x} ${b.y}`);
  }
  return parts.join(' ');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  return {
    r: parseInt(m[1]!.slice(0, 2), 16),
    g: parseInt(m[1]!.slice(2, 4), 16),
    b: parseInt(m[1]!.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function mixColor(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return rgbToHex(
    ra.r * (1 - t) + rb.r * t,
    ra.g * (1 - t) + rb.g * t,
    ra.b * (1 - t) + rb.b * t,
  );
}
