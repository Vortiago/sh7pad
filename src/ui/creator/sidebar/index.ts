// Sidebar pane controller. Owns:
//   • #sidebar       — project list, project metadata, mode-switch button,
//                      preview tuning sliders, tension slider, bg image
//   • #mode-switch   — Edit / Preview toggle (lives outside the sidebar
//                      DOM but is conceptually part of the same routing
//                      surface)
//
// Routes import / export / new-project through the existing modal helpers
// via ./callbacks.ts. Reads (project, ui). Writes ui.projects /
// currentId / mode / selection / step / activeStitch / preview-tuning /
// leftCollapsed fields. Mode changes flow through the setMode callback
// (paneEdit/panePreview hidden attrs); body.dataset.mode is derived
// from uiStore by attachLayoutAttrs.
//
// Sidebar-collapse state for the LEFT side lives in uiStore.leftCollapsed
// (the body[data-left-collapsed=true] attr is derived from there) and
// mirrors to a localStorage sentinel for first-paint restoration.
//
// Sub-region subscription: like editor / preview / stitchListPanel the
// sidebar auto-subscribes to uiStore + projectStore via a render
// scheduler. Unlike those panes the sidebar rebuilds only the sub-
// regions whose inputs changed (projects / stitch-settings /
// preview-settings / bg-image / mode-switch). The colour-picker
// constraint that originally kept the sidebar from subscribing at all
// is handled by previewSettings.syncPreviewSettingsControls — once the
// region is mounted, subsequent updates mutate the existing inputs in
// place rather than replaceChildren'ing them, so a native colour-picker
// dialog stays attached to the same DOM node across `input` events.

import {
  renderSidebarShell,
  renderProjectsRegion,
  renderStitchSettingsRegion,
  renderPreviewSettingsRegion,
  renderBgImageRegion,
  type SidebarRegions,
  type SidebarState,
} from './sidebar.js';
import { buildSidebarCallbacks } from './callbacks.js';
import { renderModeSwitch, type Mode } from '../modeSwitch/index.js';
import { normalizeActiveStitch, normalizeTool } from '../toolbar/index.js';
import { createRenderScheduler } from '../store/scheduleRender.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore, UiState } from '../store/uiStore.js';
import type { EditorPaneHandle } from '../editor/index.js';
import type { PreviewPaneHandle } from '../preview/index.js';
import type { Project } from '../../../creator/types.js';

const COLLAPSE_KEY = 'sh7.ui.leftCollapsed';

/**
 * Rebuild-only-when-dirty runner. Captures the previous input snapshot
 * and runs `action` whenever any keyed value changes (shallow equality).
 * The first call runs unconditionally — there's no prior snapshot, so a
 * sidebar bootstrap is also a dirty event. Replaces the hand-rolled
 * `let lastX: ... | null = null; if (initial || s.x !== lastX) { ... }`
 * fan-out in applyDiff so adding a new region input is one line, not
 * three (snapshot + dirty-check + write-back).
 */
function createDirtyRunner<T extends Record<string, unknown>>() {
  let last: T | null = null;
  return {
    run(next: T, action: () => void): void {
      if (last !== null) {
        let same = true;
        for (const k in next) {
          if (next[k] !== last[k]) { same = false; break; }
        }
        if (same) return;
      }
      action();
      last = next;
    },
  };
}

export interface SidebarPaneDeps {
  doc: Document;
  storage: Storage;
  projectStore: ProjectStore;
  uiStore: UiStore;
  editor: EditorPaneHandle;
  preview: PreviewPaneHandle;
  /** Called when the user changes mode (button or programmatic). */
  setMode: (next: Mode) => void;
  /** Called after import/export/new/delete so storage stays in sync. */
  persist: () => void;
  /**
   * Drop a project's record from the underlying repository. persist()
   * (saveAll) only puts records, so deletion needs an explicit hook.
   */
  deleteProject: (id: string) => void;
}

