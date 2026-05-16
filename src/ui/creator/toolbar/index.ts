// Editor toolbar: tool buttons (Add/Move/Pan), stitch type, zoom controls,
// point/segment count display. Project-wide settings (Suggested Foot,
// Thread Tension) live in the sidebar.
//
// The Stitch group adapts to project.mode:
//   • design mode  → Straight / Satin (segment authoring).
//   • manual mode  → Needle / Satin / Jump (direct stitch placement). Both
//                    feet support jumps within their carriage range
//                    (Foot B ±4.5 mm, Foot S ±27.25 mm); the per-stitch
//                    1 mm dx envelope is enforced by validateManualStitch.
//
// Markup lives in toolbar.html.

import './toolbar.css';
import type { Project } from '../../../creator/types.js';
import { tplFrom } from '../dom.js';
import templateHtml from './toolbar.html?raw';
import type { Tool } from '../editor/interact.js';

export type StitchKind = 'straight' | 'satin' | 'needle' | 'jump';

export interface ToolbarState {
  tool: Tool;
  activeStitch: StitchKind;
  project: Project;
}

export type ZoomAction = 'in' | 'out' | 'reset';

export interface ToolbarCallbacks {
  onTool(tool: Tool): void;
  onStitch(kind: StitchKind): void;
  onZoom(action: ZoomAction): void;
  /**
   * Switch the project's encoder mode. Design-mode-only: manual projects
   * have already chosen their stitches, so this callback is never invoked
   * from manual mode (the toolbar doesn't render the toggle there).
   */
  onEncoderMode(mode: 'compact' | 'uniform'): void;
}

const templates = tplFrom(templateHtml);
const tplBy = (id: string): HTMLTemplateElement =>
  templates.content.querySelector<HTMLTemplateElement>(`#${id}`)!;
const toolgroupTpl = tplBy('tb-toolgroup');
const toolgroupRightTpl = tplBy('tb-toolgroup-right');
const tlblTpl = tplBy('tb-tlbl');
const toolBtnTpl = tplBy('tb-tool-btn');
const stitchBtnTpl = tplBy('tb-stitch-btn');
const encoderBtnTpl = tplBy('tb-encoder-btn');
const zoomBtnTpl = tplBy('tb-zoom-btn');

function clone<T extends HTMLElement>(tpl: HTMLTemplateElement): T {
  return tpl.content.firstElementChild!.cloneNode(true) as T;
}

function tlbl(text: string): HTMLSpanElement {
  const span = clone<HTMLSpanElement>(tlblTpl);
  span.textContent = text;
  return span;
}

export function renderToolbar(
  root: HTMLElement,
  state: ToolbarState,
  cb: ToolbarCallbacks,
): void {
  root.replaceChildren();
  root.classList.add('ed-toolbar');

  // Tool group. Move is design-only — manual stitches are append-only
  //, so dragging an entry would lie about the editor's
  // capability.
  const toolGrp = clone<HTMLDivElement>(toolgroupTpl);
  toolGrp.appendChild(toolBtn('▣ Select', 'select', state.tool === 'select', () => cb.onTool('select')));
  toolGrp.appendChild(toolBtn('+ Add', 'add', state.tool === 'add', () => cb.onTool('add')));
  if (state.project.mode === 'design') {
    toolGrp.appendChild(toolBtn('↔ Move', 'move', state.tool === 'move', () => cb.onTool('move')));
  }
  toolGrp.appendChild(toolBtn('✋ Pan', 'pan', state.tool === 'pan', () => cb.onTool('pan')));
  root.appendChild(toolGrp);

  // Stitch type group.
  const stitchGrp = clone<HTMLDivElement>(toolgroupTpl);
  stitchGrp.appendChild(tlbl('STITCH'));
  for (const opt of stitchOptionsForProject(state.project)) {
    stitchGrp.appendChild(stitchBtn(opt.label, opt.kind, state.activeStitch === opt.kind, () => cb.onStitch(opt.kind)));
  }
  root.appendChild(stitchGrp);

  // Encoder-mode group. Design-only: it controls how segments get sliced
  // into needle drops, and manual projects don't go through that path
  // (manualSequence in encodeDesign.ts emits user-placed stitches
  // verbatim). Sits next to STITCH because it's the natural follow-on
  // question after "what kind of stitch am I authoring?".
  if (state.project.mode === 'design') {
    const encGrp = clone<HTMLDivElement>(toolgroupTpl);
    encGrp.appendChild(tlbl('DENSITY'));
    const current = state.project.encoderMode ?? 'compact';
    encGrp.appendChild(encoderBtn('Compact', 'compact', current === 'compact', () => cb.onEncoderMode('compact')));
    encGrp.appendChild(encoderBtn('Uniform', 'uniform', current === 'uniform', () => cb.onEncoderMode('uniform')));
    root.appendChild(encGrp);
  }

  // Zoom group — visible button affordance for users without a scroll wheel.
  const zoomGrp = clone<HTMLDivElement>(toolgroupTpl);
  zoomGrp.appendChild(tlbl('ZOOM'));
  zoomGrp.appendChild(zoomBtn('−', 'out', 'Zoom out', () => cb.onZoom('out')));
  zoomGrp.appendChild(zoomBtn('⊙', 'reset', 'Reset zoom', () => cb.onZoom('reset')));
  zoomGrp.appendChild(zoomBtn('+', 'in', 'Zoom in', () => cb.onZoom('in')));
  root.appendChild(zoomGrp);

  // Stats group (right-aligned).
  const right = clone<HTMLDivElement>(toolgroupRightTpl);
  const stats = tlbl(
    `${state.project.points.length} pts · ${state.project.segments.length} seg · ±${state.project.hoop.halfW}×${state.project.hoop.h}mm`,
  );
  stats.dataset['testid'] = 'toolbar-stats';
  right.appendChild(stats);
  root.appendChild(right);
}

