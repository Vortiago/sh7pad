// Segment inspector — bottom strip below the editor canvas. Shown when a
// segment, point, or manual-mode satin is selected; lets the user flip
// type and (for satin) tweak the taper widths.
//
// Re-render strategy: when called with the same target as last time,
// we patch the dynamic values (length, width labels) in place and leave
// the slider input elements alone. Tearing down the slider mid-drag would
// drop the pointer-capture and break the drag gesture, so the orchestrator
// freely re-renders on every store change without that side effect.
//
// Manual-mode satin segments live in `project.manualStitches` rather than
// `project.segments`, but conceptually they are the same satin object,
// so the inspector accepts a discriminated target and both authoring
// paths drive identical width / endAt controls through one shared
// `appendSatinControls` helper. The Type selector and Subdivide button
// are segment-only (manual satin has no straight counterpart, and no
// shared endpoints to split between).
//
// Points (the chain anchors) get their own minimal render: id, coords,
// and a Delete button (disabled for the start anchor, which is locked
// at X=0 by the chain invariant). Selecting a point in edit mode opens
// this strip so single-tap on a point gives the same tap-to-action
// affordance as single-tap on a segment.
//
// Markup lives in segmentInspector.html as named <template>s.

import './segmentInspector.css';
import type {
  ManualSatinSegment,
  Project,
  SatinSegment,
  SatinEndAt,
  Segment,
} from '../../../creator/types.js';
import type { ManualSatinPatch } from '../../../creator/manualStitch.js';
import { SATIN_WIDTH_MAX_MM, SATIN_WIDTH_MIN_MM } from '../../../creator/sh7Limits.js';
import { mmLabel, slot, tplFrom } from '../dom.js';
import templateHtml from './segmentInspector.html?raw';
import type { Selection } from '../store/uiStore.js';

export type SegmentPatch = Partial<Segment>;

/**
 * What the inspector is currently editing. Aliased to the same shape as
 * uiStore.Selection so writers + readers speak one vocabulary: callers
 * pass the selection straight through, the inspector dispatches on
 * `kind`.
 */
export type InspectorTarget = Selection;

export type OnChange = (target: InspectorTarget, patch: SegmentPatch | ManualSatinPatch) => void;
export type OnSubdivide = (segmentId: string) => void;
export type OnDelete = (target: InspectorTarget) => void;
export type OnDeletePoint = (pointId: string) => void;

export interface InspectorCallbacks {
  onChange: OnChange;
  onSubdivide: OnSubdivide;
  onDelete: OnDelete;
  onDeletePoint: OnDeletePoint;
}

// Slider bounds mirror the encoder's firmware-needle-window envelope (see
// SATIN_WIDTH_MIN_MM / SATIN_WIDTH_MAX_MM in sh7Limits.ts) so the user
// can't author a cone the export step is going to refuse.
export const SATIN_WIDTH_MIN = SATIN_WIDTH_MIN_MM;
export const SATIN_WIDTH_MAX = SATIN_WIDTH_MAX_MM;
export const SATIN_WIDTH_STEP = 0.1;

const templates = tplFrom(templateHtml);
const tplBy = (id: string): HTMLTemplateElement =>
  templates.content.querySelector<HTMLTemplateElement>(`#${id}`)!;
const segMetaTpl = tplBy('insp-segment-meta');
const manualMetaTpl = tplBy('insp-manual-meta');
const pointMetaTpl = tplBy('insp-point-meta');
const typeRowTpl = tplBy('insp-type-row');
const endAtRowTpl = tplBy('insp-endat-row');
const sliderRowTpl = tplBy('insp-slider-row');
const subdivideBtnTpl = tplBy('insp-subdivide-btn');
const deleteBtnTpl = tplBy('insp-delete-btn');
const deletePointBtnTpl = tplBy('insp-delete-point-btn');

function clone<T extends HTMLElement>(tpl: HTMLTemplateElement): T {
  return tpl.content.firstElementChild!.cloneNode(true) as T;
}

// Patch-vs-rebuild fast path: each renderer stashes the identity of its
// current target in its own dataset slot (`data-segment-id`, `data-point-id`,
// `data-manual-idx`). On the next render we rebuild only when the slot's
// value changes; otherwise we patch the dynamic labels in place and leave
// the slider DOM untouched so mid-drag pointer capture survives. The slots
// are kept disjoint so switching kinds is a clean rebuild rather than a
// stale-attr trap.

/** Reset the inspector root for a fresh render of `slot=value`: wipe
 *  children, clear every kind slot, then set this kind's slot. Used by
 *  the three per-kind renderers below so the slot-bookkeeping reads as
 *  one line instead of four. */
