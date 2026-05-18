// @vitest-environment jsdom
// inspectorPeek — phone inspector adapter. Owns its own render host
// (a fresh .ed-inspector inside .ip-body) and re-renders via
// renderSegmentInspector on every uiStore / projectStore change. Auto-
// shows the peek state when uiStore.selection resolves to a segment
// or point; drag handle toggles peek ↔ overlay; X close clears the
// selection so the peek retracts.

import { beforeEach, describe, expect, it } from 'vitest';
import { createInspectorPeek } from '../../ui/creator/inspectorPeek/index.js';
import { nextPeekState } from '../../ui/creator/inspectorPeek/state.js';
import type { InspectorCallbacks } from '../../ui/creator/segmentInspector/index.js';
import { createUiStore, defaultUiState, type Selection } from '../../ui/creator/store/uiStore.js';
import { createProjectStore } from '../../creator/projectStore.js';
import { newProject } from '../../creator/project.js';

function makeProjectWithSegment(segId: string): ReturnType<typeof createProjectStore> {
  return createProjectStore({
    ...newProject(),
    points: [
      { id: 'pt_a', x: 0, y: 0 },
      { id: 'pt_b', x: 1, y: 1 },
    ],
    segments: [{ id: segId, from: 'pt_a', to: 'pt_b', type: 'straight' }],
  });
}

function makeUi(selection: Selection | null = null): ReturnType<typeof createUiStore> {
  return createUiStore({ ...defaultUiState(), selection });
}

const noopCallbacks: InspectorCallbacks = {
  onChange: () => {},
  onSubdivide: () => {},
  onDelete: () => {},
  onDeletePoint: () => {},
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('nextPeekState', () => {
  it('hidden stays hidden regardless of drag (selection drives visibility)', () => {
    expect(nextPeekState('hidden', 200)).toBe('hidden');
  });

  it('drag up from peek expands to overlay', () => {
    expect(nextPeekState('peek', 100)).toBe('overlay');
  });

  it('drag down from overlay collapses to peek', () => {
    expect(nextPeekState('overlay', -100)).toBe('peek');
  });

  it('small drags inside the deadzone keep the same state', () => {
    expect(nextPeekState('peek', 10)).toBe('peek');
    expect(nextPeekState('overlay', -10)).toBe('overlay');
  });
});

describe('createInspectorPeek', () => {
  it('starts hidden when nothing is selected', () => {
    const uiStore = makeUi(null);
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('hidden');
  });

  it('shows peek when uiStore.selection resolves to a segment on mount', () => {
    const uiStore = makeUi({ kind: 'segment', id: 's_test' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('peek');
  });

  it('shows peek when selection is an existing point', () => {
    const uiStore = makeUi({ kind: 'point', id: 'pt_a' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('peek');
  });

  it('stays hidden when selection resolves to neither a segment nor a point', () => {
    const uiStore = makeUi({ kind: 'segment', id: 'orphan_id' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('hidden');
  });

  it('shows peek on segment selection, hides on deselect', () => {
    const uiStore = makeUi(null);
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('hidden');
    uiStore.update({ selection: { kind: 'segment', id: 's_test' } });
    expect(peek.el.dataset['peekState']).toBe('peek');
    uiStore.update({ selection: null });
    expect(peek.el.dataset['peekState']).toBe('hidden');
  });

  it('retracts peek when the selected segment is deleted from the project', () => {
    const uiStore = makeUi({ kind: 'segment', id: 's_test' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('peek');
    projectStore.setState((p) => ({ ...p, segments: [] }));
    expect(peek.el.dataset['peekState']).toBe('hidden');
  });

  it('handle click toggles peek ↔ overlay', () => {
    const uiStore = makeUi({ kind: 'segment', id: 's_test' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('peek');
    const handle = peek.el.querySelector<HTMLButtonElement>('.ip-handle')!;
    handle.click();
    expect(peek.el.dataset['peekState']).toBe('overlay');
    handle.click();
    expect(peek.el.dataset['peekState']).toBe('peek');
  });

  it('renders the segment inspector into its own host (a fresh .ed-inspector inside .ip-body)', () => {
    const uiStore = makeUi({ kind: 'segment', id: 's_test' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    // Phone adapter doesn't re-host #ed-inspector — it owns a freshly
    // created element that renderSegmentInspector stamps with the
    // .ed-inspector class.
    const renderHost = peek.el.querySelector('.ip-body')?.firstElementChild as HTMLElement | null;
    expect(renderHost).not.toBeNull();
    expect(renderHost!.id).toBe('');
    expect(renderHost!.classList.contains('ed-inspector')).toBe(true);
    // The inspector contents render into that host (segment selection ⇒
    // segmentId stamped on the host).
    expect(renderHost!.dataset['segmentId']).toBe('s_test');
  });

  it('destroy removes the peek wrapper from the host', () => {
    const uiStore = makeUi({ kind: 'segment', id: 's_test' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(document.body.contains(peek.el)).toBe(true);
    peek.destroy();
    expect(document.body.contains(peek.el)).toBe(false);
  });

  it('close button clears the selection so the peek retracts', () => {
    const uiStore = makeUi({ kind: 'segment', id: 's_test' });
    const projectStore = makeProjectWithSegment('s_test');
    const peek = createInspectorPeek(document.body, {
      uiStore, projectStore, callbacks: noopCallbacks,
    });
    expect(peek.el.dataset['peekState']).toBe('peek');
    const closeBtn = peek.el.querySelector<HTMLButtonElement>('[data-action="close-peek"]');
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();
    expect(uiStore.getState().selection).toBeNull();
    expect(peek.el.dataset['peekState']).toBe('hidden');
  });

  it('callbacks fire when the segment-inspector controls are interacted with', () => {
    const uiStore = makeUi({ kind: 'segment', id: 's_test' });
    const projectStore = makeProjectWithSegment('s_test');
    const deletes: string[] = [];
    const callbacks: InspectorCallbacks = {
      ...noopCallbacks,
      onDelete: (target) => {
        if (target.kind === 'segment') deletes.push(target.id);
      },
    };
    const peek = createInspectorPeek(document.body, { uiStore, projectStore, callbacks });
    const deleteBtn = peek.el.querySelector<HTMLButtonElement>('[data-action="delete"]');
    expect(deleteBtn).not.toBeNull();
    deleteBtn!.click();
    expect(deletes).toEqual(['s_test']);
  });
});
