// @vitest-environment jsdom
// appBar — phone-only top bar exposing mode toggle + overflow menu.
// Tests verify mode segmented control mirrors uiStore.mode and that
// the overflow menu surfaces the rulers toggle.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppBar } from '../../ui/creator/appBar/index.js';
import { hideContextMenu } from '../../ui/creator/contextMenu/index.js';
import { createUiStore, defaultUiState } from '../../ui/creator/store/uiStore.js';
import { attachLayoutAttrs } from '../../ui/creator/store/attachLayoutAttrs.js';

function makeUi(): ReturnType<typeof createUiStore> {
  return createUiStore({ ...defaultUiState(), layout: 'phone' });
}

beforeEach(() => {
  document.body.innerHTML = '';
  // The rulers / mode flags now live in uiStore and are derived to
  // body.dataset by attachLayoutAttrs. When a test attaches the
  // derivation against a local uiStore that goes out of scope, the
  // last-written attrs linger on document.body across tests. Reset
  // them here so [data-mode='…'] / [data-active-tool='…'] selectors
  // can't pick up the body element instead of the test's buttons.
  delete document.body.dataset['mode'];
  delete document.body.dataset['activeTool'];
  delete document.body.dataset['leftCollapsed'];
  delete document.body.dataset['rightCollapsed'];
  delete document.body.dataset['rightAsSheet'];
  document.documentElement.classList.remove('ed-rulers-shown');
  hideContextMenu();
});

describe('createAppBar', () => {
  it('renders an Edit + Preview segmented control with role=radio', () => {
    const uiStore = makeUi();
    createAppBar(document.body, {
      uiStore,
      setMode: () => {},
      onShowDisclaimer: () => {},
    });
    const radios = document.querySelectorAll<HTMLButtonElement>('[role=radio]');
    expect(radios.length).toBe(2);
    expect(radios[0]!.textContent).toBe('Edit');
    expect(radios[1]!.textContent).toBe('Preview');
  });

  it('reflects the current mode via aria-checked + data-active', () => {
    const uiStore = makeUi();
    createAppBar(document.body, {
      uiStore, setMode: () => {}, onShowDisclaimer: () => {},
    });
    const editBtn = document.querySelector<HTMLButtonElement>('[data-action="set-mode-edit"]')!;
    expect(editBtn.getAttribute('aria-checked')).toBe('true');
    expect(editBtn.dataset['active']).toBe('true');
  });

  it('updates the segmented control when uiStore.mode flips externally', () => {
    const uiStore = makeUi();
    createAppBar(document.body, {
      uiStore, setMode: () => {}, onShowDisclaimer: () => {},
    });
    uiStore.update({ mode: 'preview' });
    const previewBtn = document.querySelector<HTMLButtonElement>('[data-action="set-mode-preview"]')!;
    expect(previewBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking the Preview pill calls setMode("preview")', () => {
    const uiStore = makeUi();
    const setMode = vi.fn();
    createAppBar(document.body, {
      uiStore, setMode, onShowDisclaimer: () => {},
    });
    const previewBtn = document.querySelector<HTMLButtonElement>('[data-action="set-mode-preview"]')!;
    previewBtn.click();
    expect(setMode).toHaveBeenCalledWith('preview');
  });

  it('overflow ⋮ button opens a menu with Show rulers (default hidden on phone) + About', () => {
    const uiStore = makeUi();
    createAppBar(document.body, {
      uiStore, setMode: () => {}, onShowDisclaimer: () => {},
    });
    const overflow = document.querySelector<HTMLButtonElement>('[data-action="open-overflow"]')!;
    overflow.click();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.cm-item'));
    const labels = items.map((i) => i.textContent);
    // Phone width: rulers default hidden, so the toggle reads "Show rulers".
    expect(labels).toContain('Show rulers');
    expect(labels).toContain('About this project');
  });

  it('Show rulers / Hide rulers toggles the .ed-rulers-shown html class', () => {
    const uiStore = makeUi();
    // The class flip is now a derived effect of uiStore.rulersShown
    // via attachLayoutAttrs — wire it in for this standalone test so
    // the html class still changes when the menu toggles the flag.
    attachLayoutAttrs(uiStore);
    createAppBar(document.body, {
      uiStore, setMode: () => {}, onShowDisclaimer: () => {},
    });
    document.querySelector<HTMLButtonElement>('[data-action="open-overflow"]')!.click();
    // First click: opt in to rulers on phone.
    document.querySelector<HTMLButtonElement>('[data-action="toggle-rulers"]')!.click();
    expect(document.documentElement.classList.contains('ed-rulers-shown')).toBe(true);
    // Second click: opt back out.
    document.querySelector<HTMLButtonElement>('[data-action="open-overflow"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="toggle-rulers"]')!.click();
    expect(document.documentElement.classList.contains('ed-rulers-shown')).toBe(false);
  });

  it('mode radios follow WAI-ARIA radiogroup pattern: only the active one is in the tab sequence', () => {
    const uiStore = makeUi();
    createAppBar(document.body, {
      uiStore,
      setMode: (m) => uiStore.update({ mode: m }),
      onShowDisclaimer: () => {},
    });
    const editBtn = document.querySelector<HTMLButtonElement>('[data-mode="edit"]')!;
    const previewBtn = document.querySelector<HTMLButtonElement>('[data-mode="preview"]')!;
    expect(editBtn.tabIndex).toBe(0);
    expect(previewBtn.tabIndex).toBe(-1);
    uiStore.update({ mode: 'preview' });
    expect(editBtn.tabIndex).toBe(-1);
    expect(previewBtn.tabIndex).toBe(0);
  });

  it('arrow keys move selection within the radiogroup', () => {
    const uiStore = makeUi();
    const setMode = vi.fn((m: 'edit' | 'preview') => uiStore.update({ mode: m }));
    createAppBar(document.body, {
      uiStore,
      setMode,
      onShowDisclaimer: () => {},
    });
    const group = document.querySelector<HTMLElement>('[role="radiogroup"]')!;
    const editBtn = document.querySelector<HTMLButtonElement>('[data-mode="edit"]')!;
    const previewBtn = document.querySelector<HTMLButtonElement>('[data-mode="preview"]')!;
    editBtn.focus();
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(setMode).toHaveBeenCalledWith('preview');
    expect(uiStore.getState().mode).toBe('preview');
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(setMode).toHaveBeenLastCalledWith('edit');
    expect(uiStore.getState().mode).toBe('edit');
    void previewBtn;
  });
});
