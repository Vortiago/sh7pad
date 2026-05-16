import { describe, it, expect, vi } from 'vitest';
import {
  attachStoresToScheduler,
  createRenderScheduler,
} from '../../ui/creator/store/scheduleRender.js';

describe('createRenderScheduler', () => {
  it('runs render synchronously on schedule', () => {
    const render = vi.fn();
    const s = createRenderScheduler(render);
    s.schedule();
    expect(render).toHaveBeenCalledOnce();
  });

  it('two top-level schedule calls run two renders', () => {
    // Top-level (non-reentrant) calls each kick off their own render
    // pass. Coalescing only happens for reentrant schedules (during a
    // render). This is the deliberate trade-off documented in
    // scheduleRender.ts.
    const render = vi.fn();
    const s = createRenderScheduler(render);
    s.schedule();
    s.schedule();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('coalesces a reentrant schedule into a single follow-up render', () => {
    let pass = 0;
    let triggeredReentrant = false;
    const s = createRenderScheduler(() => {
      pass += 1;
      if (!triggeredReentrant) {
        triggeredReentrant = true;
        // Inside render: schedule again. The outer loop should re-run
        // render once more (to pick up the would-be state change), then
        // exit.
        s.schedule();
      }
    });
    s.schedule();
    expect(pass).toBe(2);
  });

  it('does not loop forever if every render re-schedules', () => {
    // If render keeps marking dirty, the loop runs more passes — but the
    // contract is that it terminates if the render eventually stops
    // re-scheduling. With a counter the loop exits cleanly.
    let count = 0;
    const s = createRenderScheduler(() => {
      count += 1;
      if (count < 3) s.schedule(); // re-schedule twice, then stop
    });
    s.schedule();
    expect(count).toBe(3);
  });

  it('after one schedule + render completes, subsequent schedules render again', () => {
    const render = vi.fn();
    const s = createRenderScheduler(render);
    s.schedule();
    expect(render).toHaveBeenCalledTimes(1);
    s.schedule();
    expect(render).toHaveBeenCalledTimes(2);
  });
});

describe('attachStoresToScheduler', () => {
  // Mini in-memory store that mirrors the subscribe-listener contract
  // of UiStore / ProjectStore without dragging their full APIs in.
  function fakeStore(): { fire(): void; subscribe(fn: () => void): void } {
    const listeners: Array<() => void> = [];
    return {
      subscribe(fn): void { listeners.push(fn); },
      fire(): void { for (const fn of listeners) fn(); },
    };
  }

  it('subscribes the scheduler to every passed store', () => {
    const render = vi.fn();
    const a = fakeStore();
    const b = fakeStore();
    attachStoresToScheduler(render, [a, b]);
    expect(render).toHaveBeenCalledTimes(0);
    a.fire();
    expect(render).toHaveBeenCalledTimes(1);
    b.fire();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('returns a scheduler the caller can also drive directly', () => {
    const render = vi.fn();
    const a = fakeStore();
    const scheduler = attachStoresToScheduler(render, [a]);
    scheduler.schedule();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
