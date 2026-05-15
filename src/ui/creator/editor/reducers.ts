// Editor pane reducer wrappers. Each helper combines a project-level
// reducer (from src/creator/project.ts) with the editor's selection
// bookkeeping (clear selection on delete, select first-half on
// subdivide, etc.). Pulled out of editor/index.ts so the orchestrator
// stays focused on wiring rather than per-action plumbing.

import { newPointId, newSegmentId } from '../../../creator/ids.js';
import {
  DEFAULT_SATIN_DENSITY_MM,
  DEFAULT_SATIN_WIDTH_MM,
  removeSegment,
  removePoint,
  subdivideSegment as subdivideSegmentReducer,
  updateSegment,
} from '../../../creator/project.js';
import type { SatinSegment } from '../../../creator/types.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';

export interface EditorReducerDeps {
  projectStore: ProjectStore;
  uiStore: UiStore;
}

export interface EditorReducers {
  deleteSegment(segId: string): void;
  deletePoint(ptId: string): void;
  deleteSelectedSegmentOrPoint(): boolean;
  subdivideSegment(segId: string): void;
  convertSegment(segId: string): void;
}

export function createEditorReducers(deps: EditorReducerDeps): EditorReducers {
  const { projectStore, uiStore } = deps;

  function deleteSegment(segId: string): void {
    if (!projectStore.getState().segments.some((s) => s.id === segId)) return;
    const sel = uiStore.getState().selection;
    if (sel?.kind === 'segment' && sel.id === segId) {
      uiStore.update({ selection: null });
    }
    projectStore.setState((p) => removeSegment(p, segId));
  }

  function deletePoint(ptId: string): void {
    const project = projectStore.getState();
    if (project.points[0]?.id === ptId) return;
    if (!project.points.some((pt) => pt.id === ptId)) return;
    const sel = uiStore.getState().selection;
    if (sel?.kind === 'point' && sel.id === ptId) {
      uiStore.update({ selection: null });
    }
    projectStore.setState((p) => removePoint(p, ptId));
  }

  function deleteSelectedSegmentOrPoint(): boolean {
    const sel = uiStore.getState().selection;
    if (!sel) return false;
    if (sel.kind === 'segment') {
      deleteSegment(sel.id);
      return true;
    }
    if (sel.kind === 'point') {
      // Anchor protection lives inside deletePoint, so the START point is
      // a safe no-op here.
      deletePoint(sel.id);
      return true;
    }
    return false;
  }

  function subdivideSegment(segId: string): void {
    const ids = {
      pointId: newPointId(),
      segmentAId: newSegmentId(),
      segmentBId: newSegmentId(),
    };
    projectStore.setState((p) => subdivideSegmentReducer(p, segId, ids));
    // Keep the inspector showing something useful — select the first half.
    uiStore.update({ selection: { kind: 'segment', id: ids.segmentAId } });
  }

  /** Long-press "Convert to satin/straight" on a segment. Mirrors the
   *  segmentInspector type-select: switching to satin seeds default
   *  width/density; switching to straight just drops the satin fields. */
  function convertSegment(segId: string): void {
    const seg = projectStore.getState().segments.find((s) => s.id === segId);
    if (!seg) return;
    if (seg.type === 'satin') {
      projectStore.setState((p) => updateSegment(p, segId, { type: 'straight' }));
    } else {
      projectStore.setState((p) => updateSegment(p, segId, {
        type: 'satin',
        widthStart: DEFAULT_SATIN_WIDTH_MM,
        widthEnd: DEFAULT_SATIN_WIDTH_MM,
        density: DEFAULT_SATIN_DENSITY_MM,
      } as Partial<SatinSegment>));
    }
  }

  return {
    deleteSegment,
    deletePoint,
    deleteSelectedSegmentOrPoint,
    subdivideSegment,
    convertSegment,
  };
}
