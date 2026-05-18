// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  renderStitchListPanel,
  renderStitchListChrome,
  setCurrentRow,
} from '../../ui/creator/stitchListPanel/panel.js';
import { newProject, SAMPLE } from '../../creator/project.js';
import { addManualStitch } from '../../creator/manualStitch.js';
import type { Project, Segment } from '../../creator/types.js';

const newOl = (): HTMLOListElement =>
  document.createElement('ol') as HTMLOListElement;

const projectWith = (segments: Segment[]): Project => {
  const fresh = newProject('X');
  return {
    ...fresh,
    points: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 10 },
      { id: 'c', x: 5, y: 20 },
    ],
    segments,
  };
};

describe('renderStitchListPanel', () => {
  it('renders an empty-state element when there are no segments', () => {
    const ol = newOl();
    renderStitchListPanel(ol, newProject('X'), { onSelect: () => {} });
    expect(ol.querySelector('.sl-empty')).not.toBeNull();
  });

  it('renders a START row for the first point even when only one point exists', () => {
    const proj = newProject('X'); // single start point at (0, 0)
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    // Since there are no segments, the panel shows the empty state — the
    // start row is shown only when there are also segments.
    expect(ol.querySelector('.sl-empty')).not.toBeNull();
  });

  it('renders one row per segment plus a START row when segments exist', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const rows = ol.querySelectorAll('li[data-row]');
    expect(rows.length).toBe(3); // start + 2 segments
    expect(rows[0]?.getAttribute('data-row')).toBe('start');
    expect(rows[1]?.getAttribute('data-row')).toBe('0');
    expect(rows[2]?.getAttribute('data-row')).toBe('1');
  });

  it('shows satin segments with their widthStart→widthEnd label', () => {
    const proj = projectWith([
      {
        id: 's1', from: 'a', to: 'b', type: 'satin',
        widthStart: 2.4, widthEnd: 4.5, density: 0.6,
      },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const segRow = ol.querySelector('li[data-row="0"]');
    expect(segRow?.textContent).toMatch(/satin/i);
    expect(segRow?.textContent).toMatch(/2\.4/);
    expect(segRow?.textContent).toMatch(/4\.5/);
  });

  it('straight row shows the segment length in mm (compact format)', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const segRow = ol.querySelector('li[data-row="0"]');
    expect(segRow?.textContent).toMatch(/straight/);
    expect(segRow?.textContent).toMatch(/10\.0mm/);
  });

  it('rows do not duplicate end coordinates (compact format keeps row narrow)', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const text = ol.querySelector('li[data-row="0"]')?.textContent ?? '';
    // No "→ X" prefix, no separate end-coord clause.
    expect(text).not.toMatch(/→\s*X/);
  });

  it('clicking the START row calls onSelect with "start"', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
    ]);
    const onSelect = vi.fn();
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect });
    (ol.querySelector('li[data-row="start"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('start');
  });

  it('clicking a segment row calls onSelect with the numeric segment index as a string', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ]);
    const onSelect = vi.fn();
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect });
    (ol.querySelector('li[data-row="1"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('marks only the last segment row with kind-last', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    expect(ol.querySelector('li[data-row="0"]')?.classList.contains('kind-last')).toBe(false);
    expect(ol.querySelector('li[data-row="1"]')?.classList.contains('kind-last')).toBe(true);
  });

  it('the start row never gets kind-last', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    expect(ol.querySelector('li[data-row="start"]')?.classList.contains('kind-last')).toBe(false);
  });

  it('renders a delete button on every segment row but not on START, and clicking it fires onDeleteSegment without selecting the row', () => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ]);
    const onSelect = vi.fn();
    const onDeleteSegment = vi.fn();
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect, onDeleteSegment });

    // START row has no delete button.
    const startRow = ol.querySelector('li[data-row="start"]')!;
    expect(startRow.querySelector('[data-action="delete"]')).toBeNull();

    // Each segment row has one.
    const seg0Btn = ol.querySelector<HTMLButtonElement>(
      'li[data-row="0"] [data-action="delete"]',
    );
    const seg1Btn = ol.querySelector<HTMLButtonElement>(
      'li[data-row="1"] [data-action="delete"]',
    );
    expect(seg0Btn).not.toBeNull();
    expect(seg1Btn).not.toBeNull();

    // Click fires onDeleteSegment with the segment id, NOT onSelect.
    seg1Btn!.click();
    expect(onDeleteSegment).toHaveBeenCalledWith('s2');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('SAMPLE project produces both straight and satin rows in the list', () => {
    const proj = SAMPLE();
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const straightRows = ol.querySelectorAll('li.kind-straight');
    const satinRows = ol.querySelectorAll('li.kind-satin');
    expect(straightRows.length).toBeGreaterThan(0);
    expect(satinRows.length).toBeGreaterThan(0);
  });

  it('Foot S segment rows label whether the planner emitted needles or jumps', () => {
    // Build a Foot S project with a 3 mm in-window segment (single needle)
    // and a 10 mm rightward bust (10 jump pieces). The list must surface
    // the kind so the user can tell at a glance which segments walked the
    // carriage. The exact summary format is loose ("needle" / "jump" must
    // appear in each row's label).
    const fresh = newProject('foot-s');
    const proj: Project = {
      ...fresh,
      suggestedFoot: 'S',
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 3, y: 0 },  // 3 mm in-window
        { id: 'c', x: 13, y: 0 }, // 10 mm bust
      ],
      segments: [
        { id: 's1', from: 'a', to: 'b', type: 'straight' },
        { id: 's2', from: 'b', to: 'c', type: 'straight' },
      ],
    };
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const r0 = ol.querySelector('li[data-row="0"] .sl-row-label')?.textContent ?? '';
    const r1 = ol.querySelector('li[data-row="1"] .sl-row-label')?.textContent ?? '';
    expect(r0.toLowerCase()).toContain('needle');
    expect(r1.toLowerCase()).toContain('jump');
  });
});

