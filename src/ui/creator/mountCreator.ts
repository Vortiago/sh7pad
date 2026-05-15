// Mount the Creator into a document. Pulled out of main.ts so tests can
// drive it with a jsdom document + an in-memory IndexedDB. main.ts is the
// trivial entry point that opens the real IDB and calls mountCreator on
// real DOM at module load time.
//
// This file is the wiring layer over five per-pane controllers:
//
//   • attachEditorPane         — canvas, toolbar, inspector, rulers
//   • attachPreviewPane        — preview canvas, transport, playback
//   • attachSidebar            — project list, metadata, mode toggle, bg
//   • attachStitchListPanel    — stitch list (visible in both modes)
//   • attachKeyboardShortcuts  — 1 / 2 / Delete
//
// Each controller owns its DOM and exposes a small handle. mountCreator
// holds the project + UI stores, dispatches the renderAll cascade on
// project changes, and routes mode changes through a single setMode
// helper that the sidebar's mode button and keyboard both call.
//
// Persistence: project records live in IndexedDB via ProjectRepository
// (records = native Blobs for bg images, no base64). The two boot-critical
// UI sentinels (sidebar collapse, disclaimer-seen) stay on a sync Storage
// handle so first paint avoids a layout flash.

import './shared/tokens.css';
import './shared/shared.css';
import './shared/a11y.css';
import './shared/touch.css';
import './shared/breakpoints.css';

import { createProjectStore } from '../../creator/projectStore.js';
import { SAMPLE } from '../../creator/project.js';
import { StorageError, type ProjectRepository } from '../../creator/projectRepository.js';
import { showToast } from './toast/index.js';
import { hasSeenDisclaimer, showDisclaimer } from './modals/disclaimerModal/index.js';
import type { Project } from '../../creator/types.js';
import { createUiStore, defaultUiState, type Layout } from './store/uiStore.js';
import { attachLayoutAttrs } from './store/attachLayoutAttrs.js';
import { PHONE_QUERY, TABLET_QUERY } from './responsive/breakpoints.js';
import { attachEditorPane } from './editor/index.js';
import { attachPreviewPane } from './preview/index.js';
import { attachSidebar } from './sidebar/index.js';
import { attachStitchListPanel, type StitchListPaneHandle } from './stitchListPanel/index.js';
import { attachKeyboardShortcuts } from './attachKeyboardShortcuts.js';
import { attachResponsiveController, type ResponsiveControllerHandle } from './responsive/index.js';
import { hideContextMenu } from './contextMenu/index.js';
import type { Mode } from './modeSwitch/index.js';

