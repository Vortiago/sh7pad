import { describe, it, expect, afterEach } from 'vitest';
import {
  showDisclaimer,
  hideDisclaimer,
  hasSeenDisclaimer,
  markDisclaimerSeen,
  DISCLAIMER_STORAGE_KEY,
} from '../../ui/creator/modals/disclaimerModal/index.js';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

describe('disclaimerModal', () => {
  afterEach(() => {
    hideDisclaimer();
  });

  it('hasSeenDisclaimer is false on a fresh storage and true after marking', () => {
    const storage = new FakeStorage();
    expect(hasSeenDisclaimer(storage)).toBe(false);
    markDisclaimerSeen(storage);
    expect(hasSeenDisclaimer(storage)).toBe(true);
    expect(storage.getItem(DISCLAIMER_STORAGE_KEY)).toBe('1');
  });

  it('showDisclaimer appends a single .info-backdrop to the document', () => {
    showDisclaimer();
    expect(document.querySelectorAll('.info-backdrop').length).toBe(1);
  });

  it('showDisclaimer is idempotent — second call does not stack a new modal', () => {
    showDisclaimer();
    showDisclaimer();
    expect(document.querySelectorAll('.info-backdrop').length).toBe(1);
  });

  it('hideDisclaimer removes the backdrop', () => {
    showDisclaimer();
    hideDisclaimer();
    expect(document.querySelector('.info-backdrop')).toBeNull();
  });

  it('clicking "Got it" closes the modal and marks storage', () => {
    const storage = new FakeStorage();
    showDisclaimer(storage);
    const btn = document.querySelector<HTMLButtonElement>('[data-action="disclaimer-dismiss"]');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(document.querySelector('.info-backdrop')).toBeNull();
    expect(hasSeenDisclaimer(storage)).toBe(true);
  });

  it('Escape key closes the modal and marks storage', () => {
    const storage = new FakeStorage();
    showDisclaimer(storage);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.info-backdrop')).toBeNull();
    expect(hasSeenDisclaimer(storage)).toBe(true);
  });

  it('clicking the backdrop (not the card) closes the modal', () => {
    const storage = new FakeStorage();
    showDisclaimer(storage);
    const backdrop = document.querySelector<HTMLElement>('.info-backdrop')!;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.info-backdrop')).toBeNull();
    expect(hasSeenDisclaimer(storage)).toBe(true);
  });

  it('clicking inside the card does not close the modal', () => {
    showDisclaimer();
    const card = document.querySelector<HTMLElement>('.info-card')!;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.info-backdrop')).not.toBeNull();
  });

  it('renders the title', () => {
    showDisclaimer();
    const title = document.querySelector('.info-title');
    expect(title?.textContent).toContain('sh7pad');
  });

  it('includes a GitHub source link', () => {
    showDisclaimer();
    const link = document.querySelector<HTMLAnchorElement>('.info-body a');
    expect(link).not.toBeNull();
    expect(link?.href).toBe('https://github.com/Vortiago/sh7pad');
  });
});
