// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
  showGlossary,
  hideGlossary,
} from '../../../ui/creator/help/glossaryModal.js';
import { entriesByCategory } from '../../../ui/creator/help/glossaryEntries.js';

describe('glossaryModal', () => {
  afterEach(() => {
    hideGlossary();
  });

  it('showGlossary appends one .info-backdrop with data-component="glossary"', () => {
    showGlossary();
    const backdrops = document.querySelectorAll('.info-backdrop[data-component="glossary"]');
    expect(backdrops.length).toBe(1);
  });

  it('showGlossary is idempotent (second call does not stack)', () => {
    showGlossary();
    showGlossary();
    expect(document.querySelectorAll('.info-backdrop[data-component="glossary"]').length).toBe(1);
  });

  it('renders four section headings in concept → design → stitch → density order', () => {
    showGlossary();
    const headings = Array.from(document.querySelectorAll<HTMLElement>('.glossary-section-title'));
    expect(headings.map((h) => h.textContent)).toEqual([
      'Concepts',
      'Design constructs',
      'Stitches',
      'Density',
    ]);
  });

  it('renders every glossary entry, grouped under its category section', () => {
    showGlossary();
    const grouped = entriesByCategory();
    const allTerms = Array.from(document.querySelectorAll<HTMLElement>('.glossary-entry-term'))
      .map((el) => el.textContent);
    for (const cat of ['concept', 'design', 'stitch', 'density'] as const) {
      for (const entry of grouped[cat]) {
        expect(allTerms).toContain(entry.term);
      }
    }
  });

  it('Escape key closes the modal', () => {
    showGlossary();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.info-backdrop[data-component="glossary"]')).toBeNull();
  });

  it('clicking the backdrop (not the card) closes the modal', () => {
    showGlossary();
    const backdrop = document.querySelector<HTMLElement>('.info-backdrop[data-component="glossary"]')!;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.info-backdrop[data-component="glossary"]')).toBeNull();
  });

  it('clicking inside the card does not close the modal', () => {
    showGlossary();
    const card = document.querySelector<HTMLElement>('.info-backdrop[data-component="glossary"] .info-card')!;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.info-backdrop[data-component="glossary"]')).not.toBeNull();
  });
});