export async function mountCreator(
  doc: Document,
  repo: ProjectRepository,
  sentinelStorage: Storage,
): Promise<void> {
  // Boot projects from the repo, or seed the sample. Sentinel storage is
  // a separate Storage handle (typically window.localStorage) used only
  // for tiny boot-critical flags — sidebar-collapse, disclaimer-seen —
  // so the sync read keeps the layout from flashing on first paint.
  const storage = sentinelStorage;
  const initialProjects: Project[] = (await repo.loadAll()).filter(Boolean);
  if (initialProjects.length === 0) initialProjects.push(SAMPLE());

  const projectStore = createProjectStore(initialProjects[0]!);

  // Seed layoutState from sentinel storage (collapse flags persist for
  // first-paint restoration) and from matchMedia (initial layout
  // bucket). The responsive controller updates `layout` thereafter.
  const initialLeftCollapsed = storage.getItem('sh7.ui.leftCollapsed') === '1';
  const initialRightCollapsed = storage.getItem('sh7.ui.rightCollapsed') === '1';
  const initialLayout: Layout = pickInitialLayout();

  // defaultUiState() owns the preview/needle/thread/colour defaults
  // alongside the rest of the field shape; the boot-critical overrides
  // (projects loaded from IDB, sentinel-stored collapse flags, the
  // matchMedia layout bucket) layer on top.
  const uiStore = createUiStore({
    ...defaultUiState(),
    projects: initialProjects,
    currentId: initialProjects[0]!.id,
    leftCollapsed: initialLeftCollapsed,
    rightCollapsed: initialRightCollapsed,
    layout: initialLayout,
  });

  // Wire the single layout-attribute writer. After this, every site
  // that used to mutate body.dataset.* or html.classList for layout
  // intent routes through uiStore.update(...) and this subscriber
  // applies the diff. Attached before the panes so each pane's initial
  // store updates flow through to the DOM immediately.
  attachLayoutAttrs(uiStore, { doc });

  function persist(): void {
    // Fire-and-forget: a save in flight doesn't block re-render. Errors
    // surface via the toast; IDB transaction queueing keeps subsequent
    // writes ordered and makes a follow-up loadAll observe committed
    // state (so tests that read via repo.loadAll() see the latest list).
    repo.saveAll(uiStore.getState().projects).catch((err: unknown) => {
      if (err instanceof StorageError && err.quotaExceeded) {
        showToast('Storage full — try removing the background image');
      }
    });
  }

  function deleteProject(id: string): void {
    // saveAll only puts records — it never removes them — so the
    // sidebar's onDelete must call this to drop the IDB row. Errors
    // are non-fatal: the next persist will overwrite whatever's left,
    // and the user-visible state is already correct.
    repo.delete(id).catch(() => { /* surfaces via toast on next save */ });
  }

  // Wire panes. Order matters: late-bind stitchList so the preview's
  // onStepRowChanged hook can reach it. Sidebar is constructed last so
  // setMode (which needs the sidebar handle) can be defined first.
  let stitchList: StitchListPaneHandle;
  const editor = attachEditorPane({ doc, projectStore, uiStore });
  const preview = attachPreviewPane({
    doc,
    projectStore,
    uiStore,
    onStepRowChanged: (row) => stitchList?.setCurrentRow(row),
  });
  stitchList = attachStitchListPanel({ doc, storage, projectStore, uiStore, editor, preview });

  // Closure-captured: the responsive controller is constructed below
  // setMode (it depends on setMode), but setMode wants to call its
  // closeAllFlyouts() on every mode swap. Late-bind by re-reading the
  // mutable ref each call.
  let responsiveHandle: ResponsiveControllerHandle | null = null;

  function setMode(next: Mode): void {
    // Close transient overlays even when the requested mode equals the
    // current one — tapping the active mode pill on phone is the
    // user-facing "dismiss everything" gesture (sheets, long-press
    // menus, overflow). Selection survives so swapping Edit → Preview
    // → Edit comes back to the same point/segment; the inspector peek
    // retracts itself via its own mode-gate.
    responsiveHandle?.closeAllFlyouts();
    hideContextMenu();
    if (uiStore.getState().mode === next) return;
    // attachLayoutAttrs handles body.dataset.mode AND the per-pane
    // `hidden` flags as derived effects of uiStore.mode — no need to
    // write either explicitly here. The sidebar's own scheduler
    // subscription rebuilds the mode-switch widget and the
    // Preview-Settings region on the resulting uiStore notification.
    uiStore.update({ mode: next });
  }

  attachSidebar({
    doc, storage, projectStore, uiStore, editor, preview, setMode, persist, deleteProject,
  });
  attachKeyboardShortcuts({ doc, setMode, editor });

  // Mirror exists ONLY for syncing the projects-list snapshot into
  // uiStore.projects (read by the sidebar's project picker). Each pane
  // (editor, preview, stitchListPanel, sidebar, inspectorPeek) subscribes
  // to projectStore directly via its own scheduler for re-render — so
  // this subscriber is NOT load-bearing for any pane's render loop.
  // It also handles two cross-cutting side-effects per project change:
  // persist() to IDB and preview.rebindPlayback() to refresh the
  // playback controller against the new sequence length.
  projectStore.subscribe(() => {
    const updated = projectStore.getState();
    uiStore.update({
      projects: uiStore.getState().projects.map((p) => p.id === updated.id ? updated : p),
    });
    persist();
    preview.rebindPlayback();
  });

  // Persist on boot so the seeded sample shows up in storage immediately
  // (otherwise reloading without interacting silently re-seeds).
  persist();
  preview.rebindPlayback();

  // Each pane self-bootstraps inside its attach* function (matching the
  // sidebar pattern from Round 3). mountCreator's job is wiring; the
  // panes own their first paint.

  // Phone responsive controller: at ≤639px, re-host #sidebar and
  // #stitch-list-panel into bottom sheets and mount the pill bar.
  // No-op when window.matchMedia is missing (jsdom default has it).
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const sidebarHost = doc.getElementById('sidebar');
    const stitchListHost = doc.getElementById('stitch-list-panel');
    if (sidebarHost && stitchListHost) {
      responsiveHandle = attachResponsiveController({
        sidebarHost,
        stitchListHost,
        chromeHost: doc.body,
        uiStore,
        setMode,
        onShowDisclaimer: () => showDisclaimer(storage),
        inspectorCallbacks: editor.inspectorCallbacks,
        projectStore,
      });
    }
  }

  if (!hasSeenDisclaimer(storage)) showDisclaimer(storage);
}

/** Snapshot the initial layout bucket from matchMedia, falling back to
 *  desktop when matchMedia is unavailable (jsdom default). The
 *  responsive controller takes over after mount; this seed just keeps
 *  attachLayoutAttrs correct from the very first paint. */
function pickInitialLayout(): Layout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }
  if (window.matchMedia(PHONE_QUERY).matches) return 'phone';
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet';
  return 'desktop';
}