function rebuildRoot(
  root: HTMLElement,
  kindSlot: 'segmentId' | 'pointId' | 'manualIdx',
  value: string,
): void {
  root.replaceChildren();
  delete root.dataset['segmentId'];
  delete root.dataset['segmentType'];
  delete root.dataset['pointId'];
  delete root.dataset['manualIdx'];
  root.dataset[kindSlot] = value;
  root.classList.add('ed-inspector');
}

export function renderSegmentInspector(
  root: HTMLElement,
  project: Project,
  selected: InspectorTarget | null,
  callbacks: InspectorCallbacks,
): void {
  if (!selected) {
    clearInspector(root);
    return;
  }
  switch (selected.kind) {
    case 'manual-satin': {
      renderManualSatin(root, project, selected, callbacks);
      return;
    }
    case 'segment': {
      const seg = project.segments.find((s) => s.id === selected.id);
      if (seg) {
        renderDesignSegment(root, project, seg, callbacks);
        return;
      }
      clearInspector(root);
      return;
    }
    case 'point': {
      const pt = project.points.find((p) => p.id === selected.id);
      if (pt) {
        renderPointInspector(root, project, pt, callbacks.onDeletePoint);
        return;
      }
      clearInspector(root);
      return;
    }
  }
}

function renderDesignSegment(
  root: HTMLElement,
  project: Project,
  seg: Segment,
  callbacks: InspectorCallbacks,
): void {
  const { onChange, onSubdivide, onDelete } = callbacks;

  const a = project.points.find((p) => p.id === seg.from);
  const b = project.points.find((p) => p.id === seg.to);
  const len = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;

  // Same id AND same type as last render: patch values, leave slider DOM
  // alone so an in-flight drag gesture keeps its pointer-capture. A type
  // flip (straight<->satin) changes the row set the template produces, so
  // it must fall through to the full rebuild rather than patch in place.
  if (root.dataset['segmentId'] === seg.id && root.dataset['segmentType'] === seg.type) {
    patchInspectorValues(root, len, seg.type === 'satin' ? seg : undefined);
    return;
  }
  rebuildRoot(root, 'segmentId', seg.id);
  root.dataset['segmentType'] = seg.type;

  const meta = clone(segMetaTpl);
  slot(meta, 'id').textContent = seg.id;
  slot(meta, 'len').textContent = mmLabel(len);
  const importedNote = slot(meta, 'imported');
  if (seg.imported) importedNote.hidden = false;
  else importedNote.remove();
  root.appendChild(meta);

  const typeWrap = clone(typeRowTpl);
  const typeSel = typeWrap.querySelector<HTMLSelectElement>('select[data-control="type"]')!;
  typeSel.value = seg.type;
  const target: Selection = { kind: 'segment', id: seg.id };
  typeSel.addEventListener('change', () => {
    const newType = typeSel.value as 'straight' | 'satin';
    if (newType === seg.type) return;
    if (newType === 'satin') {
      onChange(target, { type: 'satin', widthStart: 2.4, widthEnd: 2.4, density: 0.6 } as Partial<SatinSegment>);
    } else {
      onChange(target, { type: 'straight' });
    }
  });
  root.appendChild(typeWrap);

  if (seg.type === 'satin') {
    appendSatinControls(root, seg, (patch) => onChange(target, patch as Partial<SatinSegment>));
  }

  // Subdivide splits the segment in half — useful for breaking up a long
  // straight into shorter ones the machine can sew without stretching.
  const subdivideBtn = clone<HTMLButtonElement>(subdivideBtnTpl);
  subdivideBtn.addEventListener('click', () => onSubdivide(seg.id));
  root.appendChild(subdivideBtn);

  root.appendChild(deleteButton('Remove this segment from the chain', () => onDelete(target)));
}

function renderManualSatin(
  root: HTMLElement,
  project: Project,
  target: { kind: 'manual-satin'; idx: number },
  callbacks: InspectorCallbacks,
): void {
  const { onChange, onDelete } = callbacks;
  const entry = project.manualStitches[target.idx];
  if (!entry || entry.kind !== 'satin') {
    clearInspector(root);
    return;
  }

  const len = Math.hypot(entry.toX - entry.x, entry.toY - entry.y);
  const idxStr = String(target.idx);

  if (root.dataset['manualIdx'] === idxStr) {
    patchInspectorValues(root, len, entry);
    return;
  }
  rebuildRoot(root, 'manualIdx', idxStr);

  const meta = clone(manualMetaTpl);
  slot(meta, 'id').textContent = `#${target.idx + 1}`;
  slot(meta, 'len').textContent = mmLabel(len);
  root.appendChild(meta);

  appendSatinControls(root, entry, (patch) => onChange(target, patch));

  // Manual mode is append-only: only the last manual-satin
  // can be removed. Hide the Delete affordance entirely on mid-list
  // entries so the user never sees a button that won't fire.
  if (target.idx === project.manualStitches.length - 1) {
    root.appendChild(deleteButton('Remove this satin segment', () => onDelete(target)));
  }
}

