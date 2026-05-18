// @vitest-environment jsdom
// Sidebar auto-subscription tests. attachSidebar attaches a scheduler
// subscription to uiStore the same way editor / preview / stitchListPanel
// do — but rebuilds named sub-regions (projects, stitch-settings,
// preview-settings, bg-image, mode-switch) rather than the whole sidebar,
// so the preview-settings colour picker isn't detached mid-pick.
//
// The pre-existing manual sidebar.render() calls in mountCreator.setMode
// and sidebar/callbacks.ts were a workaround for the missing subscription.
// These tests exercise the subscription path directly by mutating
// uiStore without going through any callback, so they fail when only
// the manual fan-out is present (state mutated → no manual render →
// DOM stale).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSidebar } from '../../ui/creator/sidebar/index.js';
import { createUiStore, defaultUiState, type UiState } from '../../ui/creator/store/uiStore.js';
import { createProjectStore } from '../../creator/projectStore.js';
import { newProject } from '../../creator/project.js';
import type { EditorPaneHandle } from '../../ui/creator/editor/index.js';
import type { PreviewPaneHandle } from '../../ui/creator/preview/index.js';
import type { Project } from '../../creator/types.js';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

function mockEditor(): EditorPaneHandle {
  return {
    setActiveStitch: vi.fn(),
    setTool: vi.fn(),
    deleteSegment: vi.fn(),
    deleteLastManual: vi.fn(),
    deleteSelectedSegmentOrPoint: vi.fn(() => false),
    inspectorCallbacks: {
      onChange: vi.fn(),
      onSubdivide: vi.fn(),
      onDelete: vi.fn(),
      onDeletePoint: vi.fn(),
    },
  } as unknown as EditorPaneHandle;
}

function mockPreview(): PreviewPaneHandle {
  return {
    rebindPlayback: vi.fn(),
    scrubTo: vi.fn(),
  };
}

function buildHostDom(): { sidebarHost: HTMLElement; modeSwitchHost: HTMLElement } {
  document.body.innerHTML = `
    <aside id="sidebar"></aside>
    <div id="mode-switch"></div>
  `;
  return {
    sidebarHost: document.getElementById('sidebar') as HTMLElement,
    modeSwitchHost: document.getElementById('mode-switch') as HTMLElement,
  };
}

function blankUi(overrides: Partial<UiState> = {}): UiState {
  return { ...defaultUiState(), ...overrides };
}

interface Harness {
  uiStore: ReturnType<typeof createUiStore>;
  projectStore: ReturnType<typeof createProjectStore>;
  sidebarHost: HTMLElement;
  modeSwitchHost: HTMLElement;
  editor: EditorPaneHandle;
  preview: PreviewPaneHandle;
  setMode: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
  deleteProject: ReturnType<typeof vi.fn>;
}

function attach(initial: Project, ui?: Partial<UiState>): Harness {
  const { sidebarHost, modeSwitchHost } = buildHostDom();
  const projectStore = createProjectStore(initial);
  const uiStore = createUiStore(blankUi({
    projects: [initial],
    currentId: initial.id,
    ...ui,
  }));
  const editor = mockEditor();
  const preview = mockPreview();
  const setMode = vi.fn();
  const persist = vi.fn();
  const deleteProject = vi.fn();
  attachSidebar({
    doc: document,
    storage: new FakeStorage(),
    projectStore,
    uiStore,
    editor,
    preview,
    setMode,
    persist,
    deleteProject,
  });
  return { uiStore, projectStore, sidebarHost, modeSwitchHost, editor, preview, setMode, persist, deleteProject };
}

