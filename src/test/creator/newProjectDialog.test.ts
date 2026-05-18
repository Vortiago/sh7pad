// @vitest-environment jsdom
// Phase 6: New-project dialog.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showNewProjectDialog } from '../../ui/creator/modals/newProjectDialog/index.js';

describe('showNewProjectDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders Mode (Design / Manual) and Foot (S / B) radio groups', () => {
    showNewProjectDialog({ onCreate: () => {} });
    const modeRadios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="np-mode"]'),
    );
    const footRadios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="np-foot"]'),
    );
    expect(modeRadios.map((r) => r.value)).toEqual(['design', 'manual']);
    expect(footRadios.map((r) => r.value)).toEqual(['S', 'B']);
  });

  it('defaults to design + S', () => {
    showNewProjectDialog({ onCreate: () => {} });
    const checkedMode = document.querySelector<HTMLInputElement>('input[name="np-mode"]:checked');
    const checkedFoot = document.querySelector<HTMLInputElement>('input[name="np-foot"]:checked');
    expect(checkedMode?.value).toBe('design');
    expect(checkedFoot?.value).toBe('S');
  });

  it('Create calls onCreate with the picked name, mode, and foot', () => {
    const onCreate = vi.fn();
    showNewProjectDialog({ onCreate }, { namePlaceholder: 'Stitch 7' });

    const nameInput = document.querySelector<HTMLInputElement>('#np-name')!;
    nameInput.value = 'My Embroidery';

    const manualRadio = document.querySelector<HTMLInputElement>('input[name="np-mode"][value="manual"]')!;
    manualRadio.checked = true;
    manualRadio.dispatchEvent(new Event('change'));
    const bRadio = document.querySelector<HTMLInputElement>('input[name="np-foot"][value="B"]')!;
    bRadio.checked = true;
    bRadio.dispatchEvent(new Event('change'));

    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')!.click();

    expect(onCreate).toHaveBeenCalledWith({
      name: 'My Embroidery',
      mode: 'manual',
      suggestedFoot: 'B',
    });
  });

  it('renders the auto-generated next-project name as the input placeholder', () => {
    showNewProjectDialog({ onCreate: () => {} }, { namePlaceholder: 'Stitch 4' });
    const nameInput = document.querySelector<HTMLInputElement>('#np-name')!;
    expect(nameInput.placeholder).toBe('Stitch 4');
  });

  it('falls back to the placeholder when the name input is left blank', () => {
    const onCreate = vi.fn();
    showNewProjectDialog({ onCreate }, { namePlaceholder: 'Stitch 4' });
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')!.click();
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Stitch 4',
      mode: 'design',
      suggestedFoot: 'S',
    });
  });

  it('treats whitespace-only input as blank (still uses the placeholder)', () => {
    const onCreate = vi.fn();
    showNewProjectDialog({ onCreate }, { namePlaceholder: 'Stitch 4' });
    document.querySelector<HTMLInputElement>('#np-name')!.value = '   ';
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')!.click();
    expect(onCreate.mock.calls[0]?.[0]?.name).toBe('Stitch 4');
  });

  it('Enter inside the name input submits the dialog', () => {
    const onCreate = vi.fn();
    showNewProjectDialog({ onCreate }, { namePlaceholder: 'Stitch 4' });
    const nameInput = document.querySelector<HTMLInputElement>('#np-name')!;
    nameInput.value = 'Quick';
    nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Quick',
      mode: 'design',
      suggestedFoot: 'S',
    });
  });

  it('Cancel calls onCancel and removes the dialog', () => {
    const onCancel = vi.fn();
    showNewProjectDialog({ onCreate: () => {}, onCancel });

    const cancelBtn = document.querySelector<HTMLButtonElement>('[data-action="np-cancel"]')!;
    cancelBtn.click();

    expect(onCancel).toHaveBeenCalled();
    expect(document.querySelector('.info-backdrop[data-component="new-project"]')).toBeNull();
  });

  it('clicking the backdrop dismisses (calls onCancel)', () => {
    const onCancel = vi.fn();
    showNewProjectDialog({ onCreate: () => {}, onCancel });

    const backdrop = document.querySelector<HTMLElement>('.info-backdrop')!;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // The handler reads e.target — only fires when the click is on the
    // backdrop itself. Simulate by dispatching from backdrop directly.
    expect(onCancel).toHaveBeenCalled();
  });

  it('mounting twice is a no-op (does not stack dialogs)', () => {
    showNewProjectDialog({ onCreate: () => {} });
    showNewProjectDialog({ onCreate: () => {} });
    expect(
      document.querySelectorAll('.info-backdrop[data-component="new-project"]').length,
    ).toBe(1);
  });
});
