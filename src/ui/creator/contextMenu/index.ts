// Floating context menu opened by long-press on the canvas (Q12) and
// by the appBar overflow ⋮. A thin builder over DialogBase: builds the
// items list and hands it to the shared native-<dialog> + showModal
// plumbing in popover (anchored) mode. The base owns Esc, backdrop
// click, single-instance, and viewport-clamped positioning; this file
// owns "what's in the menu."

import './contextMenu.css';
import { createDialogBase, type DialogBase } from '../modals/DialogBase.js';

export type ContextMenuItem =
  | {
    /** Default — clickable button. */
    kind?: 'action';
    label: string;
    /** data-action attribute on the button — for tests + analytics. */
    action: string;
    /** Run on click. The menu closes itself afterward. */
    onClick(): void;
    /** Optional destructive flag — paints the action red. */
    danger?: boolean;
  }
  | {
    /** Read-only label (e.g. project stats). Renders as a non-focusable
     *  text row so screen readers don't announce a fake button. */
    kind: 'text';
    label: string;
    /** data-action attribute for tests. */
    action: string;
  };

export interface ContextMenuOptions {
  /** Anchor in viewport coords (clientX/clientY). Menu positions
   *  itself near this point, clamped to the viewport. */
  anchorX: number;
  anchorY: number;
  /** Visible heading inside an sr-only landmark + aria-labelledby. */
  label: string;
  /** 1+ items. Empty array = no menu (caller should not call). */
  items: ContextMenuItem[];
}

let labelIdSeq = 0;

export function showContextMenu(opts: ContextMenuOptions): void {
  if (opts.items.length === 0) return;
  // Single-instance: tear down any open menu first. (DialogBase also
  // checks by componentTag, but tearing down explicitly lets a second
  // showContextMenu replace the first rather than no-op.)
  hideContextMenu();

  const labelId = `cm-label-${++labelIdSeq}`;
  const base: DialogBase = createDialogBase({
    className: 'cm-root',
    componentTag: 'context-menu',
    ariaLabelledBy: labelId,
    anchor: { x: opts.anchorX, y: opts.anchorY },
  });

  const heading = document.createElement('h2');
  heading.id = labelId;
  heading.className = 'sr-only';
  heading.textContent = opts.label;
  base.dialog.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'cm-list';
  for (const item of opts.items) {
    if (item.kind === 'text') {
      const row = document.createElement('div');
      row.className = 'cm-item cm-item-text';
      row.dataset['action'] = item.action;
      row.textContent = item.label;
      list.appendChild(row);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-item';
    if (item.danger) btn.classList.add('danger');
    btn.dataset['action'] = item.action;
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      // Item callbacks close the menu explicitly — that's an action,
      // not a cancel, so we use base.close() rather than letting the
      // base's onCancel fire.
      item.onClick();
      base.close();
    });
    list.appendChild(btn);
  }
  base.dialog.appendChild(list);

  base.open();
}

export function hideContextMenu(): void {
  document.querySelectorAll('dialog.cm-root').forEach((el) => el.remove());
}
