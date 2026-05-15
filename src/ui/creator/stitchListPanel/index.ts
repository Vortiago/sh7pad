// Stitch list panel controller. Owns:
//   • #stitch-list-header — collapse toggle for the right sidebar
//   • #stitch-list        — one row per segment (or per manual stitch)
//
// Visible in BOTH edit and preview modes. Row-click semantics dispatch on
// ui.mode: in preview the click scrubs; in edit it selects.
//
// The right-side collapse state lives in uiStore.rightCollapsed (the
// body[data-right-collapsed=true] attr is derived from there by
// attachLayoutAttrs) and mirrors to a localStorage sentinel for first-
// paint restoration — same pattern as the left sidebar, owned by this
// pane because the toggle button lives in the panel header.

import { safeSequenceFromProject as sequenceFromProject } from '../../../creator/pipeline/encodeDesign.js';
import {
  renderStitchListPanel,
  renderStitchListChrome,
  setCurrentRow as setStitchListRow,
  type RowId,
} from './panel.js';
import { currentRowFromStep, parseManualRowId, stepFromRow } from '../rowIdMapping.js';
import { createRenderScheduler } from '../store/scheduleRender.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { Selection, UiStore } from '../store/uiStore.js';
import type { EditorPaneHandle } from '../editor/index.js';
import type { PreviewPaneHandle } from '../preview/index.js';

export interface StitchListPaneHandle {
  /** Update the highlighted row WITHOUT a full re-render — preview hot path. */
  setCurrentRow(row: RowId | null): void;
}

export interface StitchListPaneDeps {
  doc: Document;
  storage: Storage;
  projectStore: ProjectStore;
  uiStore: UiStore;
  editor: EditorPaneHandle;
  preview: PreviewPaneHandle;
}

const COLLAPSE_KEY = 'sh7.ui.rightCollapsed';

export function attachStitchListPanel(deps: StitchListPaneDeps): StitchListPaneHandle {
  const { doc, storage, projectStore, uiStore, editor, preview } = deps;
  const ol = doc.getElementById('stitch-list') as HTMLOListElement | null;
  const header = doc.getElementById('stitch-list-header');

  // mountCreator seeds uiStore.rightCollapsed from sentinel storage
  // during boot, so this controller only needs to mirror toggles back
  // to storage. attachLayoutAttrs derives body[data-right-collapsed].

  function toggleCollapse(): void {
    const collapsed = uiStore.getState().rightCollapsed;
    uiStore.update({ rightCollapsed: !collapsed });
    if (collapsed) {
      storage.removeItem(COLLAPSE_KEY);
    } else {
      storage.setItem(COLLAPSE_KEY, '1');
    }
    renderHeader();
  }

  function renderHeader(): void {
    if (!header) return;
    renderStitchListChrome(
      header,
      { collapsed: uiStore.getState().rightCollapsed },
      { onToggleCollapse: toggleCollapse },
    );
  }

  function render(): void {
    if (!ol) return;
    const project = projectStore.getState();
    const seq = sequenceFromProject(project);
    renderStitchListPanel(ol, project, {
      onSelect: (row) => {
        const ui = uiStore.getState();
        if (ui.mode === 'preview') {
          const step = stepFromRow(seq, row);
          preview.scrubTo(step);
          setStitchListRow(ol, currentRowFromStep(seq, step, project.mode));
        } else {
          // Edit mode: select the segment, the START anchor, or (for
          // manual-mode satin rows) the manual-stitch index so the
          // inspector can drive its width / density / endAt controls.
          // Needle and jump rows clear the selection (they have no
          // editable parameters worth surfacing).
          let selection: Selection | null = null;
          if (row === 'start') {
            const startId = project.points[0]?.id;
            if (startId) selection = { kind: 'point', id: startId };
          } else {
            const mIdx = parseManualRowId(row);
            if (mIdx !== null) {
              const entry = project.manualStitches[mIdx];
              if (entry?.kind === 'satin') selection = { kind: 'manual-satin', idx: mIdx };
            } else {
              const segIdx = Number(row);
              const seg = project.segments[segIdx];
              if (seg) selection = { kind: 'segment', id: seg.id };
            }
          }
          uiStore.update({ selection });
          // Editor canvas + inspector pick this up via their own scheduler
          // subscriptions. Set the highlighted row in place now so the
          // visual response is immediate.
          setStitchListRow(ol, row);
        }
      },
      onDeleteSegment: (segId) => editor.deleteSegment(segId),
      onDeleteLastManual: () => editor.deleteLastManual(),
    });
    setStitchListRow(ol, currentRowFromStep(seq, uiStore.getState().step, project.mode));
  }

  function setCurrentRow(row: RowId | null): void {
    if (!ol) return;
    setStitchListRow(ol, row);
  }

  // Auto-render on UI or project changes via the synchronous scheduler.
  // Same pattern as the sidebar (Round 3) and inspectorPeek: each pane
  // subscribes to both stores directly. Rebuilding the list has no
  // focus-bearing inputs to lose, so unconditional re-render on any
  // store change is fine.
  const scheduler = createRenderScheduler(render);
  uiStore.subscribe(() => scheduler.schedule());
  projectStore.subscribe(() => scheduler.schedule());

  // Self-bootstrap: paint the initial state at attach time. The chrome
  // (collapse toggle) is independent of the list contents and has no
  // scheduler subscription of its own, so we paint it explicitly.
  renderHeader();
  render();

  return { setCurrentRow };
}
