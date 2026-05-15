// Editor scene orchestrator. Stateless — given a project, view,
// hover/selection, and an optional StitchSequence, builds the SVG by
// composing per-layer renderers from the sibling files:
//
//   grid.ts   — three-tier coordinate grid
//   scene.ts  — segments / points / manual thread / hover crosshair
//
// Replaces the SVG children on every render (cheap for our scale; ~ a few
// hundred nodes). Imperative DOM rather than diff/patch — callers can
// re-render on every store change without worrying about partial updates.
//
// "Touchable" = inside the hoop in Y AND inside the X-limit in X. Drawn
// as a bright fabric rect; everywhere outside is the wrap bg, reading as
// the "out of bounds" zone. The grid extends across both, so the contrast
// between fabric and wrap bg IS the hoop / X-limit boundary — no separate
// guide overlay needed.

import './render.css';
import { svgEl } from '../../svgDom.js';
import { foot } from '../../../creator/foot.js';
import { PER_RECORD_JUMP_CAP_MM, STITCH_DY_MAX_MM } from '../../../creator/sh7Limits.js';
import { chainEndPointId, isStartLocked, startXMmOf } from '../../../creator/project.js';
import { footWidthMmForFoot } from '../preview/constants.js';
import {
  FOOT_BODY_HEIGHT_MM,
  FOOT_SLOT_HEIGHT_MM,
} from '../preview/scene.js';
import { currentManualFrame } from '../../../creator/manualStitch.js';
import type { Point, Project } from '../../../creator/types.js';
import type { StitchSequence } from '../../../creator/pipeline/stitch.js';
import type { Selection } from '../store/uiStore.js';
import type { View } from './view.js';
import { renderGrid } from './grid.js';
import {
  renderHover,
  renderManualThread,
  renderPoint,
  renderSegment,
  type HoverHoop,
} from './scene.js';

export type { HoverHoop } from './scene.js';

export interface EditorInteractionState {
  tool: 'select' | 'add' | 'move' | 'pan';
  /**
   * Active stitch kind from the toolbar — drives the live-window
   * overlay shape in manual mode (needle = ±3 mm carriage band,
   * jump = ±1 mm needle band). Other values disable the overlay.
   */
  activeStitch: 'straight' | 'satin' | 'needle' | 'jump';
}

