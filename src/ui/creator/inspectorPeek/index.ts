// Phone inspector peek. Position:fixed surface that:
//   - hides itself when uiStore.selection is null
//   - shows the segment inspector as a 64px peek strip above the
//     pillBar when a selection exists
//   - drags up to a 50vh overlay (full inspector, all controls visible)
//
// This is a thin layout adapter on top of segmentInspector's
// renderSegmentInspector: it owns its own host element (a freshly
// created .ed-inspector inside .ip-body) and re-renders it on every
// uiStore / projectStore change. The desktop adapter (in editor/index.ts)
// renders into a different host (#ed-inspector) so the two never share
// any DOM identity — both can coexist as DOM children of the page; CSS
// hides whichever one doesn't match the current layout.

import './inspectorPeek.css';
import { nextPeekState, type PeekState } from './state.js';
import { renderSegmentInspector, type InspectorCallbacks } from '../segmentInspector/index.js';
import type { UiStore } from '../store/uiStore.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import { tplFrom, slot, action } from '../dom.js';
import templateHtml from './inspectorPeek.html?raw';

const templates = tplFrom(templateHtml);
const rootTpl = templates.content.querySelector<HTMLTemplateElement>('#ip-root')!;

export interface InspectorPeekOptions {
  uiStore: UiStore;
  projectStore: ProjectStore;
  /** Selection-mutating callbacks shared with the desktop inspector.
   *  Both adapters call the same reducer wrappers — selection clearing
   *  on delete, subdivide selecting the first half, etc. — so behaviour
   *  is identical whichever host the user is looking at. */
  callbacks: InspectorCallbacks;
}

export interface InspectorPeek {
  el: HTMLElement;
  destroy(): void;
}

export function createInspectorPeek(
  host: HTMLElement,
  opts: InspectorPeekOptions,
): InspectorPeek {
  const { uiStore, projectStore, callbacks } = opts;

  const root = rootTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const handle = slot<HTMLButtonElement>(root, 'handle');
  // Close (X) button — clears the selection so the peek retracts. The
  // drag handle alone collapses to peek but never to hidden (by design,
  // so the affordance stays visible while a selection exists). The X
  // gives the user an explicit dismiss action.
  action(root, 'close-peek').addEventListener('click', () => {
    uiStore.update({ selection: null });
  });
  // The phone adapter's own render host — a freshly created element
  // distinct from the desktop #ed-inspector. renderSegmentInspector
  // stamps `.ed-inspector` on it (and stashes `dataset.segmentId` /
  // `dataset.pointId` / `dataset.manualIdx` for its patch-vs-rebuild
  // fast path), so the same CSS rules apply and the per-root state
  // never collides with the desktop adapter's host.
  const renderHost = slot(root, 'render-host');

  let state: PeekState = 'hidden';
  function applyState(next: PeekState): void {
    if (state === next) return;
    state = next;
    root.dataset['peekState'] = next;
    handle.setAttribute(
      'aria-label',
      next === 'overlay' ? 'Collapse inspector' : 'Expand inspector',
    );
  }

  // Drag-to-resize via PointerEvents.
  let startY: number | null = null;
  handle.addEventListener('pointerdown', (ev) => {
    startY = ev.clientY;
    handle.setPointerCapture(ev.pointerId);
  });
  function endDrag(ev: PointerEvent): void {
    if (startY === null) return;
    const dy = startY - ev.clientY; // up positive
    startY = null;
    // releasePointerCapture throws InvalidStateError when capture was
    // already lost (e.g. pointercancel from a system gesture). Other
    // errors should still surface so we don't mask real bugs.
    try {
      handle.releasePointerCapture(ev.pointerId);
    } catch (err) {
      if (!(err instanceof DOMException) || err.name !== 'InvalidStateError') throw err;
    }
    applyState(nextPeekState(state, dy));
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  // Click-to-toggle as a non-drag fallback (keyboard activation also
  // dispatches click).
  handle.addEventListener('click', () => {
    if (state === 'peek') applyState('overlay');
    else if (state === 'overlay') applyState('peek');
  });

  function renderInspector(): void {
    renderSegmentInspector(
      renderHost,
      projectStore.getState(),
      uiStore.getState().selection,
      callbacks,
    );
  }

  function syncFromSelection(): void {
    const ui = uiStore.getState();
    const target = ui.selection;
    if (ui.mode !== 'edit' || target == null) {
      applyState('hidden');
      renderInspector();
      return;
    }
    const project = projectStore.getState();
    // hasContent: target resolves to an actual project entry. Orphan
    // selections (deleted while selected, etc.) collapse the peek.
    let hasContent = false;
    switch (target.kind) {
      case 'segment':
        hasContent = project.segments.some((s) => s.id === target.id);
        break;
      case 'point':
        hasContent = project.points.some((p) => p.id === target.id);
        break;
      case 'manual-satin': {
        const entry = project.manualStitches[target.idx];
        hasContent = entry?.kind === 'satin';
        break;
      }
    }
    applyState(hasContent ? (state === 'hidden' ? 'peek' : state) : 'hidden');
    renderInspector();
  }
  const offUi = uiStore.subscribe(syncFromSelection);
  // Project subscription catches the case where the selected segment
  // is deleted without selection changing — peek must retract.
  const offProject = projectStore.subscribe(syncFromSelection);
  syncFromSelection();

  host.appendChild(root);

  return {
    el: root,
    destroy() {
      offUi();
      offProject();
      root.remove();
    },
  };
}
