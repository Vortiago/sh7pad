// Round 4 candidate #2: each non-sidebar pane subscribes to projectStore
// directly via its scheduler, so a project mutation re-renders the pane
// WITHOUT relying on mountCreator's projectStore-to-uiStore mirror.
//
// The sidebar already does this (Round 3). inspectorPeek already does
// this (pre-existing — it subscribes to both stores). These tests pin
// the same contract for editor / preview / stitchListPanel so the
// mirror's narrowed role (sync projects-list snapshot for the sidebar
// picker) stops being load-bearing for any pane's render loop.
//
// Each test attaches a pane against ONLY a projectStore + uiStore (no
// mountCreator wiring), captures a snapshot of the pane's DOM, mutates
// projectStore directly without ever touching uiStore, and asserts the
// DOM updated. The scheduler is synchronous (see scheduleRender.ts) so
// no microtask waits are required.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachEditorPane } from '../../ui/creator/editor/index.js';
import { attachPreviewPane } from '../../ui/creator/preview/index.js';
import { attachStitchListPanel } from '../../ui/creator/stitchListPanel/index.js';
import { createUiStore, defaultUiState, type UiState } from '../../ui/creator/store/uiStore.js';
import { createProjectStore } from '../../creator/projectStore.js';
import { SAMPLE } from '../../creator/project.js';
import type { EditorPaneHandle } from '../../ui/creator/editor/index.js';
import type { PreviewPaneHandle } from '../../ui/creator/preview/index.js';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

function buildEditorDom(): void {
  document.body.innerHTML = `
    <div id="ed-toolbar"></div>
    <div id="ed-canvas-wrap">
      <svg id="ed-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
      <div id="ruler-top"></div>
      <div id="ruler-left"></div>
    </div>
    <div id="ed-inspector"></div>
  `;
}

function buildPreviewDom(): void {
  document.body.innerHTML = `
    <div id="pv-header"></div>
    <div id="pv-canvas-wrap">
      <svg id="pv-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
    <div id="pv-transport"></div>
  `;
}

function buildStitchListDom(): void {
  document.body.innerHTML = `
    <div id="stitch-list-header"></div>
    <ol id="stitch-list"></ol>
  `;
}

function blankUi(overrides: Partial<UiState> = {}): UiState {
  return { ...defaultUiState(), ...overrides };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('attachEditorPane — auto-subscribes to projectStore directly', () => {
  beforeEach(() => buildEditorDom());

  it('re-renders the canvas when projectStore mutates (no uiStore update)', () => {
    const project = SAMPLE();
    const projectStore = createProjectStore(project);
    const uiStore = createUiStore(blankUi({
      projects: [project],
      currentId: project.id,
      containerSize: { w: 600, h: 400 },
    }));

    attachEditorPane({ doc: document, projectStore, uiStore });

    const canvas = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    const segCountBefore = canvas.querySelectorAll('[data-segment-id]').length;

    // Mutate the project DIRECTLY — drop a segment.
    projectStore.setState((p) => ({
      ...p,
      segments: p.segments.slice(0, -1),
      updatedAt: Date.now(),
    }));

    const segCountAfter = canvas.querySelectorAll('[data-segment-id]').length;
    expect(segCountAfter).toBe(segCountBefore - 1);
  });
});

describe('attachPreviewPane — auto-subscribes to projectStore directly', () => {
  beforeEach(() => buildPreviewDom());

  it('re-renders the preview header when projectStore mutates (preview mode)', () => {
    const project = SAMPLE();
    const projectStore = createProjectStore(project);
    const uiStore = createUiStore(blankUi({
      projects: [project],
      currentId: project.id,
      mode: 'preview',
    }));

    attachPreviewPane({ doc: document, projectStore, uiStore });

    const header = document.getElementById('pv-header')!;
    const headerBefore = header.textContent ?? '';
    expect(headerBefore).toMatch(/Preview · 0\/(\d+) drops/);
    const dropsBefore = Number(headerBefore.match(/0\/(\d+)/)![1]);

    // Drop every segment — the "drops" count must change.
    projectStore.setState((p) => ({
      ...p,
      segments: [],
      updatedAt: Date.now(),
    }));

    const headerAfter = header.textContent ?? '';
    const dropsAfter = Number(headerAfter.match(/0\/(\d+)/)![1]);
    expect(dropsAfter).not.toBe(dropsBefore);
  });
});

describe('attachStitchListPanel — auto-subscribes to projectStore directly', () => {
  beforeEach(() => buildStitchListDom());

  it('re-renders rows when projectStore mutates (no uiStore update)', () => {
    const project = SAMPLE();
    const projectStore = createProjectStore(project);
    const uiStore = createUiStore(blankUi({
      projects: [project],
      currentId: project.id,
    }));

    const editor = {
      deleteSegment: () => {},
      deleteLastManual: () => {},
    } as unknown as EditorPaneHandle;
    const preview = {
      scrubTo: () => {},
    } as unknown as PreviewPaneHandle;

    attachStitchListPanel({
      doc: document,
      storage: new FakeStorage(),
      projectStore,
      uiStore,
      editor,
      preview,
    });

    const list = document.getElementById('stitch-list') as HTMLOListElement;
    const rowsBefore = list.querySelectorAll('li[data-row]').length;

    // Drop one segment — rows should shrink by 1.
    projectStore.setState((p) => ({
      ...p,
      segments: p.segments.slice(0, -1),
      updatedAt: Date.now(),
    }));

    const rowsAfter = list.querySelectorAll('li[data-row]').length;
    expect(rowsAfter).toBe(rowsBefore - 1);
  });
});
