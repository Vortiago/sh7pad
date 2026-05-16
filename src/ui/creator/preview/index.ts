// Preview pane controller. Owns:
//   • #pv-canvas        — preview SVG (full design + history + glass foot)
//   • #pv-canvas-wrap   — wheel zoom + pan
//   • #pv-transport     — play/pause/scrub/speed/zoom controls
//   • #pv-header        — "Preview · N/M drops" label
//
// Owns the playback controller; rebinds it whenever the StitchSequence
// length changes. Reads (project, ui). Writes ui.step / playing / speed /
// previewUserZoom / previewPan. Updates the stitch-list highlight via the
// caller-provided onStepRowChanged hook so we don't full-re-render the
// list during playback.

import { createPlayback, createRafClock, type PlaybackController } from '../../playback.js';
import { safeSequenceFromProject as sequenceFromProject } from '../../../creator/pipeline/encodeDesign.js';
import { renderPreviewScene } from './render.js';
import { renderPreviewTransport, updatePreviewTransport } from './transport.js';
import { attachCanvasCamera } from '../canvasCamera/index.js';
import type { ZoomAction } from '../zoom/index.js';
import { currentRowFromStep } from '../rowIdMapping.js';
import { transportStateNow } from '../store/transportState.js';
import { attachStoresToScheduler } from '../store/scheduleRender.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';
import type { RowId } from '../stitchListPanel/panel.js';

export interface PreviewPaneHandle {
  /** Recreate the playback controller for the current sequence length. */
  rebindPlayback(): void;
  /** Scrub the transport to a step (used by the stitch list panel). */
  scrubTo(step: number): void;
}

export interface PreviewPaneDeps {
  doc: Document;
  projectStore: ProjectStore;
  uiStore: UiStore;
  /**
   * Hook fired when the playback tick advances (during play). The caller
   * (typically the stitch list panel) updates its highlight in place.
   */
  onStepRowChanged?: (row: RowId | null) => void;
}

