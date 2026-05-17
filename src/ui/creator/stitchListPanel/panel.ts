// Stitch list — visible in BOTH edit and preview modes.
// One row per segment, plus a START row at the top. Uses the Creator's
// segment data model: human-readable mm coords + per-segment metadata.
//
// Click in edit mode → select that segment in the editor.
// Click in preview mode → jump preview to the last drop of that segment.
// Both wirings live in main.ts; the panel only emits row IDs.
//
// Markup for the chrome (title + collapse button) and the row templates
// (empty / start / segment / manual / delete button) lives in
// stitchListPanel.html alongside this file.

import './stitchListPanel.css';
import type { ManualStitchInput, Point, Project, SatinSegment, Segment } from '../../../creator/types.js';
import { safeSequenceFromProject as sequenceFromProject } from '../../../creator/pipeline/encodeDesign.js';
import { pointById } from '../../../creator/project.js';
import { manualRowId } from '../rowIdMapping.js';
import { mmLabel, slot, tplFrom } from '../dom.js';
import templateHtml from './stitchListPanel.html?raw';

// 'start', a numeric string ('0', '1', …) for a design segment, or a
// 'm{idx}' string for a manual stitch (e.g. 'm0', 'm1').
export type RowId = 'start' | string;

export interface StitchListCallbacks {
  onSelect(row: RowId): void;
  onDeleteSegment?(segmentId: string): void;
  /**
   * Remove the last manual stitch. Manual mode is append-only:
   * only the tail entry is removable, so the panel renders a trash
   * button only on the last manual row and fires this callback with no
   * arguments.
   */
  onDeleteLastManual?(): void;
}

const templates = tplFrom(templateHtml);
const chromeTitleTpl = templates.content.querySelector<HTMLTemplateElement>('#sl-chrome-title')!;
const chromeCollapseTpl = templates.content.querySelector<HTMLTemplateElement>('#sl-chrome-collapse')!;
const emptyTpl = templates.content.querySelector<HTMLTemplateElement>('#sl-empty')!;
const startTpl = templates.content.querySelector<HTMLTemplateElement>('#sl-start')!;
const rowTpl = templates.content.querySelector<HTMLTemplateElement>('#sl-row')!;

const cloneRow = (): HTMLLIElement =>
  rowTpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;

// Renders the right-panel header (title + collapse toggle). Kept separate
// from the list itself so the existing renderStitchListPanel(ol, …)
// callers don't need to know about the chrome.
export function renderStitchListChrome(
  headerEl: HTMLElement,
  _opts: { collapsed: boolean },
  cb: { onToggleCollapse: () => void },
): void {
  headerEl.replaceChildren();
  headerEl.appendChild(
    chromeTitleTpl.content.firstElementChild!.cloneNode(true) as HTMLElement,
  );
  const btn = chromeCollapseTpl.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
  btn.addEventListener('click', () => cb.onToggleCollapse());
  headerEl.appendChild(btn);
}

export function renderStitchListPanel(
  ol: HTMLOListElement,
  project: Project,
  cb: StitchListCallbacks,
): void {
  ol.replaceChildren();
  const isManual = project.mode === 'manual';
  const isEmpty = isManual
    ? project.manualStitches.length === 0
    : project.points.length === 0 ||
      (project.segments.length === 0 && project.points.length <= 1);
  if (isEmpty) {
    const empty = emptyTpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    empty.textContent = isManual
      ? 'No stitches yet — click in the editor to place one.'
      : 'No stitches yet — add points in the editor.';
    ol.appendChild(empty);
    return;
  }

  const startPt = project.points[0];
  if (startPt) ol.appendChild(startRow(startPt));

  if (isManual) {
    const lastIdx = project.manualStitches.length - 1;
    for (let i = 0; i < project.manualStitches.length; i++) {
      const li = manualRow(project.manualStitches[i]!, i, i === lastIdx);
      if (i === lastIdx) li.classList.add('kind-last');
      ol.appendChild(li);
    }
  } else {
    const byId = pointById(project.points);
    const lastIdx = project.segments.length - 1;
    // The unified carriage planner can emit a mix of needle and jump
    // records per straight segment under any foot — Foot B's narrower
    // ±4.5 mm reach just bounds it sooner. Surface the kind on each row
    // so the user can tell at a glance which segments walk the carriage.
    const stitchKindBySegment = computeSegmentStitchKinds(project);
    for (let i = 0; i < project.segments.length; i++) {
      const seg = project.segments[i]!;
      const from = byId.get(seg.from);
      const to = byId.get(seg.to);
      if (!from || !to) continue;
      const li = segmentRow(seg, from, to, i, stitchKindBySegment?.[i]);
      if (i === lastIdx) li.classList.add('kind-last');
      ol.appendChild(li);
    }
  }

  ol.onclick = (e) => {
    const target = e.target as HTMLElement | null;
    const deleteBtn = target?.closest<HTMLButtonElement>('button[data-action="delete"]');
    if (deleteBtn) {
      // Trash button: fire delete, don't propagate to row select.
      e.stopPropagation();
      // Manual trash buttons are only rendered on the last row, so
      // they always mean "pop the tail". Segment trash buttons carry
      // their segment id.
      if (deleteBtn.dataset['manual'] === 'true') {
        cb.onDeleteLastManual?.();
        return;
      }
      const segId = deleteBtn.dataset['segId'];
      if (segId) cb.onDeleteSegment?.(segId);
      return;
    }
    const li = target?.closest<HTMLLIElement>('li[data-row]');
    if (li) cb.onSelect(li.dataset['row'] as RowId);
  };
}

