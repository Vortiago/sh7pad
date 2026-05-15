// Canvas keyboard navigation. Hooked onto the SVG element (which has
// tabindex="0" + role="application") so when focus is on the canvas:
//
//   ArrowUp/Down/Left/Right  nudge selected point by 1mm
//   Shift+Arrow              fine-nudge by 0.1mm
//   [ / ]                    cycle previous / next point in sequence
//   Enter                    append a point (1mm below selection, else at hoop center)
//   Esc                      deselect
//
// Tab is NOT trapped (WCAG 2.1.2 No Keyboard Trap). Delete is wired by
// the existing attachKeyboardShortcuts.ts via document keydown.
//
// Updates a live region (aria-live="polite") on selection change and on
// the trailing edge of arrow nudges so screen-reader users hear "Point
// 3 of 12, x=12.5mm, y=5.3mm" without spam during rapid nudges.

import { addPointToProject, movePointPreservingSatinSpines } from '../../../creator/project.js';
import { newPointId, newSegmentId } from '../../../creator/ids.js';
import { shouldSkipForInput } from '../attachKeyboardShortcuts.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';

const ANNOUNCE_DEBOUNCE_MS = 300;

export interface CanvasKeyboardDeps {
  svg: SVGSVGElement;
  projectStore: ProjectStore;
  uiStore: UiStore;
  /** Optional live-region element to populate. We resolve this lazily
   *  so missing markup doesn't crash; SR announcements just no-op. */
  liveRegion?: HTMLElement | null;
}

export function attachCanvasKeyboard(deps: CanvasKeyboardDeps): () => void {
  const { svg, projectStore, uiStore } = deps;
  let announceTimer: number | null = null;

  function announce(text: string, immediate = false): void {
    if (!deps.liveRegion) return;
    if (announceTimer !== null) {
      clearTimeout(announceTimer);
      announceTimer = null;
    }
    const set = () => { if (deps.liveRegion) deps.liveRegion.textContent = text; };
    if (immediate) set();
    else announceTimer = window.setTimeout(set, ANNOUNCE_DEBOUNCE_MS);
  }

  function describePoint(id: string): string {
    const project = projectStore.getState();
    const idx = project.points.findIndex((p) => p.id === id);
    if (idx < 0) return '';
    const pt = project.points[idx]!;
    const total = project.points.length;
    return `Point ${idx + 1} of ${total}, x ${pt.x.toFixed(1)} mm, y ${pt.y.toFixed(1)} mm`;
  }

  /** Walk uiStore.selection back to a point id when the selection is a
   *  point — the keyboard nav cares only about chain anchors. Returns
   *  null for segment / manual-satin / empty selections. */
  function selectedPointId(): string | null {
    const sel = uiStore.getState().selection;
    return sel?.kind === 'point' ? sel.id : null;
  }

  function nudge(dx: number, dy: number): void {
    const id = selectedPointId();
    if (!id) return;
    const project = projectStore.getState();
    const pt = project.points.find((p) => p.id === id);
    if (!pt) return;
    projectStore.setState((p) =>
      movePointPreservingSatinSpines(p, pt.id, { x: pt.x + dx, y: pt.y + dy }),
    );
    announce(describePoint(pt.id));
  }

  function cycle(direction: 1 | -1): void {
    const project = projectStore.getState();
    if (project.points.length === 0) return;
    const id = selectedPointId();
    const currentIdx = id ? project.points.findIndex((p) => p.id === id) : -1;
    const nextIdx = direction === 1
      ? (currentIdx < 0 ? 0 : (currentIdx + 1) % project.points.length)
      : (currentIdx <= 0 ? project.points.length - 1 : currentIdx - 1);
    const next = project.points[nextIdx]!;
    uiStore.update({ selection: { kind: 'point', id: next.id } });
    announce(describePoint(next.id), true);
  }

  function appendPoint(): void {
    const project = projectStore.getState();
    const ui = uiStore.getState();
    const id = selectedPointId();
    const sel = id
      ? project.points.find((p) => p.id === id)
      : project.points[project.points.length - 1];
    const click = sel
      ? { x: sel.x, y: sel.y + 1 }
      : { x: 0, y: project.hoop.h / 2 };
    const kind = ui.activeStitch === 'satin' ? 'satin' : 'straight';
    const ids = { pointId: newPointId(), segmentId: newSegmentId() };
    projectStore.setState((p) => addPointToProject(p, click, kind, ids));
    uiStore.update({ selection: { kind: 'point', id: ids.pointId } });
    announce(describePoint(ids.pointId), true);
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.target !== svg) return;
    // Defensive: if a form field is somehow the focused descendant of
    // the SVG (custom controls, future overlays), bow out so typing
    // doesn't get hijacked. Mirrors the global skip in attachKeyboardShortcuts.
    if (shouldSkipForInput(ev)) return;
    const fine = ev.shiftKey ? 0.1 : 1;
    switch (ev.key) {
      case 'ArrowLeft':  ev.preventDefault(); nudge(-fine, 0); break;
      case 'ArrowRight': ev.preventDefault(); nudge(+fine, 0); break;
      case 'ArrowUp':    ev.preventDefault(); nudge(0, -fine); break;
      case 'ArrowDown':  ev.preventDefault(); nudge(0, +fine); break;
      case '[':          ev.preventDefault(); cycle(-1); break;
      case ']':          ev.preventDefault(); cycle(+1); break;
      case 'Enter':      ev.preventDefault(); appendPoint(); break;
      case 'Escape':
        if (uiStore.getState().selection !== null) {
          ev.preventDefault();
          uiStore.update({ selection: null });
          announce('Selection cleared', true);
        }
        break;
      // Anything else (Tab, etc.) bubbles normally.
    }
  }

  svg.addEventListener('keydown', onKeyDown);
  return () => svg.removeEventListener('keydown', onKeyDown);
}