export function attachSidebar(deps: SidebarPaneDeps): void {
  const { doc, storage, projectStore, uiStore, editor, preview, setMode, persist, deleteProject } = deps;
  const sidebarRoot = doc.getElementById('sidebar');
  const modeSwitchRoot = doc.getElementById('mode-switch');

  // Sidebar-collapse: mountCreator seeds uiStore.leftCollapsed from
  // the sentinel storage during boot, so this controller only needs
  // to write back on toggle. The body[data-left-collapsed] attr is
  // applied by attachLayoutAttrs as a derived effect of the store.
  function toggleLeftCollapse(): void {
    const isCollapsed = uiStore.getState().leftCollapsed;
    uiStore.update({ leftCollapsed: !isCollapsed });
    if (isCollapsed) {
      storage.removeItem(COLLAPSE_KEY);
    } else {
      storage.setItem(COLLAPSE_KEY, '1');
    }
  }

  function switchToProject(next: Project): void {
    const ui = uiStore.getState();
    const activeStitch = normalizeActiveStitch(next, ui.activeStitch);
    // Move is design-only: demote a stored 'move' to
    // 'select' when switching into a manual project so the user isn't
    // left in a tool whose toolbar button has vanished.
    const tool = normalizeTool(next, ui.tool);
    uiStore.update({
      currentId: next.id,
      // Stale-selection guard: project switch drops the selection so the
      // inspector / peek can't re-resolve against the new project's
      // segments / points / manualStitches and surface a misleading row.
      selection: null,
      step: 0,
      activeStitch,
      tool,
    });
    editor.setActiveStitch(activeStitch);
    editor.setTool(tool);
    projectStore.setState(next);
  }

  const callbacks = buildSidebarCallbacks({
    storage,
    projectStore,
    uiStore,
    preview,
    persist,
    deleteProject,
    switchToProject,
    toggleLeftCollapse,
  });

  // Build the static shell once. region handles let us rebuild each
  // sub-region independently below. If the document doesn't have a
  // #sidebar root we still wire the mode-switch subscription so the
  // top-level pill bar stays in sync.
  let regions: SidebarRegions | null = null;
  if (sidebarRoot) {
    regions = renderSidebarShell(sidebarRoot, callbacks);
  }

  // Per-region dirty runners — each rebuilds its region only when its
  // own inputs change. Adding a new input is one line (extend the run()
  // payload) instead of touching a separate cache + dirty-check +
  // write-back triplet.
  const projectsRunner = createDirtyRunner<{
    projects: UiState['projects'];
    currentId: string | null;
  }>();
  const stitchSettingsRunner = createDirtyRunner<{ project: Project }>();
  const previewSettingsRunner = createDirtyRunner<{
    mode: Mode;
    needleSizeNm: number;
    threadDiameterMm: number;
    threadColor: string;
    bgColor: string;
    showHistory: boolean;
    showFoot: boolean;
  }>();
  const bgImageRunner = createDirtyRunner<{ bg: Project['bg'] }>();

  function currentSidebarState(): SidebarState {
    const project = projectStore.getState();
    const ui = uiStore.getState();
    return {
      projects: ui.projects,
      currentId: ui.currentId,
      project,
      mode: ui.mode,
      preview: {
        needleSizeNm: ui.needleSizeNm,
        threadDiameterMm: ui.threadDiameterMm,
        threadColor: ui.threadColor,
        bgColor: ui.bgColor,
        showHistory: ui.showHistory,
        showFoot: ui.showFoot,
      },
    };
  }

  function applyDiff(): void {
    if (!regions) return;
    const s = currentSidebarState();
    const p = s.preview!;

    // Projects region: list contents + active marker.
    projectsRunner.run({ projects: s.projects, currentId: s.currentId }, () => {
      renderProjectsRegion(regions!.projects, s, callbacks);
    });

    // Stitch-settings region: locked metadata + tension. The reference
    // identity of the active Project changes on every projectStore
    // setState, so this is a cheap === check.
    stitchSettingsRunner.run({ project: s.project }, () => {
      renderStitchSettingsRegion(regions!.stitchSettings, s, callbacks);
    });

    // Preview-settings region: mode flip + every preview-tuning input.
    // syncPreviewSettingsControls keeps the colour picker's input node
    // alive across `input` events (see ./previewSettings.ts) so the
    // native dialog isn't detached mid-pick.
    previewSettingsRunner.run({
      mode: s.mode ?? 'edit',
      needleSizeNm: p.needleSizeNm,
      threadDiameterMm: p.threadDiameterMm,
      threadColor: p.threadColor,
      bgColor: p.bgColor,
      showHistory: p.showHistory,
      showFoot: p.showFoot,
    }, () => {
      renderPreviewSettingsRegion(regions!.previewSettings, s, callbacks);
    });

    // Bg-image region: a fresh blob reference / coord patch / removal
    // is the only thing this region reads from the project.
    bgImageRunner.run({ bg: s.project.bg }, () => {
      renderBgImageRegion(regions!.bgImage, s, callbacks);
    });
  }

  function renderModeSwitchInner(): void {
    if (!modeSwitchRoot) return;
    renderModeSwitch(modeSwitchRoot, uiStore.getState().mode, setMode);
  }

  // Initial render of every region, then attach the auto-subscription.
  // The runners have a null prior-snapshot, so the first applyDiff
  // call runs every region's action unconditionally.
  applyDiff();
  renderModeSwitchInner();

  // Track mode separately so we can refresh the mode-switch widget
  // (a different DOM root) when it changes.
  let lastModeForSwitch = uiStore.getState().mode;
  const scheduler = createRenderScheduler(() => {
    applyDiff();
    const m = uiStore.getState().mode;
    if (m !== lastModeForSwitch) {
      lastModeForSwitch = m;
      renderModeSwitchInner();
    }
  });
  uiStore.subscribe(() => scheduler.schedule());
  projectStore.subscribe(() => scheduler.schedule());
}
