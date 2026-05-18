// @vitest-environment jsdom
// attachLayoutAttrs — pane visibility derivation.
//
// Pins the contract: #pane-edit.hidden and #pane-preview.hidden are
// derived from uiStore.mode by attachLayoutAttrs, just like
// body.dataset.mode is. No call site should write these flags by hand
// outside the derivation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUiStore, defaultUiState, type UiState } from '../../ui/creator/store/uiStore.js';
import { attachLayoutAttrs } from '../../ui/creator/store/attachLayoutAttrs.js';

function blankUi(overrides: Partial<UiState> = {}): UiState {
  return { ...defaultUiState(), ...overrides };
}

describe('attachLayoutAttrs — pane visibility derivation', () => {
  let paneEdit: HTMLDivElement;
  let panePreview: HTMLDivElement;
  let detach: () => void = () => {};

  beforeEach(() => {
    // The body dataset is shared across tests; reset to avoid cross-test bleed.
    delete document.body.dataset['mode'];
    delete document.body.dataset['activeTool'];
    delete document.body.dataset['layout'];
    delete document.body.dataset['leftCollapsed'];
    delete document.body.dataset['rightCollapsed'];
    delete document.body.dataset['rightAsSheet'];
    document.documentElement.classList.remove('ed-rulers-shown');

    paneEdit = document.createElement('div');
    paneEdit.id = 'pane-edit';
    panePreview = document.createElement('div');
    panePreview.id = 'pane-preview';
    // index.html declares `hidden` on #pane-preview by default.
    panePreview.hidden = true;
    document.body.append(paneEdit, panePreview);
  });

  afterEach(() => {
    detach();
    paneEdit.remove();
    panePreview.remove();
  });

  it('hides #pane-preview and shows #pane-edit when mode === "edit"', () => {
    const uiStore = createUiStore(blankUi({ mode: 'edit' }));
    detach = attachLayoutAttrs(uiStore);
    expect(paneEdit.hidden).toBe(false);
    expect(panePreview.hidden).toBe(true);
  });

  it('hides #pane-edit and shows #pane-preview when mode === "preview"', () => {
    const uiStore = createUiStore(blankUi({ mode: 'preview' }));
    detach = attachLayoutAttrs(uiStore);
    expect(paneEdit.hidden).toBe(true);
    expect(panePreview.hidden).toBe(false);
  });

  it('toggles correctly when uiStore.mode flips', () => {
    const uiStore = createUiStore(blankUi({ mode: 'edit' }));
    detach = attachLayoutAttrs(uiStore);
    expect(paneEdit.hidden).toBe(false);
    expect(panePreview.hidden).toBe(true);

    uiStore.update({ mode: 'preview' });
    expect(paneEdit.hidden).toBe(true);
    expect(panePreview.hidden).toBe(false);

    uiStore.update({ mode: 'edit' });
    expect(paneEdit.hidden).toBe(false);
    expect(panePreview.hidden).toBe(true);
  });

  it('is a no-op when #pane-edit / #pane-preview are not in the DOM', () => {
    paneEdit.remove();
    panePreview.remove();
    const uiStore = createUiStore(blankUi({ mode: 'preview' }));
    expect(() => {
      detach = attachLayoutAttrs(uiStore);
      uiStore.update({ mode: 'edit' });
    }).not.toThrow();
  });
});
