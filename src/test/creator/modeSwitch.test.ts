// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderModeSwitch } from '../../ui/creator/modeSwitch/index.js';

const newDiv = (): HTMLDivElement => document.createElement('div');

describe('renderModeSwitch', () => {
  it('renders Edit and Preview buttons', () => {
    const div = newDiv();
    renderModeSwitch(div, 'edit', () => {});
    expect(div.querySelector('[data-mode="edit"]')).not.toBeNull();
    expect(div.querySelector('[data-mode="preview"]')).not.toBeNull();
  });

  it('marks the active mode with data-active="true"', () => {
    const div = newDiv();
    renderModeSwitch(div, 'preview', () => {});
    expect(div.querySelector('[data-mode="preview"]')?.getAttribute('data-active')).toBe('true');
    expect(div.querySelector('[data-mode="edit"]')?.getAttribute('data-active')).toBe('false');
  });

  it('clicking a mode button calls onChange with the new mode', () => {
    const div = newDiv();
    const onChange = vi.fn();
    renderModeSwitch(div, 'edit', onChange);
    div.querySelector<HTMLButtonElement>('[data-mode="preview"]')?.click();
    expect(onChange).toHaveBeenCalledWith('preview');
  });

  it('clicking the active mode does not re-fire onChange', () => {
    const div = newDiv();
    const onChange = vi.fn();
    renderModeSwitch(div, 'edit', onChange);
    div.querySelector<HTMLButtonElement>('[data-mode="edit"]')?.click();
    expect(onChange).not.toHaveBeenCalled();
  });
});
