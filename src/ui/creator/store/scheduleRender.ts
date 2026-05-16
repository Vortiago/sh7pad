// Synchronous render coalescer. Each pane wraps its `renderAll()` in a
// scheduler so a render kicked off by an event handler runs immediately
// (so tests + DOM queries see the up-to-date page synchronously) but
// store updates that happen DURING that render fold into a single
// follow-up render rather than spawning N nested ones.
//
// Why synchronous, not microtask: the test suite (and the way users feel
// the UI) expects that clicking a button and immediately reading the DOM
// reflects the click. A microtask defers past `await Promise.resolve()`,
// breaking that contract — and the perf win was small at this scale.
//
// Reentrancy is the only thing we coalesce: when render() triggers a
// store update that re-fires schedule(), we set a `dirty` flag and the
// outer loop re-renders once before returning. Multiple top-level
// schedule() calls each render once.

export interface RenderScheduler {
  /**
   * Request a render. Runs synchronously. If schedule() is called again
   * during the render (reentrantly, from a store subscriber the render
   * triggered), the outer call loops once more rather than recursing.
   */
  schedule(): void;
}

export function createRenderScheduler(render: () => void): RenderScheduler {
  let rendering = false;
  let dirty = false;
  return {
    schedule(): void {
      if (rendering) {
        dirty = true;
        return;
      }
      rendering = true;
      try {
        do {
          dirty = false;
          render();
        } while (dirty);
      } finally {
        rendering = false;
      }
    },
  };
}

/** Minimal store contract the scheduler needs: just the ability to
 *  subscribe to change events. Matches both ProjectStore and UiStore
 *  without dragging their full API into this module. */
interface SubscribableStore {
  subscribe(listener: () => void): unknown;
}

/**
 * Create a render scheduler and wire it to one or more stores. Replaces
 * the 3-line boilerplate every pane controller used to repeat
 * (createRenderScheduler + subscribe(uiStore) + subscribe(projectStore))
 * so adding a new store to a pane — or forgetting to subscribe to one —
 * shows up at the call site instead of being silently absent.
 */
export function attachStoresToScheduler(
  render: () => void,
  stores: readonly SubscribableStore[],
): RenderScheduler {
  const scheduler = createRenderScheduler(render);
  for (const store of stores) store.subscribe(() => scheduler.schedule());
  return scheduler;
}
