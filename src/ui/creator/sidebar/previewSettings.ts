// Preview Settings section — needle / thread / colours / display
// toggles. Visible in preview mode only; sidebar.ts decides whether
// to mount this based on state.mode.
//
// Surgical-update model: previewSettingsControls builds the inputs
// once. syncPreviewSettingsControls reuses the existing inputs and
// only writes the values that drift from the latest state — never
// replaceChildren, never recreate inputs. This preserves the colour-
// picker dialog identity across `input` events while the user
// explores colours, and frees the sidebar's auto-subscription from
// having to special-case focus or last-tap detection.

import { appBtn, el, textEl } from '../dom.js';
import { NEEDLE_SIZES_NM, THREAD_OPTIONS } from '../preview/constants.js';
import type { PreviewSettingsState, SidebarCallbacks } from './sidebar.js';

export function previewSettingsControls(
  state: PreviewSettingsState,
  cb: SidebarCallbacks,
): HTMLDivElement {
  const wrap = el('div', 'sb-preview-controls') as HTMLDivElement;

  // Needle size — physical machine needle (NM/100 = mm shaft).
  wrap.appendChild(rawSelectRow(
    'Needle', 'needle', String(state.needleSizeNm),
    NEEDLE_SIZES_NM.map((nm) => ({ value: String(nm), label: String(nm) })),
    (v) => cb.onPreviewNeedleChange?.(Number(v)),
  ));

  // Thread weight — wt / Tex / mm diameter.
  wrap.appendChild(rawSelectRow(
    'Thread', 'thread', String(state.threadDiameterMm),
    THREAD_OPTIONS.map((o) => ({ value: String(o.mm), label: o.label })),
    (v) => cb.onPreviewThreadChange?.(Number(v)),
  ));

  // Thread colour picker.
  wrap.appendChild(colorRow(
    'Thread color', 'thread-color', state.threadColor,
    (v) => cb.onPreviewThreadColorChange?.(v),
  ));

  // Fabric colour picker.
  wrap.appendChild(colorRow(
    'Fabric', 'bg-color', state.bgColor,
    (v) => cb.onPreviewBgColorChange?.(v),
  ));

  // Display toggles. The toggle button's onClick closure captures the
  // pressed-at-build-time state, but syncPreviewSettingsControls
  // re-binds these listeners on every sync so the latest state is
  // always reflected when the user clicks.
  wrap.appendChild(toggleRow(
    'Show repeats', 'toggle-history', state.showHistory,
    () => cb.onPreviewToggleHistory?.(!state.showHistory),
  ));
  wrap.appendChild(toggleRow(
    'Show foot', 'toggle-foot', state.showFoot,
    () => cb.onPreviewToggleFoot?.(!state.showFoot),
  ));

  return wrap;
}

/**
 * Reuse the existing preview-settings DOM and only update the values
 * that disagree with the latest state. The toggle-history /
 * toggle-foot buttons have their onClick listener re-bound because the
 * closure captures the previous "pressed" boolean.
 *
 * Returns true if the existing DOM could be reused (every control
 * present), false otherwise — the caller falls back to a full rebuild.
 */
export function syncPreviewSettingsControls(
  region: HTMLElement,
  state: PreviewSettingsState,
  cb: SidebarCallbacks,
): boolean {
  const needle = region.querySelector<HTMLSelectElement>('select[data-action="needle"]');
  const thread = region.querySelector<HTMLSelectElement>('select[data-action="thread"]');
  const threadColor = region.querySelector<HTMLInputElement>('input[data-action="thread-color"]');
  const bgColor = region.querySelector<HTMLInputElement>('input[data-action="bg-color"]');
  const historyBtn = region.querySelector<HTMLButtonElement>('[data-action="toggle-history"]');
  const footBtn = region.querySelector<HTMLButtonElement>('[data-action="toggle-foot"]');
  if (!needle || !thread || !threadColor || !bgColor || !historyBtn || !footBtn) {
    return false;
  }

  // Selects + colour inputs: only write `.value` when the latest store
  // value differs from what the input already holds. Skipping the
  // write keeps the colour picker's "user is exploring" state intact
  // (some browsers reset selection / scrollTop on a value re-assign).
  const needleStr = String(state.needleSizeNm);
  if (needle.value !== needleStr) needle.value = needleStr;
  const threadStr = String(state.threadDiameterMm);
  if (thread.value !== threadStr) thread.value = threadStr;
  if (threadColor.value !== state.threadColor) threadColor.value = state.threadColor;
  if (bgColor.value !== state.bgColor) bgColor.value = state.bgColor;

  rebindToggle(historyBtn, state.showHistory, () => cb.onPreviewToggleHistory?.(!state.showHistory));
  rebindToggle(footBtn, state.showFoot, () => cb.onPreviewToggleFoot?.(!state.showFoot));
  return true;
}

function rebindToggle(btn: HTMLButtonElement, pressed: boolean, onClick: () => void): void {
  btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  btn.textContent = pressed ? 'On' : 'Off';
  // Replace the click listener: the previous closure captured the
  // stale `pressed` boolean and would toggle in the wrong direction.
  // Cloning the node is simpler than tracking listeners, and it
  // preserves the node's identity for selectors elsewhere — but it
  // DOES blow away child nodes (we re-create the textContent above)
  // and the existing data-action attribute carries over via the clone.
  const fresh = btn.cloneNode(true) as HTMLButtonElement;
  fresh.addEventListener('click', onClick);
  btn.replaceWith(fresh);
}

function rawSelectRow(
  label: string,
  action: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (v: string) => void,
): HTMLDivElement {
  const wrap = el('div', 'sb-bg-row') as HTMLDivElement;
  const lbl = textEl('label', 'sb-bg-lbl', label) as HTMLLabelElement;
  lbl.htmlFor = `sb-${action}`;
  wrap.appendChild(lbl);
  const sel = document.createElement('select');
  sel.id = `sb-${action}`;
  sel.dataset['action'] = action;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

function colorRow(
  label: string,
  action: string,
  value: string,
  onChange: (v: string) => void,
): HTMLDivElement {
  const wrap = el('div', 'sb-bg-row') as HTMLDivElement;
  const lbl = textEl('label', 'sb-bg-lbl', label) as HTMLLabelElement;
  lbl.htmlFor = `sb-${action}`;
  wrap.appendChild(lbl);
  const input = document.createElement('input');
  input.type = 'color';
  input.id = `sb-${action}`;
  input.dataset['action'] = action;
  input.className = 'sb-color';
  input.value = value;
  // Use 'input' so the canvas updates live while the native picker is open.
  input.addEventListener('input', () => onChange(input.value));
  wrap.appendChild(input);
  return wrap;
}

function toggleRow(
  label: string,
  action: string,
  pressed: boolean,
  onClick: () => void,
): HTMLDivElement {
  const wrap = el('div', 'sb-bg-row') as HTMLDivElement;
  wrap.appendChild(textEl('span', 'sb-bg-lbl', label));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset['action'] = action;
  btn.className = appBtn('sb-btn-toggle');
  btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  btn.textContent = pressed ? 'On' : 'Off';
  btn.addEventListener('click', onClick);
  wrap.appendChild(btn);
  return wrap;
}