/** Append the satin-only width / endAt controls. Both authoring paths
 *  route their patches through `onPatch` so the inspector stays the
 *  single source of truth for what the controls do. */
function appendSatinControls(
  root: HTMLElement,
  sat: { widthStart: number; widthEnd: number; endAt?: SatinEndAt },
  onPatch: (patch: ManualSatinPatch) => void,
): void {
  root.appendChild(buildSlider(
    'W START', 'widthStart', sat.widthStart,
    SATIN_WIDTH_MIN, SATIN_WIDTH_MAX, SATIN_WIDTH_STEP,
    (v) => onPatch({ widthStart: v }),
  ));
  root.appendChild(buildSlider(
    'W END', 'widthEnd', sat.widthEnd,
    SATIN_WIDTH_MIN, SATIN_WIDTH_MAX, SATIN_WIDTH_STEP,
    (v) => onPatch({ widthEnd: v }),
  ));
  root.appendChild(endAtSelector(sat.endAt, (v) => onPatch({ endAt: v })));
}

function deleteButton(title: string, onClick: () => void): HTMLButtonElement {
  const btn = clone<HTMLButtonElement>(deleteBtnTpl);
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

function clearInspector(root: HTMLElement): void {
  root.replaceChildren();
  delete root.dataset['segmentId'];
  delete root.dataset['segmentType'];
  delete root.dataset['pointId'];
  delete root.dataset['manualIdx'];
}

/** Update the in-place value labels without touching slider DOM. When
 *  `sat` is undefined the row carries no satin sliders (a straight
 *  segment), so only the length cell needs refreshing. */
function patchInspectorValues(
  root: HTMLElement,
  len: number,
  sat: { widthStart: number; widthEnd: number } | ManualSatinSegment | SatinSegment | undefined,
): void {
  const lenSpan = root.querySelector<HTMLElement>('[data-value="len"]');
  if (lenSpan) lenSpan.textContent = mmLabel(len);
  if (!sat) return;
  patchSliderRow(root, 'widthStart', sat.widthStart);
  patchSliderRow(root, 'widthEnd', sat.widthEnd);
}

function patchSliderRow(root: HTMLElement, control: string, value: number): void {
  const input = root.querySelector<HTMLInputElement>(`input[data-control="${control}"]`);
  if (input && document.activeElement !== input) {
    input.value = String(value);
  }
  const valSpan = root.querySelector<HTMLElement>(`[data-value="${control}"]`);
  if (valSpan) valSpan.textContent = mmLabel(value);
}

function endAtSelector(
  current: SatinEndAt | undefined,
  onInput: (v: SatinEndAt) => void,
): HTMLDivElement {
  const wrap = clone<HTMLDivElement>(endAtRowTpl);
  const sel = wrap.querySelector<HTMLSelectElement>('select[data-control="endAt"]')!;
  sel.value = current ?? 'right';
  sel.addEventListener('change', () => onInput(sel.value as SatinEndAt));
  return wrap;
}

function buildSlider(
  label: string,
  control: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
): HTMLDivElement {
  const wrap = clone<HTMLDivElement>(sliderRowTpl);
  const inputId = `ed-insp-slider-${control}`;
  const lblEl = slot<HTMLLabelElement>(wrap, 'label');
  lblEl.textContent = label;
  lblEl.htmlFor = inputId;
  const input = slot<HTMLInputElement>(wrap, 'input');
  input.id = inputId;
  input.setAttribute('aria-label', label);
  input.dataset['control'] = control;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  const valSpan = slot(wrap, 'val');
  valSpan.dataset['value'] = control;
  valSpan.dataset['testid'] = `inspector-${control}-value`;
  valSpan.textContent = mmLabel(Number(value));
  return wrap;
}

function renderPointInspector(
  root: HTMLElement,
  project: Project,
  pt: { id: string; x: number; y: number },
  onDeletePoint: OnDeletePoint,
): void {
  const isStart = project.points[0]?.id === pt.id;
  // Same fast path as segment: skip rebuild when re-rendering the same
  // selection (e.g. on every uiStore tick during a hover).
  if (root.dataset['pointId'] === pt.id) return;
  rebuildRoot(root, 'pointId', pt.id);

  const meta = clone(pointMetaTpl);
  slot(meta, 'id').textContent = pt.id;
  slot(meta, 'coords').textContent = `(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) mm`;
  const startNote = slot(meta, 'start-note');
  if (isStart) startNote.hidden = false;
  else startNote.remove();
  root.appendChild(meta);

  const deleteBtn = clone<HTMLButtonElement>(deletePointBtnTpl);
  deleteBtn.disabled = isStart;
  deleteBtn.title = isStart
    ? "The chain's start point is fixed and can't be removed"
    : 'Remove this point from the chain';
  deleteBtn.addEventListener('click', () => onDeletePoint(pt.id));
  root.appendChild(deleteBtn);
}