describe('setCurrentRow', () => {
  const buildList = (): HTMLOListElement => {
    const proj = projectWith([
      { id: 's1', from: 'a', to: 'b', type: 'straight' },
      { id: 's2', from: 'b', to: 'c', type: 'straight' },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    return ol;
  };

  it('null marks every row future', () => {
    const ol = buildList();
    setCurrentRow(ol, null);
    expect(ol.querySelectorAll('li.future').length).toBe(3);
    expect(ol.querySelector('li.current')).toBeNull();
  });

  it('"start" marks the start row current and all segments future', () => {
    const ol = buildList();
    setCurrentRow(ol, 'start');
    expect(ol.querySelector('li[data-row="start"]')?.classList.contains('current')).toBe(true);
    expect(ol.querySelector('li[data-row="0"]')?.classList.contains('future')).toBe(true);
    expect(ol.querySelector('li[data-row="1"]')?.classList.contains('future')).toBe(true);
  });

  it('numeric row marks earlier rows done, that row current, later rows future', () => {
    const ol = buildList();
    setCurrentRow(ol, '1');
    expect(ol.querySelector('li[data-row="start"]')?.classList.contains('done')).toBe(true);
    expect(ol.querySelector('li[data-row="0"]')?.classList.contains('done')).toBe(true);
    expect(ol.querySelector('li[data-row="1"]')?.classList.contains('current')).toBe(true);
  });

  it('an unknown row id leaves no row current; rows up to it are done, rest future', () => {
    const ol = buildList();
    setCurrentRow(ol, '99');
    expect(ol.querySelector('li.current')).toBeNull();
  });
});

describe('renderStitchListPanel — manual mode', () => {
  function manualS(stitches: { kind: 'needle' | 'jump'; x: number; y: number }[]): Project {
    let p = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    for (const s of stitches) p = addManualStitch(p, s);
    return p;
  }

  it('renders START + one row per manual stitch (m0, m1, …)', () => {
    const proj = manualS([
      { kind: 'needle', x: 1, y: 0 },
      { kind: 'jump',   x: 2, y: 0 },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const rows = ol.querySelectorAll('li[data-row]');
    expect(rows.length).toBe(3);
    expect(rows[0]?.getAttribute('data-row')).toBe('start');
    expect(rows[1]?.getAttribute('data-row')).toBe('m0');
    expect(rows[2]?.getAttribute('data-row')).toBe('m1');
  });

  it('shows the empty placeholder for a manual project with zero stitches', () => {
    const proj = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    expect(ol.querySelector('.sl-empty')).not.toBeNull();
  });

  it('labels needle and jump rows with kind + (x, y) in mm', () => {
    const proj = manualS([
      { kind: 'needle', x: 1.5, y: 2.3 },
      { kind: 'jump',   x: 2.5, y: 2.3 },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    const r0 = ol.querySelector('li[data-row="m0"]')?.textContent ?? '';
    const r1 = ol.querySelector('li[data-row="m1"]')?.textContent ?? '';
    expect(r0).toMatch(/Needle/i);
    expect(r0).toMatch(/1\.5/);
    expect(r0).toMatch(/2\.3/);
    expect(r1).toMatch(/Jump/i);
    expect(r1).toMatch(/2\.5/);
  });

  it('clicking a manual row calls onSelect with its m-prefixed row id', () => {
    const proj = manualS([
      { kind: 'needle', x: 1, y: 0 },
      { kind: 'needle', x: 2, y: 0 },
    ]);
    const onSelect = vi.fn();
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect });
    (ol.querySelector('li[data-row="m1"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('m1');
  });

  it('renders a delete button only on the LAST manual row (append-only invariant)', () => {
    // Manual mode is append-only — mid-list mutations can
    // shift the frame subsequent stitches were validated against, so
    // only the tail entry is removable.
    const proj = manualS([
      { kind: 'needle', x: 1, y: 0 },
      { kind: 'jump',   x: 2, y: 0 },
    ]);
    const onSelect = vi.fn();
    const onDeleteLastManual = vi.fn();
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect, onDeleteLastManual });

    // START row has no delete button (parity with design mode).
    expect(ol.querySelector('li[data-row="start"] [data-action="delete"]')).toBeNull();
    // Non-last manual row has no delete button.
    expect(ol.querySelector('li[data-row="m0"] [data-action="delete"]')).toBeNull();

    const lastBtn = ol.querySelector<HTMLButtonElement>(
      'li[data-row="m1"] [data-action="delete"]',
    );
    expect(lastBtn).not.toBeNull();
    lastBtn!.click();
    expect(onDeleteLastManual).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('manual rows carry a kind-needle / kind-jump class so styling can differ', () => {
    const proj = manualS([
      { kind: 'needle', x: 1, y: 0 },
      { kind: 'jump',   x: 2, y: 0 },
    ]);
    const ol = newOl();
    renderStitchListPanel(ol, proj, { onSelect: () => {} });
    expect(ol.querySelector('li[data-row="m0"]')?.classList.contains('kind-needle')).toBe(true);
    expect(ol.querySelector('li[data-row="m1"]')?.classList.contains('kind-jump')).toBe(true);
  });
});

describe('renderStitchListChrome', () => {
  const newDiv = (): HTMLDivElement => document.createElement('div');

  it('renders the "Stitches" title text', () => {
    const div = newDiv();
    renderStitchListChrome(div, { collapsed: false }, { onToggleCollapse: () => {} });
    expect(div.textContent).toContain('Stitches');
  });

  it('renders a right-collapse toggle button with data-action="toggle-right-collapse"', () => {
    const div = newDiv();
    renderStitchListChrome(div, { collapsed: false }, { onToggleCollapse: () => {} });
    expect(div.querySelector('[data-action="toggle-right-collapse"]')).not.toBeNull();
  });

  it('clicking the toggle calls onToggleCollapse', () => {
    const div = newDiv();
    const onToggleCollapse = vi.fn();
    renderStitchListChrome(div, { collapsed: false }, { onToggleCollapse });
    div.querySelector<HTMLButtonElement>('[data-action="toggle-right-collapse"]')?.click();
    expect(onToggleCollapse).toHaveBeenCalled();
  });
});
