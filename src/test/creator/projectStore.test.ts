import { describe, it, expect, vi } from 'vitest';
import { createProjectStore } from '../../creator/projectStore.js';
import { newProject } from '../../creator/project.js';

describe('createProjectStore', () => {
  it('getState returns the initial state', () => {
    const initial = newProject('Init');
    const store = createProjectStore(initial);
    expect(store.getState().id).toBe(initial.id);
  });

  it('setState updates state and notifies subscribers with the new state', () => {
    const store = createProjectStore(newProject('A'));
    const fn = vi.fn();
    store.subscribe(fn);
    store.setState((p) => ({ ...p, name: 'B' }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getState().name).toBe('B');
    expect(fn.mock.calls[0]?.[0]?.name).toBe('B');
  });

  it('setState with a plain value (not a function) replaces state', () => {
    const a = newProject('A');
    const b = { ...a, name: 'B' };
    const store = createProjectStore(a);
    store.setState(b);
    expect(store.getState().name).toBe('B');
  });

  it('subscribe returns an unsubscribe function', () => {
    const store = createProjectStore(newProject('A'));
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.setState((p) => ({ ...p, name: 'B' }));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    store.setState((p) => ({ ...p, name: 'C' }));
    expect(fn).toHaveBeenCalledTimes(1); // not called again
  });

  it('multiple subscribers all get notified', () => {
    const store = createProjectStore(newProject('A'));
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.setState((p) => ({ ...p, name: 'X' }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('setState syncs points[0] to the canonical Start Stitch (x mirror, y=0)', () => {
    const initial = newProject('A');
    const store = createProjectStore(initial);
    // Direct points[0] manipulation: the lockFirstPoint pass re-syncs
    // points[0].x to the (unchanged) Start Stitch X (= 0 by default)
    // and forces y back to 0 (Start Stitch is always at the Y axis).
    store.setState((p) => ({
      ...p,
      points: [
        { id: 'a', x: 5, y: 10 },
        { id: 'b', x: 7, y: 20 },
      ],
    }));
    const after = store.getState();
    expect(after.points[0]?.x).toBe(0); // mirrors startStitch.x (= 0 here)
    expect(after.points[0]?.y).toBe(0); // y forced to 0
  });
});
