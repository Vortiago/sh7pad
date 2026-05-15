// Generic bottom-sheet component. 3 states (closed / half / full) with
// drag-to-resize via PointerEvent + setPointerCapture. Non-modal (canvas
// stays interactive while the sheet is open) — Q8 decision.
//
// Exposes a small public surface (factory + tiny interface). Internal
// state machine and pointer-drag glue stay in sibling files.

import './bottomSheet.css';
import { type SheetState } from './state.js';
import { attachSheetDrag } from './drag.js';
import { tplFrom, slot } from '../dom.js';
import templateHtml from './bottomSheet.html?raw';

const templates = tplFrom(templateHtml);
const rootTpl = templates.content.querySelector<HTMLTemplateElement>('#bs-root')!;

let labelIdSeq = 0;

export interface BottomSheet {
  el: HTMLElement;
  setState(s: SheetState): void;
  getState(): SheetState;
  onStateChange(cb: (s: SheetState) => void): () => void;
  destroy(): void;
}

export interface BottomSheetOptions {
  /** Element re-hosted inside the sheet body. The sheet captures the
   *  element's pre-mount parent + nextSibling and, on destroy, returns
   *  it to that slot so callers don't have to stash/restore externally.
   *  If the element has no parent at mount time, destroy just leaves
   *  the body empty (no restore target to write to). */
  contentEl: HTMLElement;
  /** Visible heading inside an sr-only landmark, plus aria-labelledby
   *  target. */
  label: string;
  /** State the sheet snaps to when its controller pill is tapped. */
  defaultOpen?: 'half' | 'full';
}

export function createBottomSheet(
  host: HTMLElement,
  opts: BottomSheetOptions,
): BottomSheet {
  const labelId = `bs-label-${++labelIdSeq}`;
  // role=dialog + aria-modal=false is the disclosable-content pattern
  // recognized by NVDA/VoiceOver. We don't trap focus (Q8).
  const root = rootTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  root.setAttribute('aria-labelledby', labelId);

  const handle = slot<HTMLButtonElement>(root, 'handle');
  handle.setAttribute('aria-label', `Resize ${opts.label} sheet`);

  const heading = slot(root, 'heading');
  heading.id = labelId;
  heading.textContent = opts.label;

  // Capture where contentEl lived before we moved it into the sheet
  // body. Restored on destroy so callers swapping sheets in/out of
  // their DOM (e.g. responsive controller swapping desktop ↔ phone)
  // don't have to stash parent/nextSibling themselves.
  const contentOriginalParent = opts.contentEl.parentElement;
  const contentOriginalNext = opts.contentEl.nextSibling;

  slot(root, 'body').appendChild(opts.contentEl);

  let state: SheetState = 'closed';
  const listeners = new Set<(s: SheetState) => void>();

  function applyState(next: SheetState): void {
    if (next === state) return;
    state = next;
    root.dataset['sheetState'] = next;
    for (const cb of listeners) cb(next);
  }

  // Snap-on-release drag, see ./drag.ts. Future polish could track
  // the handle position during pointermove for a rubber-band feel.
  const detachDrag = attachSheetDrag({
    handle,
    getState: () => state,
    setState: applyState,
  });

  host.appendChild(root);

  return {
    el: root,
    setState: applyState,
    getState: () => state,
    onStateChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      listeners.clear();
      detachDrag();
      // Return contentEl to its pre-mount slot so the host DOM is
      // exactly where the caller found it. Skip when contentEl wasn't
      // in a parent at mount time (the standalone test path).
      if (contentOriginalParent) {
        contentOriginalParent.insertBefore(opts.contentEl, contentOriginalNext);
      }
      root.remove();
    },
  };
}

export type { SheetState } from './state.js';
