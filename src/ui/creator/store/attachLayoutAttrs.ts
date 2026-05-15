// Layout-attribute derivation. Subscribes to the uiStore's layoutState
// slice (mode, tool, leftCollapsed, rightCollapsed, layout, rulersShown)
// and writes the corresponding body.dataset.* / html.classList state.
// This is the ONE place that mutates layout-intent DOM attributes —
// every other call site updates the store instead.
//
// CSS selectors are unchanged: body[data-mode='preview'],
// body[data-active-tool='add'], body[data-left-collapsed='true'],
// body[data-right-collapsed='true'], body[data-right-as-sheet='true'],
// html.ed-rulers-shown. The derivation just centralizes the writes so
// the rules for when each attr applies (especially: suppress dock-
// collapsed flags on non-desktop layouts so the panels-in-sheets bug
// can't recur) live in one readable function.
//
// Synchronous: uiStore.setState notifies subscribers synchronously, so
// a click handler that calls uiStore.update(...) and then reads
// document.body.dataset will see the new value before the next line.
// Tests rely on this contract.

import type { UiStore, UiState } from './uiStore.js';

const RULERS_CLASS = 'ed-rulers-shown';

export interface AttachLayoutAttrsOptions {
  /** Override target document for tests; defaults to the global. */
  doc?: Document;
}

/** Wire the derivation. Returns a destroy() for teardown (used by
 *  tests; production attaches once at mount time and never tears down).
 *  Applies the initial state synchronously so the DOM matches the
 *  store before the first user interaction. */
export function attachLayoutAttrs(
  uiStore: UiStore,
  opts: AttachLayoutAttrsOptions = {},
): () => void {
  const doc = opts.doc ?? document;
  // Look up the pane elements once at attach time. apply() re-resolves
  // them on each call so a pane mounted/swapped after attach still gets
  // its visibility derived (cheap getElementById; both cases needed
  // because tests sometimes attach before the DOM is built, and the
  // panes themselves may be replaced when remounting).
  apply(uiStore.getState(), doc);
  const unsubscribe = uiStore.subscribe((state) => apply(state, doc));
  return unsubscribe;
}

function apply(state: UiState, doc: Document): void {
  const body = doc.body;
  const html = doc.documentElement;
  // Pane visibility is derived from state.mode just like body.dataset.mode.
  // Look up each time (no-op when absent) so callers can mount the panes
  // after attach without losing the derivation.
  const paneEdit = doc.getElementById('pane-edit');
  const panePreview = doc.getElementById('pane-preview');
  if (paneEdit) paneEdit.hidden = state.mode !== 'edit';
  if (panePreview) panePreview.hidden = state.mode !== 'preview';
  setOrDelete(body, 'mode', state.mode);
  // body.dataset.activeTool mirrors uiStore.tool — distinct from the
  // canvas wrapper's data-tool so toolbar `[data-tool=…]` selectors
  // don't accidentally match the body element.
  setOrDelete(body, 'activeTool', state.tool);
  // body.dataset.layout mirrors uiStore.layout so layout-scoped CSS
  // selectors (e.g. body[data-layout='phone'] #ed-inspector hide rule)
  // have a stable hook. The dock-collapsed / right-as-sheet derivations
  // below read state.layout directly — this attr is purely for CSS.
  setOrDelete(body, 'layout', state.layout);
  // Dock-collapsed attrs only apply on desktop. On tablet/phone the
  // panels live in sheets, and the desktop "rail-collapsed" CSS would
  // otherwise hide their contents inside the sheet.
  const desktopCollapsedLeft = state.layout === 'desktop' && state.leftCollapsed;
  const desktopCollapsedRight = state.layout === 'desktop' && state.rightCollapsed;
  setOrDelete(body, 'leftCollapsed', desktopCollapsedLeft ? 'true' : '');
  setOrDelete(body, 'rightCollapsed', desktopCollapsedRight ? 'true' : '');
  // rightAsSheet is a derived consequence of being on tablet, where
  // the right column is reclaimed by the stitch sheet. Phone has its
  // own pillBar+sheets that own the chrome, so phone doesn't need
  // this flag.
  setOrDelete(body, 'rightAsSheet', state.layout === 'tablet' ? 'true' : '');
  // Rulers default to hidden at phone width — the class opts back in.
  // Outside phone width the class is harmless; CSS at non-phone widths
  // shows rulers unconditionally.
  html.classList.toggle(RULERS_CLASS, state.rulersShown);
}

/** Write a dataset key, or delete it when value is empty/undefined.
 *  Tests assert `body.dataset.X === undefined` (not empty string) when
 *  a flag is off, so empty-string writes are not equivalent to delete. */
function setOrDelete(el: HTMLElement, key: string, value: string | undefined): void {
  if (value == null || value === '') {
    delete el.dataset[key];
  } else {
    el.dataset[key] = value;
  }
}
