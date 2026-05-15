import { describe, it, expect } from 'vitest';
import {
  GLOSSARY,
  getEntry,
  entriesByCategory,
} from '../../../ui/creator/help/glossaryEntries.js';

describe('glossaryEntries', () => {
  it('needle-stitch entry explains that the carriage stays put', () => {
    expect(getEntry('needle-stitch').short.toLowerCase()).toContain('carriage');
    expect(getEntry('needle-stitch').short.toLowerCase()).toContain('stays');
  });

  it('jump-stitch entry mentions the carriage moving with the needle', () => {
    expect(getEntry('jump-stitch').short.toLowerCase()).toContain('carriage');
  });

  it('straight-segment entry makes clear it is not a stitch', () => {
    expect(getEntry('straight-segment').short.toLowerCase()).toContain('not a stitch');
  });

  it('foundational segment entry belongs to the concept category', () => {
    expect(getEntry('segment').category).toBe('concept');
    expect(getEntry('stitch').category).toBe('concept');
  });

  it('entriesByCategory groups entries by their category field', () => {
    const grouped = entriesByCategory();
    expect(grouped.concept.length).toBe(2);
    expect(grouped.design.length).toBe(2);
    expect(grouped.stitch.length).toBe(2);
    expect(grouped.density.length).toBe(2);
  });

  it('satin lives only in the design category, not duplicated under stitches', () => {
    const grouped = entriesByCategory();
    const stitchTerms = grouped.stitch.map((e) => e.term.toLowerCase());
    expect(stitchTerms.some((t) => t.includes('satin'))).toBe(false);
    const designTerms = grouped.design.map((e) => e.term.toLowerCase());
    expect(designTerms.some((t) => t.includes('satin'))).toBe(true);
  });

  it('every entry in GLOSSARY has a non-empty term and short body', () => {
    for (const entry of Object.values(GLOSSARY)) {
      expect(entry.term.length).toBeGreaterThan(0);
      expect(entry.short.length).toBeGreaterThan(0);
    }
  });

  it('getEntry throws on an unknown id', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => getEntry('nope' as any)).toThrow();
  });
});
