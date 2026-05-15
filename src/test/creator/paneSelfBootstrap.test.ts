// Self-bootstrap tests for the non-sidebar panes. After Round 4 each
// pane (editor, preview, stitchListPanel) paints its initial state at
// attach time, the same way attachSidebar already did. Previously
// mountCreator carried a 6-line block of explicit kicks
// (editor.render() / renderInspector() / renderToolbar(),
//  preview.render(), stitchList.render() / renderHeader()) — that block
// is gone now, so these tests guard that each attach* function self-paints.

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

describe('attachEditorPane self-bootstraps', () => {
  beforeEach(() => buildEditorDom());

  it('paints toolbar, canvas, and inspector at attach time (no manual kick)', () => {
    const project = SAMPLE();
    const firstSeg = project.segments[0]!;
    const projectStore = createProjectStore(project);
    const uiStore = createUiStore(blankUi({
      projects: [project],
      currentId: project.id,
      // Seed containerSize so the canvas renderer has a non-zero viewport.
      containerSize: { w: 600, h: 400 },
      // Seed a selection so the inspector has something to render — that's
      // the load-bearing observation: renderInspector ran without a kick.
      selection: { kind: 'segment', id: firstSeg.id },
    }));

    attachEditorPane({ doc: document, projectStore, uiStore });

    // Toolbar: should have rendered tool / stitch buttons.
    const toolbar = document.getElementById('ed-toolbar')!;
    expect(toolbar.querySelector('[data-tool="select"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-tool="add"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-stitch="straight"]')).not.toBeNull();

    // Canvas: should have the hoop background rect from renderEditorScene.
    const canvas = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    expect(canvas.querySelector('rect.ed-hoop')).not.toBeNull();

    // Inspector: with a segment selected, renderSegmentInspector populates
    // the strip. data-segment-id reflects the selection.
    const inspector = document.getElementById('ed-inspector')!;
    expect(inspector.dataset['segmentId']).toBe(firstSeg.id);
  });
});

describe('attachPreviewPane self-bootstraps', () => {
  beforeEach(() => buildPreviewDom());

  it('paints transport + header when uiStore.mode is preview', () => {
    const project = SAMPLE();
    const projectStore = createProjectStore(project);
    const uiStore = createUiStore(blankUi({
      projects: [project],
      currentId: project.id,
      mode: 'preview',
    }));

    attachPreviewPane({ doc: document, projectStore, uiStore });

    // Header: should contain the "Preview · N/M drops" label.
    const header = document.getElementById('pv-header')!;
    expect(header.textContent ?? '').toMatch(/Preview/);
    expect(header.textContent ?? '').toMatch(/drops/);

    // Transport: should have play/pause + scrubber controls.
    const transport = document.getElementById('pv-transport')!;
    expect(transport.children.length).toBeGreaterThan(0);
  });
});

describe('attachStitchListPanel self-bootstraps', () => {
  beforeEach(() => buildStitchListDom());

  it('paints list rows and header chrome at attach time', () => {
    const project = SAMPLE();
    const projectStore = createProjectStore(project);
    const uiStore = createUiStore(blankUi({
      projects: [project],
      currentId: project.id,
    }));

    // Cheap pane handles for the cross-pane signals only; we don't exercise
    // them here.
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

    // List: should have one row per segment + START row.
    const list = document.getElementById('stitch-list') as HTMLOListElement;
    const rows = list.querySelectorAll('li[data-row]');
    expect(rows.length).toBeGreaterThan(0);
    expect(list.querySelector('li[data-row="start"]')).not.toBeNull();

    // Chrome: header should contain the right-collapse toggle button.
    const header = document.getElementById('stitch-list-header')!;
    expect(header.querySelector('[data-action="toggle-right-collapse"]')).not.toBeNull();
  });
});
