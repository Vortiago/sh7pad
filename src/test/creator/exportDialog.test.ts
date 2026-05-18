// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hideExportDialog, showExportDialog } from '../../ui/creator/modals/exportDialog/index.js';

describe('showExportDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  // Tests that don't dismiss the dialog themselves would otherwise leak
  // the keydown listener onto document, intercepting Escape in later tests.
  afterEach(() => {
    hideExportDialog();
  });

  it('renders a button for both .sh7 and .sh7c.json', () => {
    showExportDialog({ onChoose: () => {} });
    expect(document.querySelector('[data-action="export-sh7"]')).not.toBeNull();
    expect(document.querySelector('[data-action="export-sh7c-json"]')).not.toBeNull();
  });

  it('clicking the .sh7 option calls onChoose with "sh7" and dismisses', () => {
    const onChoose = vi.fn();
    showExportDialog({ onChoose });
    document.querySelector<HTMLButtonElement>('[data-action="export-sh7"]')!.click();
    expect(onChoose).toHaveBeenCalledWith('sh7');
    expect(document.querySelector('.info-backdrop[data-component="export"]')).toBeNull();
  });

  it('clicking the .sh7c.json option calls onChoose with "sh7c-json" and dismisses', () => {
    const onChoose = vi.fn();
    showExportDialog({ onChoose });
    document.querySelector<HTMLButtonElement>('[data-action="export-sh7c-json"]')!.click();
    expect(onChoose).toHaveBeenCalledWith('sh7c-json');
    expect(document.querySelector('.info-backdrop[data-component="export"]')).toBeNull();
  });

  it('Cancel calls onCancel and dismisses without calling onChoose', () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    showExportDialog({ onChoose, onCancel });
    document.querySelector<HTMLButtonElement>('[data-action="export-cancel"]')!.click();
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
    expect(document.querySelector('.info-backdrop[data-component="export"]')).toBeNull();
  });

  it('Escape dismisses (calls onCancel)', () => {
    const onCancel = vi.fn();
    showExportDialog({ onChoose: () => {}, onCancel });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalled();
    expect(document.querySelector('.info-backdrop[data-component="export"]')).toBeNull();
  });

  it('clicking the backdrop dismisses (calls onCancel)', () => {
    const onCancel = vi.fn();
    showExportDialog({ onChoose: () => {}, onCancel });
    const backdrop = document.querySelector<HTMLElement>('.info-backdrop[data-component="export"]')!;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('mounting twice is a no-op (does not stack dialogs)', () => {
    showExportDialog({ onChoose: () => {} });
    showExportDialog({ onChoose: () => {} });
    expect(
      document.querySelectorAll('.info-backdrop[data-component="export"]').length,
    ).toBe(1);
  });
});
