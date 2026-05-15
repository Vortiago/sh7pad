import { describe, it, expect, vi } from 'vitest';
import {
  createUiStore,
  defaultUiState,
  type UiState,
} from '../../ui/creator/store/uiStore.js';
import {
  DEFAULT_NEEDLE_NM, DEFAULT_THREAD_MM,
  DEFAULT_BG_COLOR, DEFAULT_THREAD_COLOR,
} from '../../ui/creator/preview/constants.js';

const blankUi = defaultUiState;

describe('defaultUiState', () => {
  it('pins the full UiState shape so new fields land here exactly once', () => {
    // The single source of truth for "every field on UiState." Adding a
    // new ui field without updating this assertion forces the author to
    // pick a sensible initial value rather than letting `undefined`
    // quietly leak through five test fixtures.
    expect(defaultUiState()).toStrictEqual({
      projects: [],
      currentId: '',
      mode: 'edit',
      selection: null,
      hover: null,
      hoverValid: true,
      tool: 'select',
      activeStitch: 'straight',
      pendingManualSatinStart: null,
      step: 0,
      playing: false,
      speed: 8,
      needleSizeNm: DEFAULT_NEEDLE_NM,
      threadDiameterMm: DEFAULT_THREAD_MM,
      threadColor: DEFAULT_THREAD_COLOR,
      bgColor: DEFAULT_BG_COLOR,
      showHistory: true,
      showFoot: true,
      userZoom: 1,
      previewUserZoom: 1,
      pan: { x: 0, y: 0 },
      previewPan: { x: 0, y: 0 },
      containerSize: { w: 600, h: 400 },
      leftCollapsed: false,
      rightCollapsed: false,
      layout: 'desktop',
      rulersShown: false,
    } satisfies UiState);
  });

  it('returns a fresh object on each call (nested objects too)', () => {
    // Tests mutate uiStore.update({ pan: ... }) and similar — the
    // factory must not hand out shared object references.
    const a = defaultUiState();
    const b = defaultUiState();
    expect(a).not.toBe(b);
    expect(a.pan).not.toBe(b.pan);
    expect(a.previewPan).not.toBe(b.previewPan);
    expect(a.containerSize).not.toBe(b.containerSize);
  });
});

describe('createUiStore', () => {
  it('getState returns the initial state', () => {
    const store = createUiStore(blankUi());
    expect(store.getState().mode).toBe('edit');
    expect(store.getState().tool).toBe('select');
  });

  it('setState with a function applies the updater and notifies subscribers', () => {
    const store = createUiStore(blankUi());
    const sub = vi.fn();
    store.subscribe(sub);
    store.setState((prev) => ({ ...prev, mode: 'preview' }));
    expect(store.getState().mode).toBe('preview');
    expect(sub).toHaveBeenCalledOnce();
  });

  it('setState with a value object replaces state', () => {
    const store = createUiStore(blankUi());
    const next = { ...blankUi(), tool: 'add' as const };
    store.setState(next);
    expect(store.getState().tool).toBe('add');
  });

  it('update applies a shallow patch', () => {
    const store = createUiStore(blankUi());
    store.update({ tool: 'move', selection: { kind: 'segment', id: 's1' } });
    expect(store.getState().tool).toBe('move');
    expect(store.getState().selection).toEqual({ kind: 'segment', id: 's1' });
    // Untouched fields preserved.
    expect(store.getState().mode).toBe('edit');
  });

  it('skip-when-equal: returning the same reference does not notify', () => {
    const store = createUiStore(blankUi());
    const sub = vi.fn();
    store.subscribe(sub);
    store.setState((prev) => prev); // identity update
    expect(sub).not.toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe function', () => {
    const store = createUiStore(blankUi());
    const sub = vi.fn();
    const unsub = store.subscribe(sub);
    store.update({ mode: 'preview' });
    expect(sub).toHaveBeenCalledOnce();
    unsub();
    store.update({ mode: 'edit' });
    expect(sub).toHaveBeenCalledOnce(); // not called again
  });

  it('multiple subscribers all fire in order', () => {
    const store = createUiStore(blankUi());
    const log: string[] = [];
    store.subscribe(() => log.push('a'));
    store.subscribe(() => log.push('b'));
    store.update({ tool: 'add' });
    expect(log).toEqual(['a', 'b']);
  });

  it('passes the latest state to subscribers', () => {
    const store = createUiStore(blankUi());
    let lastSeen: UiState | null = null;
    store.subscribe((s) => { lastSeen = s; });
    store.update({ step: 42 });
    expect(lastSeen).not.toBeNull();
    expect(lastSeen!.step).toBe(42);
  });
});
