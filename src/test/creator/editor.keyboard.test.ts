// @vitest-environment jsdom
// Canvas keyboard navigation — synthetic keydown events on the SVG
// drive nudges, point cycling, append, and deselect. The live-region
// element is populated debounced for nudges, immediate for selection.

import { beforeEach, describe, expect, it } from 'vitest';
import { attachCanvasKeyboard } from '../../ui/creator/editor/keyboard.js';
import { createUiStore, defaultUiState } from '../../ui/creator/store/uiStore.js';
import { createProjectStore } from '../../creator/projectStore.js';
import { newProject } from '../../creator/project.js';

function setup(): {
  svg: SVGSVGElement;
  liveRegion: HTMLElement;
  projectStore: ReturnType<typeof createProjectStore>;
  uiStore: ReturnType<typeof createUiStore>;
} {
  document.body.innerHTML = '';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg') as SVGSVGElement;
  svg.tabIndex = 0;
  document.body.appendChild(svg);
  const liveRegion = document.createElement('div');
  liveRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(liveRegion);

  // 3 points so cycling has somewhere to go.
  const proj = newProject('keyboard test', { mode: 'design', suggestedFoot: 'S' });
  proj.points = [
    { id: 'p1', x: 0, y: 0 },
    { id: 'p2', x: 5, y: 5 },
    { id: 'p3', x: 10, y: 10 },
  ];
  const projectStore = createProjectStore(proj);
  const uiStore = createUiStore({
    ...defaultUiState(),
    projects: [proj],
    currentId: proj.id,
  });

  attachCanvasKeyboard({ svg, projectStore, uiStore, liveRegion });

  return { svg, liveRegion, projectStore, uiStore };
}

function dispatchKey(svg: SVGSVGElement, key: string, shift = false): void {
  const ev = new KeyboardEvent('keydown', {
    key,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  // jsdom needs target set explicitly because dispatchEvent on the SVG
  // sets target = svg, which is what attachCanvasKeyboard checks.
  svg.dispatchEvent(ev);
}

describe('attachCanvasKeyboard', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); });

  it('] cycles to the next point when nothing is selected', () => {
    dispatchKey(h.svg, ']');
    expect(h.uiStore.getState().selection).toEqual({ kind: 'point', id: 'p1' });
  });

  it('] from p1 cycles to p2', () => {
    h.uiStore.update({ selection: { kind: 'point', id: 'p1' } });
    dispatchKey(h.svg, ']');
    expect(h.uiStore.getState().selection).toEqual({ kind: 'point', id: 'p2' });
  });

  it('[ from p1 wraps to the last point', () => {
    h.uiStore.update({ selection: { kind: 'point', id: 'p1' } });
    dispatchKey(h.svg, '[');
    expect(h.uiStore.getState().selection).toEqual({ kind: 'point', id: 'p3' });
  });

  it('ArrowRight nudges the selected point by 1mm in X', () => {
    h.uiStore.update({ selection: { kind: 'point', id: 'p2' } });
    dispatchKey(h.svg, 'ArrowRight');
    const updated = h.projectStore.getState().points.find((p) => p.id === 'p2');
    expect(updated?.x).toBe(6);
  });

  it('Shift+ArrowDown fine-nudges by 0.1mm', () => {
    h.uiStore.update({ selection: { kind: 'point', id: 'p2' } });
    dispatchKey(h.svg, 'ArrowDown', true);
    const updated = h.projectStore.getState().points.find((p) => p.id === 'p2');
    expect(updated?.y).toBeCloseTo(5.1);
  });

  it('Esc clears the selection and announces immediately', () => {
    h.uiStore.update({ selection: { kind: 'point', id: 'p2' } });
    dispatchKey(h.svg, 'Escape');
    expect(h.uiStore.getState().selection).toBeNull();
    expect(h.liveRegion.textContent).toBe('Selection cleared');
  });

  it('Enter appends a new point selected', () => {
    const before = h.projectStore.getState().points.length;
    h.uiStore.update({ selection: { kind: 'point', id: 'p3' } });
    dispatchKey(h.svg, 'Enter');
    const after = h.projectStore.getState().points;
    expect(after.length).toBe(before + 1);
    expect(h.uiStore.getState().selection).toEqual({ kind: 'point', id: after[after.length - 1]!.id });
  });

  it('does not act when the event target is not the SVG (no Tab trap)', () => {
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    h.uiStore.update({ selection: { kind: 'point', id: 'p2' } });
    other.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
    }));
    const pt = h.projectStore.getState().points.find((p) => p.id === 'p2');
    expect(pt?.x).toBe(5); // unchanged
  });
});
