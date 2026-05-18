// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createPanInteract } from '../../ui/creator/editor/panInteract.js';

function setup() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  });
  document.body.appendChild(el);
  const onPan = vi.fn();
  const handle = createPanInteract(el, { onPan });
  handle.attach();
  return { el, onPan, handle };
}

describe('createPanInteract', () => {
  it('middle-button drag emits onPan with pixel deltas', () => {
    const { el, onPan, handle } = setup();
    el.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 1, clientX: 100, clientY: 100,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 130, clientY: 110,
    }) as unknown as PointerEvent);
    expect(onPan).toHaveBeenCalledWith(30, 10);
    handle.detach();
  });

  it('right-button drag emits onPan', () => {
    const { el, onPan, handle } = setup();
    el.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 2, clientX: 50, clientY: 50,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 75, clientY: 60,
    }) as unknown as PointerEvent);
    expect(onPan).toHaveBeenCalledWith(25, 10);
    handle.detach();
  });

  it('Alt+left-click drag emits onPan', () => {
    const { el, onPan, handle } = setup();
    el.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, altKey: true, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 12, clientY: -8,
    }) as unknown as PointerEvent);
    expect(onPan).toHaveBeenCalledWith(12, -8);
    handle.detach();
  });

  it('plain left-click drag does NOT emit onPan', () => {
    const { el, onPan, handle } = setup();
    el.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 50, clientY: 50,
    }) as unknown as PointerEvent);
    expect(onPan).not.toHaveBeenCalled();
    handle.detach();
  });

  it('pointerup ends the drag — subsequent pointermove emits nothing', () => {
    const { el, onPan, handle } = setup();
    el.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 1, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 10, clientY: 10,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointerup', {
      bubbles: true, clientX: 10, clientY: 10,
    }) as unknown as PointerEvent);
    onPan.mockClear();
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 99, clientY: 99,
    }) as unknown as PointerEvent);
    expect(onPan).not.toHaveBeenCalled();
    handle.detach();
  });

  it('detach() removes listeners — no further events processed', () => {
    const { el, onPan, handle } = setup();
    handle.detach();
    el.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 1, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 10, clientY: 10,
    }) as unknown as PointerEvent);
    expect(onPan).not.toHaveBeenCalled();
  });

  it('contextmenu is preventDefault-ed so right-drag pan does not pop the menu', () => {
    const { el, handle } = setup();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    handle.detach();
  });
});