function startRow(_p: Point): HTMLLIElement {
  return startTpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
}

function segmentRow(
  seg: Segment,
  from: Point,
  to: Point,
  idx: number,
  stitchKinds: SegmentStitchKinds | undefined,
): HTMLLIElement {
  const li = cloneRow();
  li.dataset['row'] = String(idx);
  li.dataset['segId'] = seg.id;
  li.classList.add(`kind-${seg.type}`);
  if (seg.imported) li.classList.add('imported');
  const num = String(idx + 1).padStart(2, '0');
  if (seg.type === 'satin') {
    const sat = seg as SatinSegment;
    slot(li, 'label').textContent = `#${num} satin  ${sat.widthStart.toFixed(1)}→${sat.widthEnd.toFixed(1)}mm`;
  } else {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const suffix = stitchKindSuffix(stitchKinds);
    slot(li, 'label').textContent = `#${num} straight  ${mmLabel(len)}${suffix}`;
  }
  const del = slot<HTMLButtonElement>(li, 'delete');
  del.dataset['segId'] = seg.id;
  del.title = 'Delete this segment';
  del.setAttribute('aria-label', 'Delete this segment');
  return li;
}

interface SegmentStitchKinds {
  needles: number;
  jumps: number;
}

/**
 * Walk the project's StitchSequence and tally how many needle vs jump
 * stitches the planner emitted per segment. Returns one entry per segment
 * keyed by segment index. Used by the stitch-list panel so Foot S rows
 * can surface "needle" / "jump" alongside the segment length.
 */
function computeSegmentStitchKinds(project: Project): SegmentStitchKinds[] {
  const out: SegmentStitchKinds[] = project.segments.map(() => ({ needles: 0, jumps: 0 }));
  const seq = sequenceFromProject(project);
  for (const s of seq) {
    if (s.kind === 'start') continue;
    const segIdx = s.sourceIndex;
    if (segIdx < 0 || segIdx >= out.length) continue;
    if (s.kind === 'jump') out[segIdx]!.jumps++;
    else if (s.kind === 'needle') out[segIdx]!.needles++;
  }
  return out;
}

function stitchKindSuffix(kinds: SegmentStitchKinds | undefined): string {
  if (!kinds) return '';
  const { needles, jumps } = kinds;
  if (needles === 0 && jumps === 0) return '';
  if (jumps > 0 && needles === 0) {
    return `  · ${jumps} jump${jumps === 1 ? '' : 's'}`;
  }
  if (needles > 0 && jumps === 0) {
    return `  · ${needles} needle${needles === 1 ? '' : 's'}`;
  }
  return `  · ${needles} needle${needles === 1 ? '' : 's'} + ${jumps} jump${jumps === 1 ? '' : 's'}`;
}

function manualRow(stitch: ManualStitchInput, idx: number, isLast: boolean): HTMLLIElement {
  const li = cloneRow();
  li.dataset['row'] = manualRowId(idx);
  li.dataset['manualIdx'] = String(idx);
  li.classList.add('kind-manual', `kind-${stitch.kind}`);
  const num = String(idx + 1).padStart(2, '0');
  const kindLabel = stitch.kind === 'needle' ? 'Needle' : stitch.kind === 'jump' ? 'Jump' : 'Satin';
  const detail = stitch.kind === 'satin'
    ? `(${stitch.x.toFixed(1)}, ${stitch.y.toFixed(1)}) → (${stitch.toX.toFixed(1)}, ${stitch.toY.toFixed(1)})mm`
    : `(${stitch.x.toFixed(1)}, ${stitch.y.toFixed(1)})mm`;
  slot(li, 'label').textContent = `#${num} ${kindLabel}  ${detail}`;
  const del = slot<HTMLButtonElement>(li, 'delete');
  if (isLast) {
    del.dataset['manual'] = 'true';
    // Manual-satin segments author a whole cone (start + end + width +
    // density) so their delete copy reflects that; needle/jump rows are
    // individual stitches.
    const delTitle = stitch.kind === 'satin' ? 'Delete this satin segment' : 'Delete this stitch';
    del.title = delTitle;
    del.setAttribute('aria-label', delTitle);
  } else {
    // Manual mode is append-only — only the tail is
    // removable, so non-last rows have no trash affordance.
    del.remove();
  }
  return li;
}

/**
 * Highlight rows based on a "current row" identifier.
 *   currentRow === null   → all rows future (nothing highlighted yet)
 *   currentRow === 'start' → start row is current; segments are future
 *   currentRow === N (number-as-string) → start + segments 0..N-1 are done,
 *     segment N is current, rest future.
 */
export function setCurrentRow(ol: HTMLOListElement, currentRow: RowId | null): void {
  const items = ol.querySelectorAll<HTMLLIElement>('li[data-row]');
  let pastCurrent = false;
  for (const li of items) {
    li.classList.remove('done', 'current', 'future');
    const row = li.dataset['row'] as RowId;
    if (currentRow == null) {
      li.classList.add('future');
      continue;
    }
    if (pastCurrent) {
      li.classList.add('future');
      continue;
    }
    if (row === currentRow) {
      li.classList.add('current');
      pastCurrent = true;
      if (typeof li.scrollIntoView === 'function') {
        li.scrollIntoView({ block: 'nearest' });
      }
    } else {
      li.classList.add('done');
    }
  }
}