interface StitchOption { kind: StitchKind; label: string }

/**
 * Which stitch-kind buttons to render for the active project.
 * Exported for callers that need to normalize ui.activeStitch when the
 * active project changes (e.g. design→manual switch on project swap).
 */
export function stitchOptionsForProject(project: Project): readonly StitchOption[] {
  if (project.mode === 'manual') {
    return [
      { kind: 'needle', label: 'Needle' },
      { kind: 'satin', label: 'Satin' },
      { kind: 'jump', label: 'Jump' },
    ];
  }
  return [
    { kind: 'straight', label: 'Straight' },
    { kind: 'satin', label: 'Satin' },
  ];
}

/**
 * If `current` isn't a valid stitch kind for the project (e.g. 'straight'
 * on a manual project, or 'jump' on Foot B), return the project's default
 * first option. Otherwise return `current` unchanged.
 */
export function normalizeActiveStitch(project: Project, current: StitchKind): StitchKind {
  const opts = stitchOptionsForProject(project);
  if (opts.some((o) => o.kind === current)) return current;
  return opts[0]!.kind;
}

/**
 * Demote `current` to a tool the project's toolbar still surfaces. Move
 * is design-only (manual stitches are append-only), so any
 * stored 'move' on a manual project collapses to 'select'. Mirrors
 * `normalizeActiveStitch` — callers invoke this on project mode switch
 * so the UI and `ui.tool` stay in sync.
 */
export function normalizeTool(project: Project, current: Tool): Tool {
  if (project.mode === 'manual' && current === 'move') return 'select';
  return current;
}

function toolBtn(label: string, tool: Tool, active: boolean, onClick: () => void): HTMLButtonElement {
  const btn = clone<HTMLButtonElement>(toolBtnTpl);
  btn.dataset['tool'] = tool;
  btn.dataset['active'] = active ? 'true' : 'false';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function stitchBtn(label: string, kind: StitchKind, active: boolean, onClick: () => void): HTMLButtonElement {
  const btn = clone<HTMLButtonElement>(stitchBtnTpl);
  btn.dataset['stitch'] = kind;
  btn.dataset['active'] = active ? 'true' : 'false';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function encoderBtn(
  label: string,
  mode: 'compact' | 'uniform',
  active: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = clone<HTMLButtonElement>(encoderBtnTpl);
  btn.dataset['mode'] = mode;
  btn.dataset['active'] = active ? 'true' : 'false';
  btn.setAttribute('aria-pressed', String(active));
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function zoomBtn(label: string, action: ZoomAction, title: string, onClick: () => void): HTMLButtonElement {
  const btn = clone<HTMLButtonElement>(zoomBtnTpl);
  btn.dataset['zoom'] = action;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
