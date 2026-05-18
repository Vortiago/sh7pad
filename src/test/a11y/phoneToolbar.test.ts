// @vitest-environment jsdom
// Phone toolbar trims (Q5). Structural assertions on the source CSS:
// at @media (max-width: 639px) the zoom group is hidden, the stats
// .ed-right column is hidden, and the stitch-type group is hidden
// unless body has data-active-tool='add'. The Fit floating button
// in editor/render.css is hidden by default and shown at phone width.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOOLBAR_CSS = readFileSync(
  resolve(__dirname, '../../ui/creator/toolbar/toolbar.css'),
  'utf-8',
);
const RENDER_CSS = readFileSync(
  resolve(__dirname, '../../ui/creator/editor/render.css'),
  'utf-8',
);

describe('phone toolbar trims at (max-width: 639px)', () => {
  it('toolbar.css scopes the trims to the phone breakpoint', () => {
    expect(TOOLBAR_CSS).toMatch(/@media\s*\(\s*max-width:\s*639px\s*\)/);
  });

  it('zoom group is hidden at phone width', () => {
    expect(TOOLBAR_CSS).toMatch(
      /\.ed-toolbar \.ed-toolgroup:has\(\.ed-zoom-btn\)[\s\S]{0,80}display:\s*none/,
    );
  });

  it('stitch-type group is hidden when no body[data-active-tool=add]', () => {
    expect(TOOLBAR_CSS).toMatch(
      /body:not\(\[data-active-tool=['"]add['"]\]\) \.ed-toolbar \.ed-toolgroup:has\(\.ed-stitch-btn\)[\s\S]{0,80}display:\s*none/,
    );
  });

  it('stats .ed-right column is hidden (moves to appBar overflow)', () => {
    expect(TOOLBAR_CSS).toMatch(/\.ed-toolbar \.ed-right[\s\S]{0,80}display:\s*none/);
  });

  it('Fit-zoom floating button is shown only at phone width', () => {
    // Default: hidden (display: none) at the top-level rule.
    expect(RENDER_CSS).toMatch(/\.ed-fit-zoom\s*\{[^}]*display:\s*none/);
    // Phone: shown via inline-flex inside @media (max-width: 639px). The
    // @media is nested inside .ed-fit-zoom (native CSS nesting), so the
    // selector and the media query appear in either order on the source —
    // we just assert the trio (.ed-fit-zoom, @media phone, inline-flex)
    // co-occur.
    expect(RENDER_CSS).toMatch(/\.ed-fit-zoom/);
    expect(RENDER_CSS).toMatch(/@media\s*\(\s*max-width:\s*639px/);
    expect(RENDER_CSS).toMatch(/display:\s*inline-flex/);
  });
});
