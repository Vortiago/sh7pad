// Editor pane controller. Owns:
//   • #ed-canvas         — SVG canvas with hover, segments, points
//   • #ed-toolbar        — Tool/Stitch/Zoom buttons
//   • #ed-inspector      — segment inspector
//   • #ruler-top, #ruler-left
//   • #ed-canvas-wrap    — wheel zoom + ResizeObserver
//
// Reads (project, ui). Writes ui.tool / activeStitch / hover / hoverValid
// / pan / userZoom / selection / pendingManualSatinStart / containerSize.
// Wraps Stage A reducers (deleteSegment / deletePoint clear selection
// before calling the project reducer). body.dataset.activeTool is
// derived from ui.tool by attachLayoutAttrs (one writer); only the
// canvas wrapper's local data-tool attr is touched here for the
// scoped toolbar selectors.

import { createEditorReducers } from './reducers.js';
import { buildInteractCallbacks } from './interactCallbacks.js';
import { updateSegment } from '../../../creator/project.js';
import { updateManualSatin, removeLastManualStitch, type ManualSatinPatch } from '../../../creator/manualStitch.js';
import { foot } from '../../../creator/foot.js';
import { safeSequenceFromProject as sequenceFromProject } from '../../../creator/pipeline/encodeDesign.js';
import { renderEditorScene } from './render.js';
import { computeView } from './view.js';
import { createEditorInteract, type Tool } from './interact.js';
import { renderRulers } from '../rulers/index.js';
import { renderToolbar as renderToolbarComponent, normalizeActiveStitch, type StitchKind } from '../toolbar/index.js';
import { renderSegmentInspector, type InspectorCallbacks } from '../segmentInspector/index.js';
import { nextZoomView, type ZoomAction } from '../zoom/index.js';
import { attachCanvasWiring } from './canvasWiring.js';
import type { LongPressOps } from './longPressMenu.js';
import { attachStoresToScheduler } from '../store/scheduleRender.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';

const RULER_OFFSET = { top: 22, left: 34 };

export interface EditorPaneHandle {
  /** Set the active-stitch kind. Used by the sidebar after project switch. */
  setActiveStitch(kind: StitchKind): void;
  /** Set the active tool. Used by the sidebar after project switch so
   *  the interaction layer (which tracks tool in a closure variable, not
   *  via uiStore subscription) stays in sync with the normalized tool. */
  setTool(tool: Tool): void;
  /** Delete a segment by id. Used by the stitch list panel. */
  deleteSegment(segId: string): void;
  /** Pop the last manual-mode stitch off `project.manualStitches`.
   *  Manual mode is append-only, so only the tail is
   *  removable. Clears any selection that pointed at it first. */
  deleteLastManual(): void;
  /**
   * Delete whatever is currently selected (segment or non-anchor point).
   * Returns true when something was deleted; false otherwise. Used by the
   * keyboard shortcut so the caller knows whether to preventDefault().
   */
  deleteSelectedSegmentOrPoint(): boolean;
  /** Selection-mutating callbacks for renderSegmentInspector. Same set
   *  used internally for the desktop strip; exposed so the phone
   *  inspectorPeek adapter renders into its own host using identical
   *  mutators (delete clears selection, subdivide selects first half,
   *  etc.). */
  inspectorCallbacks: InspectorCallbacks;
}

export interface EditorPaneDeps {
  doc: Document;
  projectStore: ProjectStore;
  uiStore: UiStore;
}