describe('sidebar auto-subscribes to uiStore', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('rebuilds the projects region when uiStore.projects changes', () => {
    const a = newProject('Alpha');
    const h = attach(a);
    // Direct store mutation — no callback, no manual render.
    // Without auto-subscription the DOM still shows one row.
    expect(h.sidebarHost.querySelectorAll('[data-project-id]').length).toBe(1);
    const b = newProject('Beta');
    h.uiStore.update({ projects: [a, b] });
    expect(h.sidebarHost.querySelectorAll('[data-project-id]').length).toBe(2);
  });

  it('rebuilds the mode-switch region when uiStore.mode flips', () => {
    const a = newProject('Alpha');
    const h = attach(a);
    // Initially "edit" is active in the mode-switch.
    expect(h.modeSwitchHost.querySelector('[data-mode="edit"]')?.getAttribute('data-active')).toBe('true');
    expect(h.modeSwitchHost.querySelector('[data-mode="preview"]')?.getAttribute('data-active')).toBe('false');
    h.uiStore.update({ mode: 'preview' });
    expect(h.modeSwitchHost.querySelector('[data-mode="edit"]')?.getAttribute('data-active')).toBe('false');
    expect(h.modeSwitchHost.querySelector('[data-mode="preview"]')?.getAttribute('data-active')).toBe('true');
  });

  it('renders Preview Settings region after uiStore.mode flips to preview', () => {
    const a = newProject('Alpha');
    const h = attach(a);
    expect(h.sidebarHost.querySelector('[data-section="preview-settings"]')).toBeNull();
    h.uiStore.update({ mode: 'preview' });
    expect(h.sidebarHost.querySelector('[data-section="preview-settings"]')).not.toBeNull();
  });

  it('rebuilds preview-settings region when uiStore.showHistory changes', () => {
    const a = newProject('Alpha');
    const h = attach(a, { mode: 'preview', showHistory: true });
    const btn = h.sidebarHost.querySelector<HTMLButtonElement>('[data-action="toggle-history"]');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
    h.uiStore.update({ showHistory: false });
    const after = h.sidebarHost.querySelector<HTMLButtonElement>('[data-action="toggle-history"]');
    expect(after?.getAttribute('aria-pressed')).toBe('false');
  });

  it('preserves focus on a color picker mid-pick when an unrelated uiStore field changes', () => {
    const a = newProject('Alpha');
    const h = attach(a, { mode: 'preview' });
    const picker = h.sidebarHost.querySelector<HTMLInputElement>('input[data-action="thread-color"]');
    expect(picker).not.toBeNull();
    picker!.focus();
    expect(document.activeElement).toBe(picker);

    // Drive an unrelated store update — `step` has nothing to do with
    // preview-settings inputs. The preview-settings region must NOT
    // rebuild while the picker is focused, or the focused input is
    // detached and `document.activeElement` becomes <body>.
    h.uiStore.update({ step: 3 });
    expect(document.activeElement).toBe(picker);
  });

  it('preserves focus on a color picker mid-pick when a sibling region (projects) is invalidated', () => {
    const a = newProject('Alpha');
    const h = attach(a, { mode: 'preview' });
    const picker = h.sidebarHost.querySelector<HTMLInputElement>('input[data-action="thread-color"]');
    picker!.focus();

    // Adding a project rebuilds the projects-region but must not touch
    // the preview-settings region that holds the focused input.
    const b = newProject('Beta');
    h.uiStore.update({ projects: [a, b] });

    // Focus survived because the preview-settings region was untouched
    // (and the projects region's replaceChildren only blew away the
    // projects subtree, not the color picker).
    expect(document.activeElement).toBe(picker);
    // Sanity: projects region did update.
    expect(h.sidebarHost.querySelectorAll('[data-project-id]').length).toBe(2);
  });

  it('rebuilds the stitch-settings region when projectStore changes (threadTension)', () => {
    const a = newProject('Alpha');
    const h = attach(a);
    const range = h.sidebarHost.querySelector<HTMLInputElement>('[data-control="threadTensionRange"]');
    const initialValue = Number(range!.value);
    h.projectStore.setState((p) => ({ ...p, threadTension: initialValue + 1, updatedAt: Date.now() }));
    const after = h.sidebarHost.querySelector<HTMLInputElement>('[data-control="threadTensionRange"]');
    expect(Number(after!.value)).toBe(initialValue + 1);
  });

  it('switching to a manual project demotes ui.tool from "move" to "select"', () => {
    // Move is design-only. On project switch the sidebar
    // must reset ui.tool so the user isn't stuck on a tool whose
    // toolbar button vanished.
    const designProj = newProject('Design');
    const manualProj = newProject('Manual', { mode: 'manual', suggestedFoot: 'S' });
    const h = attach(designProj, { projects: [designProj, manualProj], tool: 'move' });
    expect(h.uiStore.getState().tool).toBe('move');
    h.sidebarHost
      .querySelector<HTMLElement>(`[data-project-id="${manualProj.id}"]`)
      ?.click();
    expect(h.uiStore.getState().tool).toBe('select');
  });

  it('switching to a design project keeps ui.tool === "move"', () => {
    const a = newProject('Alpha');
    const b = newProject('Beta');
    const h = attach(a, { projects: [a, b], tool: 'move' });
    h.sidebarHost
      .querySelector<HTMLElement>(`[data-project-id="${b.id}"]`)
      ?.click();
    expect(h.uiStore.getState().tool).toBe('move');
  });
});