export function attachPreviewPane(deps: PreviewPaneDeps): PreviewPaneHandle {
  const { doc, projectStore, uiStore, onStepRowChanged } = deps;
  const pvCanvas = doc.getElementById('pv-canvas') as unknown as SVGSVGElement | null;
  const pvHeader = doc.getElementById('pv-header');
  const pvCanvasWrap = doc.getElementById('pv-canvas-wrap');
  const pvTransport = doc.getElementById('pv-transport');

  let playback: PlaybackController | null = null;
  /** Filled in once the camera is attached below; the transport's
   *  zoom in / out / reset buttons route through this so they share
   *  the same view-write path as the wheel / pinch / fit-button. */
  let applyZoom: (action: ZoomAction) => void = () => {};

  function paintCanvas(): void {
    if (!pvCanvas) return;
    const project = projectStore.getState();
    const ui = uiStore.getState();
    const wrap = pvCanvasWrap?.getBoundingClientRect();
    const containerW = wrap?.width || 600;
    const containerH = wrap?.height || 400;
    renderPreviewScene(pvCanvas, project, ui.step, { containerW, containerH }, ui.previewUserZoom, {
      needleSizeNm: ui.needleSizeNm,
      threadDiameterMm: ui.threadDiameterMm,
      threadColor: ui.threadColor,
      bgColor: ui.bgColor,
      showHistory: ui.showHistory,
      showFoot: ui.showFoot,
      pan: ui.previewPan,
    });
  }

  // Renders the preview header: just the drop counter. The encoder-mode
  // toggle lives in the editor toolbar (toolbar.ts) since it controls how
  // segments get sliced into needle drops — a design-authoring concern,
  // not a preview rendering one.
  function paintHeader(seqLen: number): void {
    if (!pvHeader) return;
    const ui = uiStore.getState();
    pvHeader.textContent = '';
    const label = doc.createElement('span');
    label.textContent = `Preview · ${ui.step}/${seqLen} drops`;
    pvHeader.appendChild(label);
  }

  function render(): void {
    const ui = uiStore.getState();
    if (ui.mode !== 'preview') return;
    const seq = sequenceFromProject(projectStore.getState());
    paintCanvas();
    paintHeader(seq.length);
    if (pvTransport) {
      renderPreviewTransport(pvTransport, transportStateNow(seq, ui), transportCallbacks);
    }
  }

  function renderLive(): void {
    const ui = uiStore.getState();
    if (ui.mode !== 'preview') return;
    const seq = sequenceFromProject(projectStore.getState());
    paintCanvas();
    paintHeader(seq.length);
    if (pvTransport) {
      updatePreviewTransport(pvTransport, transportStateNow(seq, ui));
    }
  }

  function rebindPlayback(): void {
    const seq = sequenceFromProject(projectStore.getState());
    if (playback) playback.pause();
    playback = createPlayback({
      totalSteps: seq.length,
      onStep: (i) => {
        uiStore.update({ step: i });
        renderLive();
        if (onStepRowChanged) {
          onStepRowChanged(currentRowFromStep(seq, i, projectStore.getState().mode));
        }
      },
      onComplete: () => {
        uiStore.update({ playing: false });
        render();
      },
      clock: createRafClock(() => Math.max(20, 1000 / Math.max(1, uiStore.getState().speed))),
    });
    if (uiStore.getState().step > seq.length) {
      uiStore.update({ step: seq.length });
    }
  }

  // Six of the transport callbacks (Reset, StepBack, StepForward, ToEnd,
  // Scrub, plus the public scrubTo entry) share the same step-and-pause
  // body: pause playback, advance to the target step, mirror it into
  // uiStore. Only the target-step computation differs.
  const stepToAndPause = (target: number): void => {
    if (!playback) return;
    playback.pause();
    playback.stepTo(target);
    uiStore.update({ playing: false, step: target });
  };

  function scrubTo(step: number): void {
    stepToAndPause(step);
  }

  const transportCallbacks = {
    onPlay: () => {
      if (!playback) return;
      uiStore.update({ playing: true });
      playback.play();
    },
    onPause: () => {
      if (!playback) return;
      playback.pause();
      uiStore.update({ playing: false });
    },
    onReset: () => stepToAndPause(0),
    onStepBack: () => stepToAndPause(Math.max(0, uiStore.getState().step - 1)),
    onStepForward: () => {
      const seqLen = sequenceFromProject(projectStore.getState()).length;
      stepToAndPause(Math.min(seqLen, uiStore.getState().step + 1));
    },
    onToEnd: () => {
      stepToAndPause(sequenceFromProject(projectStore.getState()).length);
    },
    onScrub: (step: number) => stepToAndPause(step),
    onSpeed: (speed: number) => {
      uiStore.update({ speed });
    },
    onZoom: (action: ZoomAction) => applyZoom(action),
  };

  if (pvCanvasWrap) {
    // Shared camera wiring (wheel zoom + pinch + two-finger pan + fit
    // button + middle/right/Alt-drag mouse pan). The preview has no
    // editor-specific tap or long-press menu, so we leave those
    // callbacks unset. Mouse pan is on by default here — the editor's
    // mouse pan is owned by editorInteract and gated by the Pan tool,
    // so the editor leaves enableMousePan off.
    const camera = attachCanvasCamera({
      wrap: pvCanvasWrap,
      getView: () => {
        const ui = uiStore.getState();
        return { userZoom: ui.previewUserZoom, pan: ui.previewPan };
      },
      setView: (next) => {
        uiStore.update({ previewUserZoom: next.userZoom, previewPan: next.pan });
      },
      enableMousePan: true,
    });
    applyZoom = camera.applyZoom;
  }

  // Auto-render on UI or project changes via the synchronous scheduler.
  // Same pattern as the sidebar (Round 3) and inspectorPeek: each pane
  // subscribes to both stores directly. render() early-returns when
  // ui.mode !== 'preview', so the project subscription in edit mode is
  // harmless. The hot-path renderLive (each playback tick) bypasses the
  // scheduler intentionally — scheduling would lose the synchronous
  // transport-mutate-only path that keeps the play/pause button DOM
  // stable across ticks.
  attachStoresToScheduler(render, [uiStore, projectStore]);

  // Self-bootstrap: paint the initial state at attach time. render()
  // early-returns when uiStore.mode !== 'preview', so calling it in edit
  // mode is harmless — the first mode switch to preview will then trigger
  // a paint via the scheduler.
  render();

  return { rebindPlayback, scrubTo };
}