export function renderEditorScene(
  svg: SVGSVGElement,
  project: Project,
  view: View,
  hoverHoop: HoverHoop | null,
  /**
   * Current selection from uiStore (segment id, point id, or manual-satin
   * idx — discriminated by kind). The renderer lights segments and points
   * when their id matches the selection. Manual-satin selection has no
   * visual representation in the current renderer (the inspector handles
   * it via the peek); selection by kind keeps the data shape uniform so a
   * future ed-manual-satin selected style can be added without touching
   * every reader.
   */
  selection: Selection | null,
  /**
   * Pre-computed StitchSequence for the project. Required for manual-mode
   * projects (so the editor can draw the thread line + drop markers);
   * ignored for design-mode projects, which derive everything from
   * points + segments. Caller passes `sequenceFromProject(project)`.
   */
  seq?: StitchSequence,
  /**
   * Tool + active stitch kind — drives the live-window overlay
   * (visible only when `tool === 'add'` and the project is manual).
   */
  interaction?: EditorInteractionState,
  /**
   * Object URL for `project.bg.blob`. Caller owns the lifecycle
   * (URL.createObjectURL on bg change, URL.revokeObjectURL on bg
   * replace/remove) so the renderer doesn't leak URLs across redraws.
   * Null when the project has no bg, or when the caller has not yet
   * produced a URL for the current blob.
   */
  bgObjectUrl?: string | null,
): void {
  // Wipe and rebuild — simple and reliable at our scale.
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // SVG accessible name. Screen readers announce <title> as the
  // primary name source (more reliable than aria-label across
  // NVDA/JAWS/VoiceOver); we also attach role/aria-labelledby on the
  // svg root so axe sees a complete naming chain.
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-labelledby', 'canvas-title');
  // The live region (#canvas-announce, sibling in index.html) is
  // updated by editor/keyboard.ts on selection / nudge so screen
  // readers hear "Point 3 of 12, x 12.5 mm, y 5.3 mm". Wiring it via
  // aria-describedby gives the canvas the description relationship
  // even before any nudge has been announced.
  svg.setAttribute('aria-describedby', 'canvas-announce');
  if (svg.tabIndex < 0) svg.tabIndex = 0;
  const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  titleEl.id = 'canvas-title';
  titleEl.textContent = `Stitch editor canvas — ${project.points.length} point${project.points.length === 1 ? '' : 's'}, ${project.segments.length} segment${project.segments.length === 1 ? '' : 's'}`;
  svg.appendChild(titleEl);

  const halfW = project.hoop.halfW;
  const H = project.hoop.h;
  const f = foot(project.suggestedFoot);
  const xLim = f.carriageReachHalfMm;
  const touchableHalfW = Math.min(xLim, halfW);
  const { zoom, offsetX, offsetY } = view;

  const px = (mmX: number, mmY: number) => ({
    x: mmX * zoom + offsetX,
    y: mmY * zoom + offsetY,
  });

  // 1. Touchable fabric — only the area where stitches can physically land
  // (intersection of hoop Y-bounds and X-limit). Everything outside this
  // rect is wrap bg, and the contrast IS the boundary.
  const hoop = svgEl('rect', {
    x: offsetX - touchableHalfW * zoom,
    y: offsetY,
    width: touchableHalfW * 2 * zoom,
    height: H * zoom,
  }, ['ed-hoop']);
  svg.appendChild(hoop);

  // 1b. Live needle / jump window — visible only when manual mode + Add
  // tool is active. Tells the user where the next click can actually
  // land. The band slides as the carriage moves (Foot S jumps) and
  // tightens to the ±1 mm jump envelope when the Jump tool is selected.
  // Y is clipped to ±STITCH_DY_MAX_MM around the current needle Y so the
  // band reflects the per-record firmware envelope on both axes.
  if (
    project.mode === 'manual' &&
    interaction?.tool === 'add' &&
    (interaction.activeStitch === 'needle' || interaction.activeStitch === 'jump')
  ) {
    const frame = currentManualFrame(project);
    const half =
      interaction.activeStitch === 'jump' ? PER_RECORD_JUMP_CAP_MM : f.needleSlotHalfMm;
    const center = interaction.activeStitch === 'jump' ? frame.needleXMm : frame.carriageXMm;
    // Clip to the hoop halfW / hoop H so the band doesn't extend off the fabric.
    const xMin = Math.max(-touchableHalfW, center - half);
    const xMax = Math.min(touchableHalfW, center + half);
    const yMin = Math.max(0, frame.needleYMm - STITCH_DY_MAX_MM);
    const yMax = Math.min(H, frame.needleYMm + STITCH_DY_MAX_MM);
    if (xMax > xMin && yMax > yMin) {
      svg.appendChild(svgEl('rect', {
        x: offsetX + xMin * zoom,
        y: offsetY + yMin * zoom,
        width: (xMax - xMin) * zoom,
        height: (yMax - yMin) * zoom,
      }, ['ed-needle-window', `kind-${interaction.activeStitch}`]));
    }
  }

  // 2. Background image (if any). Tagged with data-role so editorInteract
  // can pick up pointer-down events and drag the image around — easier
  // than nudging X/Y number inputs in the sidebar. When the user has
  // locked the bg via the sidebar, the data-role is dropped so clicks
  // pass through to the canvas (and the cursor goes back to the tool's
  // default).
  if (project.bg && bgObjectUrl) {
    const bg = project.bg;
    const g = svgEl('g', {
      transform: `translate(${offsetX + bg.x * zoom} ${offsetY + bg.y * zoom}) rotate(${bg.rotate})`,
      ...(bg.locked ? {} : { 'data-role': 'bg-image' }),
    }, bg.locked ? ['ed-bg', 'ed-bg-locked'] : ['ed-bg']);
    const img = svgEl('image', {
      href: bgObjectUrl,
      width: bg.scale * 100 * zoom,
      opacity: bg.opacity,
    });
    g.appendChild(img);
    svg.appendChild(g);
  }

  // 3. Grid + axis labels. Extends past the hoop on both axes so the
  // out-of-bounds wrap-bg area shows the same coordinate scaffolding as
  // the fabric.
  svg.appendChild(renderGrid(halfW, H, zoom, offsetX, offsetY));

  // Project ids that should light up: only 'segment' / 'point' selections
  // resolve to a canvas id. Manual-satin selection has no visual
  // representation in the renderer today, so the dispatch collapses to
  // a single nullable id.
  const selectedSegId = selection?.kind === 'segment' ? selection.id : null;
  const selectedPtId = selection?.kind === 'point' ? selection.id : null;

  // 4. Segments.
  const byId = new Map<string, Point>();
  for (const p of project.points) byId.set(p.id, p);
  const lastSegIdx = project.segments.length - 1;
  for (let i = 0; i < project.segments.length; i++) {
    const seg = project.segments[i]!;
    const a = byId.get(seg.from);
    const b = byId.get(seg.to);
    if (!a || !b) continue;
    svg.appendChild(renderSegment(seg, a, b, px, selectedSegId === seg.id, i === lastSegIdx));
  }

  // 5. Points (drawn on top of segments). The "end" marker tracks the chain
  // tail (last segment's to-endpoint) — NOT the last entry in points[], which
  // can be a midpoint orphan after a subdivide.
  const endPointId = chainEndPointId(project);
  for (let i = 0; i < project.points.length; i++) {
    const point = project.points[i]!;
    const isFirst = i === 0;
    const isLast = !isFirst && point.id === endPointId;
    const isSelected = selectedPtId === point.id;
    const sp = px(point.x, point.y);
    svg.appendChild(renderPoint(point, sp, isFirst, isLast, isSelected));
  }

  // 5b. Manual-mode thread + drop markers. The editor doesn't author
  // segments in manual mode, so the canvas would otherwise be empty
  // — walk the StitchSequence and draw a connecting line per stitch
  // pair plus a marker per non-start stitch. Jump segments render
  // dashed (CSS) so the user can visually distinguish stitches that
  // sew thread from carriage walks that don't.
  if (project.mode === 'manual' && seq && seq.length > 1) {
    svg.appendChild(renderManualThread(seq, px));
  }

  // 5c. Start marker — drawn as a presser-foot shape matching the
  // preview's visual language so the user immediately recognises that
  // this is where the carriage sits when the design loads. The body
  // rect + inner slot rect mirror renderFoot() in sceneMotif.ts; the
  // hover <title> doubles as a built-in tooltip ("Carriage start
  // position…"). Drag handling lives in editor/interact.ts via
  // data-role="start-marker"; the store invariant (lockStartXMm)
  // silently reverts attempted drags once the start is locked.
  const startX = startXMmOf(project);
  const startLocked = isStartLocked(project);
  const chainAnchorY = project.points[0]?.y ?? 0;
  const startPx = px(startX, chainAnchorY);
  const startG = svgEl('g', {
    'data-role': 'start-marker',
    'data-locked': startLocked ? 'true' : 'false',
    transform: `translate(${startPx.x} ${startPx.y})`,
  }, ['ed-start-marker', ...(startLocked ? ['ed-start-marker-locked'] : [])]);
  // Native browser tooltip on hover, and the same string is exposed to
  // screen readers via `<title>` (the SVG accessibility convention).
  const startTooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  startTooltip.textContent = startLocked
    ? `Carriage start: X = ${startX.toFixed(2)} mm. Locked — manual-mode designs freeze the start once the first stitch is placed.`
    : `Carriage start: X = ${startX.toFixed(2)} mm. Drag to move the carriage's design-start position.`;
  startG.appendChild(startTooltip);
  // Foot body + inner slot, geometry-identical to the preview foot so
  // the icon reads the same in both modes. Scaled by editor zoom; body
  // dimensions come from the active foot's body width (Foot S 20 mm,
  // Foot B 16 mm) and the shared FOOT_BODY_HEIGHT_MM = 8 mm.
  const bodyWidthMm = footWidthMmForFoot(project.suggestedFoot);
  const bodyW = bodyWidthMm * zoom;
  const bodyH = FOOT_BODY_HEIGHT_MM * zoom;
  const slotW = f.needleSlotHalfMm * 2 * zoom;
  const slotH = FOOT_SLOT_HEIGHT_MM * zoom;
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
  svg.appendChild(startG);

  // 6. Hover crosshair + target dot.
  if (hoverHoop) {
    svg.appendChild(renderHover(hoverHoop, halfW, H, zoom, offsetX, offsetY));
  }

  // Stash some attributes useful for tests.
  svg.dataset['halfW'] = String(halfW);
  svg.dataset['hoopH'] = String(H);
}
