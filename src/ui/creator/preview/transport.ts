// Preview transport row: play/pause/scrub + speed + X/Y readout + zoom.
// All state comes from the orchestrator (which owns the playback controller
// from src/ui/playback.ts).
//
// Simulation-only knobs (needle, thread, colours, history/foot toggles)
// live in the sidebar's Preview Settings section so this bar stays slim
// on narrow browser windows.
//
// Two render entry points:
//   - renderPreviewTransport(root, state, cb): builds the full DOM, wires
//     listeners. Call once per "structural" change (play↔pause toggle,
//     totalSteps change, speed/zoom interactions).
//   - updatePreviewTransport(root, state): mutates ONLY the readouts that
//     change every playback tick (scrub value, percent, X/Y, speed label).
//     No replaceChildren, no listener re-attach — so a click that crosses
//     a tick boundary still lands on the same button DOM node.
// The orchestrator routes playback's onStep callback through the live
// updater; everything else triggers a full re-render.
//
// Markup lives in transport.html.

import './transport.css';
import { formatX } from '../../../creator/format.js';
import { tplFrom, slot } from '../dom.js';
import templateHtml from './transport.html?raw';

export interface TransportState {
  step: number;
  totalSteps: number;
  playing: boolean;
  speed: number;          // drops per second
  currentXmm: number;
  currentYmm: number;
}

export type ZoomAction = 'in' | 'out' | 'reset';

export interface TransportCallbacks {
  onPlay(): void;
  onPause(): void;
  onReset(): void;
  onStepBack(): void;
  onStepForward(): void;
  onToEnd(): void;
  onScrub(step: number): void;
  onSpeed(speed: number): void;
  onZoom(action: ZoomAction): void;
}

const templates = tplFrom(templateHtml);
const row1Tpl = templates.content.querySelector<HTMLTemplateElement>('#pv-tx-row1')!;
const row2Tpl = templates.content.querySelector<HTMLTemplateElement>('#pv-tx-row2')!;
const zoomBtnTpl = templates.content.querySelector<HTMLTemplateElement>('#pv-tx-zoom-btn')!;

function pctText(step: number, totalSteps: number): string {
  return totalSteps ? `${Math.round((step / totalSteps) * 100)}%` : '0%';
}

function xyText(xmm: number, ymm: number): string {
  return `X ${formatX(xmm)}  Y ${ymm.toFixed(1)}`;
}

export function renderPreviewTransport(
  root: HTMLElement,
  state: TransportState,
  cb: TransportCallbacks,
): void {
  root.replaceChildren();
  root.classList.add('pv-transport');

  // Row 1: transport buttons + scrub.
  const row1 = row1Tpl.content.firstElementChild!.cloneNode(true) as HTMLDivElement;

  wireButton(row1, 'reset', cb.onReset);
  wireButton(row1, 'step-back', cb.onStepBack);
  wireButton(row1, 'step-forward', cb.onStepForward);
  wireButton(row1, 'end', cb.onToEnd);

  // Play / phantom-opposite pair so the test selectors stay stable as the
  // user toggles between the two states.
  const play = slot<HTMLButtonElement>(row1, 'play');
  play.textContent = state.playing ? '❚❚' : '▶';
  play.dataset['action'] = state.playing ? 'pause' : 'play';
  play.addEventListener('click', state.playing ? cb.onPause : cb.onPlay);

  const opposite = slot<HTMLButtonElement>(row1, 'opposite');
  opposite.textContent = state.playing ? '▶' : '❚❚';
  opposite.dataset['action'] = state.playing ? 'play' : 'pause';
  opposite.addEventListener('click', state.playing ? cb.onPlay : cb.onPause);

  const scrub = slot<HTMLInputElement>(row1, 'scrub');
  scrub.max = String(state.totalSteps);
  scrub.value = String(state.step);
  scrub.addEventListener('input', () => cb.onScrub(Number(scrub.value)));
  slot(row1, 'pct').textContent = pctText(state.step, state.totalSteps);
  root.appendChild(row1);

  // Row 2: speed + X/Y readout + zoom controls. Slim by design — anything
  // set-once-and-forget belongs in the sidebar's Preview Settings.
  const row2 = row2Tpl.content.firstElementChild!.cloneNode(true) as HTMLDivElement;
  const speed = slot<HTMLInputElement>(row2, 'speed');
  speed.value = String(state.speed);
  speed.addEventListener('input', () => cb.onSpeed(Number(speed.value)));
  slot(row2, 'speed-val').textContent = `${state.speed}/s`;
  slot(row2, 'xy').textContent = xyText(state.currentXmm, state.currentYmm);

  row2.appendChild(zoomBtn('−', 'out', 'Zoom out', () => cb.onZoom('out')));
  row2.appendChild(zoomBtn('⊙', 'reset', 'Reset zoom', () => cb.onZoom('reset')));
  row2.appendChild(zoomBtn('+', 'in', 'Zoom in', () => cb.onZoom('in')));

  root.appendChild(row2);
}

// Mutates only the values that change every playback tick. The buttons,
// sliders' max bounds, and dropdowns stay put — so a click that started
// before this update will still land on the same DOM node.
export function updatePreviewTransport(root: HTMLElement, state: TransportState): void {
  const scrub = root.querySelector<HTMLInputElement>('[data-action="scrub"]');
  if (scrub) scrub.value = String(state.step);

  const pct = root.querySelector<HTMLElement>('.pv-tx-pct');
  if (pct) pct.textContent = pctText(state.step, state.totalSteps);

  const xy = root.querySelector<HTMLElement>('.pv-tx-xy');
  if (xy) xy.textContent = xyText(state.currentXmm, state.currentYmm);

  const speedVal = root.querySelector<HTMLElement>('.pv-tx-speed-val');
  if (speedVal) speedVal.textContent = `${state.speed}/s`;
}

function wireButton(row: HTMLElement, action: string, onClick: () => void): void {
  row.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!
    .addEventListener('click', onClick);
}

function zoomBtn(label: string, action: ZoomAction, title: string, onClick: () => void): HTMLButtonElement {
  const btn = zoomBtnTpl.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
  btn.dataset['zoom'] = action;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
