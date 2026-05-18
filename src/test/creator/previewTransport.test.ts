// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderPreviewTransport, updatePreviewTransport } from '../../ui/creator/preview/transport.js';

const newDiv = (): HTMLDivElement => document.createElement('div');

const baseState = {
  step: 0, totalSteps: 10, playing: false, speed: 8,
  currentXmm: 0, currentYmm: 0,
};

const noopCb = {
  onPlay: () => {}, onPause: () => {}, onReset: () => {},
  onStepBack: () => {}, onStepForward: () => {}, onToEnd: () => {},
  onScrub: () => {}, onSpeed: () => {},
  onZoom: () => {},
};

describe('renderPreviewTransport', () => {
  it('renders play, reset, step-back, step-forward, end buttons', () => {
    const div = newDiv();
    renderPreviewTransport(div, baseState, noopCb);
    expect(div.querySelector('[data-action="play"]')).not.toBeNull();
    expect(div.querySelector('[data-action="pause"]')).not.toBeNull();
    expect(div.querySelector('[data-action="reset"]')).not.toBeNull();
    expect(div.querySelector('[data-action="step-back"]')).not.toBeNull();
    expect(div.querySelector('[data-action="step-forward"]')).not.toBeNull();
    expect(div.querySelector('[data-action="end"]')).not.toBeNull();
  });

  it('the play button shows ▶ when paused, the pause button shows ❚❚ when playing', () => {
    const div = newDiv();
    renderPreviewTransport(div, baseState, noopCb);
    const play = div.querySelector('[data-action="play"]');
    expect(play?.getAttribute('hidden')).toBeNull();
    const pause = div.querySelector('[data-action="pause"]');
    expect(pause?.getAttribute('hidden')).not.toBeNull();
  });

  it('the scrub slider has min=0, max=totalSteps, value=step', () => {
    const div = newDiv();
    renderPreviewTransport(div, { ...baseState, step: 3 }, noopCb);
    const scrub = div.querySelector<HTMLInputElement>('[data-action="scrub"]');
    expect(scrub?.min).toBe('0');
    expect(scrub?.max).toBe('10');
    expect(scrub?.value).toBe('3');
  });

  it('clicking play calls onPlay', () => {
    const div = newDiv();
    const onPlay = vi.fn();
    renderPreviewTransport(div, baseState, { ...noopCb, onPlay });
    div.querySelector<HTMLButtonElement>('[data-action="play"]')?.click();
    expect(onPlay).toHaveBeenCalled();
  });

  it('shows the current X / Y mm readout', () => {
    const div = newDiv();
    renderPreviewTransport(div, {
      ...baseState, step: 5, playing: true, currentXmm: 12.5, currentYmm: -3.2,
    }, noopCb);
    const txt = div.textContent ?? '';
    expect(txt).toMatch(/12.5/);
    expect(txt).toMatch(/-3.2/);
  });

  it('renders zoom in / zoom out / zoom reset buttons that call onZoom', () => {
    const div = newDiv();
    const onZoom = vi.fn();
    renderPreviewTransport(div, baseState, { ...noopCb, onZoom });
    expect(div.querySelector('[data-zoom="in"]')).not.toBeNull();
    expect(div.querySelector('[data-zoom="out"]')).not.toBeNull();
    expect(div.querySelector('[data-zoom="reset"]')).not.toBeNull();
    div.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.click();
    div.querySelector<HTMLButtonElement>('[data-zoom="out"]')!.click();
    div.querySelector<HTMLButtonElement>('[data-zoom="reset"]')!.click();
    expect(onZoom).toHaveBeenNthCalledWith(1, 'in');
    expect(onZoom).toHaveBeenNthCalledWith(2, 'out');
    expect(onZoom).toHaveBeenNthCalledWith(3, 'reset');
  });

  // The needle / thread / colour / toggle controls now live in the sidebar
  // Preview Settings section so the bottom transport stays slim on narrow
  // browser windows. The transport must not render any of them.
  it('does NOT render needle, thread, colour, fabric, or history/foot toggles', () => {
    const div = newDiv();
    renderPreviewTransport(div, baseState, noopCb);
    expect(div.querySelector('select[data-action="needle"]')).toBeNull();
    expect(div.querySelector('select[data-action="thread"]')).toBeNull();
    expect(div.querySelector('input[data-action="thread-color"]')).toBeNull();
    expect(div.querySelector('input[data-action="bg-color"]')).toBeNull();
    expect(div.querySelector('[data-action="toggle-history"]')).toBeNull();
    expect(div.querySelector('[data-action="toggle-foot"]')).toBeNull();
  });
});

// Playback ticks happen every ~125ms at default speed. If the transport
// rebuilds its DOM on every tick (replaceChildren), a click that crosses a
// tick boundary is lost — the user can't reliably hit pause. updatePreview-
// Transport mutates only the live readouts (scrub value, percent, X/Y,
// speed label) so the buttons stay clickable across an entire stream.
describe('updatePreviewTransport', () => {
  it('does not replaceChildren the root', () => {
    const div = newDiv();
    renderPreviewTransport(div, baseState, noopCb);
    const firstStructural = div.firstElementChild;
    updatePreviewTransport(div, { ...baseState, step: 4 });
    expect(div.firstElementChild).toBe(firstStructural);
  });

  it('preserves the play button DOM node identity', () => {
    const div = newDiv();
    renderPreviewTransport(div, baseState, noopCb);
    const before = div.querySelector('[data-action="play"]');
    updatePreviewTransport(div, { ...baseState, step: 4 });
    const after = div.querySelector('[data-action="play"]');
    expect(after).toBe(before);
  });

  it('keeps click handlers attached across updates', () => {
    const div = newDiv();
    const onPlay = vi.fn();
    renderPreviewTransport(div, baseState, { ...noopCb, onPlay });
    const play = div.querySelector<HTMLButtonElement>('[data-action="play"]')!;
    play.click();
    updatePreviewTransport(div, { ...baseState, step: 1 });
    updatePreviewTransport(div, { ...baseState, step: 2 });
    play.click();
    expect(onPlay).toHaveBeenCalledTimes(2);
  });

  it('reflects the new step on the scrub slider', () => {
    const div = newDiv();
    renderPreviewTransport(div, { ...baseState, step: 0 }, noopCb);
    updatePreviewTransport(div, { ...baseState, step: 7 });
    const scrub = div.querySelector<HTMLInputElement>('[data-action="scrub"]')!;
    expect(scrub.value).toBe('7');
  });

  it('updates the X/Y readout text in place', () => {
    const div = newDiv();
    renderPreviewTransport(div, baseState, noopCb);
    updatePreviewTransport(div, { ...baseState, currentXmm: 12.5, currentYmm: -3.2 });
    const txt = div.textContent ?? '';
    expect(txt).toMatch(/12.5/);
    expect(txt).toMatch(/-3.2/);
  });

  it('updates the percent label', () => {
    const div = newDiv();
    renderPreviewTransport(div, { ...baseState, step: 0, totalSteps: 10 }, noopCb);
    updatePreviewTransport(div, { ...baseState, step: 5, totalSteps: 10 });
    const pct = div.querySelector('.pv-tx-pct')!;
    expect(pct.textContent).toBe('50%');
  });
});
