// Touch-target sizing: structural test on shared/touch.css. We verify
// the file contains the @media (pointer: coarse) block with the 44px
// minimum on interactive elements.
//
// jsdom doesn't evaluate @media (pointer: coarse) reliably (matchMedia
// returns matches:false by default; CSS injection via Vite doesn't
// re-evaluate on mock changes), so getComputedStyle assertions don't
// work cleanly. Instead we read the source file as text and assert the
// rules are present. Lighthouse-CI (commit 5) catches behavior in a
// real touch-emulating browser.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOUCH_CSS = readFileSync(
  resolve(__dirname, '../../ui/creator/shared/touch.css'),
  'utf-8',
);
const TOKENS_CSS = readFileSync(
  resolve(__dirname, '../../ui/creator/shared/tokens.css'),
  'utf-8',
);

describe('touch.css applies a 44px minimum at (pointer: coarse)', () => {
  it('--touch-target token is defined as 44px', () => {
    expect(TOKENS_CSS).toMatch(/--touch-target:\s*44px/);
  });

  it('touch.css scopes its rules to (pointer: coarse)', () => {
    expect(TOUCH_CSS).toMatch(/@media\s*\(\s*pointer:\s*coarse\s*\)/);
  });

  it('generic interactive elements get min-height: var(--touch-target)', () => {
    // The button/input/select/textarea generic block must use the token.
    // Native CSS nesting groups them under `.app-root { & :is(button, ...) }`.
    const interactiveBlock = TOUCH_CSS.match(
      /:is\([^)]*\bbutton\b[^)]*\binput\b[^)]*\bselect\b[^)]*\btextarea\b[\s\S]*?min-height:\s*var\(--touch-target\)/,
    );
    expect(interactiveBlock).not.toBeNull();
  });

  it('range slider thumb is bumped to ~24px on coarse pointer', () => {
    // Native CSS nesting collapses the prefix; we just assert the
    // slider-thumb selectors carry a 24px width.
    expect(TOUCH_CSS).toMatch(
      /::-webkit-slider-thumb[\s\S]*?width:\s*24px/,
    );
    expect(TOUCH_CSS).toMatch(
      /::-moz-range-thumb[\s\S]*?width:\s*24px/,
    );
  });

  it('stitch-list and project delete glyphs are always-visible at coarse pointer', () => {
    // The previous design hid them with display:none until :hover, which
    // is invisible on touch. At coarse pointer they must be visible
    // unconditionally (WCAG 1.4.13). Class names match the production
    // markup: .sl-row-delete for the stitch list, .sb-item-del for the
    // sidebar project row.
    expect(TOUCH_CSS).toMatch(/\.sl-row-delete[\s\S]*?display:\s*inline-flex/);
    expect(TOUCH_CSS).toMatch(/\.sb-item-del[\s\S]*?opacity:\s*1/);
  });
});
