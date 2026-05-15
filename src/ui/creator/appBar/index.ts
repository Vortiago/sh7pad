// Phone-only top app bar. Hosts the mode segmented control (Edit |
// Preview) and an overflow menu (rulers toggle, stats, About).
// Mounted by the responsive controller at ≤639px; absent on tablet/desktop.
//
// The mode segmented control mirrors uiStore.mode and calls setMode
// (the same callback the modeSwitch component uses on desktop). The
// overflow menu lives in ./overflowMenu.ts.

import './appBar.css';
import { hideContextMenu } from '../contextMenu/index.js';
import { openOverflowMenu } from './overflowMenu.js';
import type { Mode } from '../modeSwitch/index.js';
import type { UiStore } from '../store/uiStore.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import { tplFrom, slot, action } from '../dom.js';
import templateHtml from './appBar.html?raw';

const templates = tplFrom(templateHtml);
const rootTpl = templates.content.querySelector<HTMLTemplateElement>('#ab-root')!;
const modeBtnTpl = templates.content.querySelector<HTMLTemplateElement>('#ab-mode-btn')!;

export interface AppBarOptions {
  uiStore: UiStore;
  setMode(next: Mode): void;
  /** Re-uses the existing disclaimer modal so we don't duplicate the
   *  copy. The sidebar's "About this project" link calls the same. */
  onShowDisclaimer(): void;
  /** Optional projectStore — when present, the overflow menu surfaces
   *  the same point/segment/hoop stats string the desktop toolbar
   *  shows in `.ed-right` (Q5: stats moved to overflow on phone). */
  projectStore?: ProjectStore;
}

export interface AppBar {
  el: HTMLElement;
  destroy(): void;
}

export function createAppBar(host: HTMLElement, opts: AppBarOptions): AppBar {
  // Mode segmented control. role=radiogroup for AT semantics.
  const root = rootTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const modeWrap = slot(root, 'mode-group');
  const editBtn = makeModeBtn('edit', 'Edit', opts);
  const previewBtn = makeModeBtn('preview', 'Preview', opts);
  modeWrap.appendChild(editBtn);
  modeWrap.appendChild(previewBtn);

  // Overflow menu trigger — implementation lives in ./overflowMenu.ts.
  const overflowBtn = action<HTMLButtonElement>(root, 'open-overflow');
  overflowBtn.addEventListener('click', () => {
    openOverflowMenu({
      trigger: overflowBtn,
      uiStore: opts.uiStore,
      projectStore: opts.projectStore,
      onShowDisclaimer: opts.onShowDisclaimer,
    });
  });

  // Reflect current mode via uiStore subscription so external mode
  // changes (keyboard 1/2 shortcut, sidebar) keep the segmented
  // control in sync. Per WAI-ARIA radiogroup pattern, only the active
  // radio is in the tab sequence; inactive ones get tabindex=-1 and
  // are reached via arrow keys.
  function syncMode(): void {
    const cur = opts.uiStore.getState().mode;
    const editActive = cur === 'edit';
    editBtn.setAttribute('aria-checked', editActive ? 'true' : 'false');
    previewBtn.setAttribute('aria-checked', editActive ? 'false' : 'true');
    editBtn.dataset['active'] = editActive ? 'true' : 'false';
    previewBtn.dataset['active'] = editActive ? 'false' : 'true';
    editBtn.tabIndex = editActive ? 0 : -1;
    previewBtn.tabIndex = editActive ? -1 : 0;
  }
  const offMode = opts.uiStore.subscribe(syncMode);
  syncMode();

  // Arrow-key navigation per WAI-ARIA radiogroup pattern (Q4 a11y).
  // Left/Up → previous, Right/Down → next, Home → first, End → last.
  // Moving focus also flips selection so the keyboard user reaches
  // the same end-state as a click.
  modeWrap.addEventListener('keydown', (ev) => {
    const cur = opts.uiStore.getState().mode;
    let next: Mode | null = null;
    switch (ev.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'Home':
        next = 'edit';
        break;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'End':
        next = 'preview';
        break;
      default:
        return;
    }
    ev.preventDefault();
    if (next === cur) return;
    opts.setMode(next);
    (next === 'edit' ? editBtn : previewBtn).focus();
  });

  host.appendChild(root);

  return {
    el: root,
    destroy() {
      offMode();
      hideContextMenu();
      root.remove();
    },
  };
}

function makeModeBtn(value: Mode, label: string, opts: AppBarOptions): HTMLButtonElement {
  const btn = modeBtnTpl.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
  btn.dataset['action'] = `set-mode-${value}`;
  btn.dataset['mode'] = value;
  btn.textContent = label;
  btn.addEventListener('click', () => opts.setMode(value));
  return btn;
}