export function attachEditorPane(deps: EditorPaneDeps): EditorPaneHandle {
  const { doc, projectStore, uiStore } = deps;
  const edToolbar = doc.getElementById('ed-toolbar');
  const edCanvasWrap = doc.getElementById('ed-canvas-wrap');
  const edCanvas = doc.getElementById('ed-canvas') as unknown as SVGSVGElement | null;
  const rulerTop = doc.getElementById('ruler-top');
  const rulerLeft = doc.getElementById('ruler-left');
  const edInspector = doc.getElementById('ed-inspector');

  let interact: ReturnType<typeof createEditorInteract> | null = null;

  function applyZoom(action: ZoomAction): void {
    const ui = uiStore.getState();
    const next = nextZoomView({ userZoom: ui.userZoom, pan: ui.pan }, action);
    if (next === null) return;
    uiStore.update({ userZoom: next.userZoom, pan: next.pan });
  }

  function setTool(t: Tool): void {
    // body.dataset.activeTool is derived from uiStore.tool by
    // attachLayoutAttrs. Only the canvas wrapper's scoped data-tool
    // is written locally, because toolbar selectors use it directly.
    uiStore.update({ tool: t, pendingManualSatinStart: null });
    interact?.setTool(t);
    if (edCanvasWrap) edCanvasWrap.dataset['tool'] = t;
  }

  function setActiveStitch(kind: StitchKind): void {
    uiStore.update({ activeStitch: kind, pendingManualSatinStart: null });
    interact?.setActiveStitch(kind);
  }

  function renderToolbar(): void {
    if (!edToolbar) return;
    const ui = uiStore.getState();
    renderToolbarComponent(edToolbar, {
      tool: ui.tool,
      activeStitch: ui.activeStitch,
      project: projectStore.getState(),
    }, {
      onTool: setTool,
      onStitch: setActiveStitch,
      onZoom: applyZoom,
      onEncoderMode: (mode) => {
        if ((projectStore.getState().encoderMode ?? 'compact') === mode) return;
        projectStore.setState((p) => ({ ...p, encoderMode: mode, updatedAt: Date.now() }));
      },
    });
  }

  // Object-URL lifecycle for the active project's bg image. The renderer
  // doesn't know about Blobs; we hand it a URL string that this pane
  // owns. When the bg blob reference changes (replace, remove, project
  // switch) we revoke the old URL so it doesn't leak.
  let lastBgBlob: Blob | null = null;
  let lastBgUrl: string | null = null;
  function syncBgObjectUrl(): string | null {
    const blob = projectStore.getState().bg?.blob ?? null;
    if (blob !== lastBgBlob) {
      if (lastBgUrl != null) URL.revokeObjectURL(lastBgUrl);
      lastBgBlob = blob;
      lastBgUrl = blob ? URL.createObjectURL(blob) : null;
    }
    return lastBgUrl;
  }

  function render(): void {
    if (!edCanvas) return;
    const project = projectStore.getState();
    const ui = uiStore.getState();
    const view = computeView(ui.containerSize, project.hoop, ui.userZoom, ui.pan);
    const seq = project.mode === 'manual' ? sequenceFromProject(project) : undefined;
    const bgUrl = syncBgObjectUrl();
    renderEditorScene(edCanvas, project, view, ui.hover, ui.selection, seq, {
      tool: ui.tool,
      activeStitch: ui.activeStitch,
    }, bgUrl);
    if (rulerTop && rulerLeft) {
      // Match .ed-ruler-top { left: 34px } and .ed-ruler-left { top: 22px }
      // so ruler ticks land on the same screen pixels as the canvas content.
      const halfW = foot(project.suggestedFoot).carriageReachHalfMm;
      renderRulers(rulerTop, rulerLeft, view, project.hoop, ui.hover, ui.containerSize, RULER_OFFSET, halfW);
    }
  }

  // Selection-aware reducer wrappers — see ./reducers.ts.
  const {
    deleteSegment,
    deletePoint,
    deleteSelectedSegmentOrPoint,
    subdivideSegment,
    convertSegment,
  } = createEditorReducers({ projectStore, uiStore });

  function deleteLastManual(): void {
    const project = projectStore.getState();
    const lastIdx = project.manualStitches.length - 1;
    if (lastIdx < 0) return;
    const sel = uiStore.getState().selection;
    if (sel?.kind === 'manual-satin' && sel.idx === lastIdx) {
      uiStore.update({ selection: null });
    }
    projectStore.setState((p) => removeLastManualStitch(p));
  }

  // Inspector callbacks — shared between the desktop strip (renderInspector
  // below) and the phone inspectorPeek adapter (mountCreator wires them
  // through the responsive controller). Both adapters call the same
  // reducer wrappers so behaviour matches across hosts.
  const inspectorCallbacks: InspectorCallbacks = {
    onChange: (target, patch) => {
      if (target.kind === 'manual-satin') {
        projectStore.setState((p) => updateManualSatin(p, target.idx, patch as ManualSatinPatch));
      } else {
        // 'point' targets never arrive here in practice (the point
        // inspector has no editable fields). updateSegment is a no-op
        // when the id doesn't match a segment, so the uniform dispatch
        // is safe.
        projectStore.setState((p) => updateSegment(p, target.id, patch as Partial<import('../../../creator/types.js').Segment>));
      }
    },
    onSubdivide: (id) => subdivideSegment(id),
    onDelete: (target) => {
      if (target.kind === 'manual-satin') {
        // Manual mode is append-only: only the tail entry
        // is removable. The inspector hides the Delete button on
        // non-last manual-satin entries; this guard is the reducer-
        // layer backstop.
        const project = projectStore.getState();
        if (target.idx === project.manualStitches.length - 1) deleteLastManual();
      } else {
        deleteSegment(target.id);
      }
    },
    onDeletePoint: (id) => deletePoint(id),
  };

  function renderInspector(): void {
    if (!edInspector) return;
    renderSegmentInspector(
      edInspector,
      projectStore.getState(),
      uiStore.getState().selection,
      inspectorCallbacks,
    );
  }

  if (edCanvas && edCanvasWrap) {
    interact = createEditorInteract(edCanvas, buildInteractCallbacks({
      projectStore,
      uiStore,
      edCanvasWrap,
    }));
    interact.attach();
    interact.setTool(uiStore.getState().tool);
    const normalized = normalizeActiveStitch(projectStore.getState(), uiStore.getState().activeStitch);
    uiStore.update({ activeStitch: normalized });
    interact.setActiveStitch(normalized);
    const initialTool = uiStore.getState().tool;
    if (edCanvasWrap) edCanvasWrap.dataset['tool'] = initialTool;
    // (body.dataset.activeTool is seeded by attachLayoutAttrs.)
  }

  if (edCanvasWrap) {
    const edCanvas = edCanvasWrap.querySelector<SVGSVGElement>('#ed-canvas');
    if (edCanvas) {
      const longPressOps: LongPressOps = {
        deleteSegment,
        deletePoint,
        subdivideSegment,
        convertSegment,
        currentSegmentType: (id) =>
          projectStore.getState().segments.find((s) => s.id === id)?.type,
      };
      attachCanvasWiring({
        doc,
        edCanvasWrap,
        edCanvas,
        projectStore,
        uiStore,
        getInteract: () => interact ?? null,
        longPressOps,
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) {
          uiStore.update({ containerSize: { w: r.width, h: r.height } });
        }
      });
      ro.observe(edCanvasWrap);
    }
  }

  // Auto-render on UI or project changes via the synchronous scheduler.
  // Same pattern as the sidebar (Round 3) and inspectorPeek: each pane
  // subscribes to both stores directly. mountCreator's projectStore
  // subscriber still mirrors the active project into uiStore.projects,
  // but that mirror is now read-only by the sidebar's project picker —
  // it is no longer load-bearing for any pane's re-render.
  function renderAllPane(): void {
    render();
    renderInspector();
    renderToolbar();
  }
  attachStoresToScheduler(renderAllPane, [uiStore, projectStore]);

  // Self-bootstrap: paint the initial state at attach time. The scheduler
  // only fires on subsequent uiStore.update calls; first paint is on us.
  // Matches the sidebar pattern from Round 3 (which calls applyDiff(true)
  // and renderModeSwitchInner() at the end of attachSidebar).
  renderAllPane();

  return {
    setActiveStitch,
    setTool,
    deleteSegment,
    deleteLastManual,
    deleteSelectedSegmentOrPoint,
    inspectorCallbacks,
  };
}

