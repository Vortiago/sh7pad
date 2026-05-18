// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderSidebar } from '../../ui/creator/sidebar/sidebar.js';
import { newProject } from '../../creator/project.js';
import type { BgImage, Project } from '../../creator/types.js';

const newDiv = (): HTMLDivElement => document.createElement('div');

const mockCb = () => ({
  onSelect: vi.fn(),
  onNew: vi.fn(),
  onImport: vi.fn(),
  onExport: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onBgChange: vi.fn(),
  onBgRemove: vi.fn(),
  onToggleBg: vi.fn(),
  onShowDisclaimer: vi.fn(),
  onShowGlossary: vi.fn(),
  onThreadTension: vi.fn(),
  onPreviewNeedleChange: vi.fn(),
  onPreviewThreadChange: vi.fn(),
  onPreviewThreadColorChange: vi.fn(),
  onPreviewBgColorChange: vi.fn(),
  onPreviewToggleHistory: vi.fn(),
  onPreviewToggleFoot: vi.fn(),
  onToggleLeftCollapse: vi.fn(),
});

const previewState = {
  needleSizeNm: 80,
  threadDiameterMm: 0.22,
  threadColor: '#3a5dbe',
  bgColor: '#e8dfc7',
  showHistory: true,
  showFoot: true,
};

describe('renderSidebar', () => {
  it('renders one row per project with data-project-id', () => {
    const a = newProject('A');
    const b = newProject('B');
    const div = newDiv();
    renderSidebar(div, { projects: [a, b], currentId: a.id, project: a }, mockCb());
    const rows = div.querySelectorAll('[data-project-id]');
    expect(rows.length).toBe(2);
  });

  it('marks the current project with data-active="true"', () => {
    const a = newProject('A');
    const b = newProject('B');
    const div = newDiv();
    renderSidebar(div, { projects: [a, b], currentId: a.id, project: a }, mockCb());
    const aRow = div.querySelector(`[data-project-id="${a.id}"]`);
    const bRow = div.querySelector(`[data-project-id="${b.id}"]`);
    expect(aRow?.getAttribute('data-active')).toBe('true');
    expect(bRow?.getAttribute('data-active')).toBe('false');
  });

  it('clicking a project row calls onSelect with its id', () => {
    const a = newProject('A');
    const b = newProject('B');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a, b], currentId: a.id, project: a }, cb);
    const bRow = div.querySelector<HTMLElement>(`[data-project-id="${b.id}"]`);
    bRow?.click();
    expect(cb.onSelect).toHaveBeenCalledWith(b.id);
  });

  it('clicking the New button calls onNew', () => {
    const a = newProject('A');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, cb);
    const newBtn = div.querySelector<HTMLButtonElement>('[data-action="new"]');
    newBtn?.click();
    expect(cb.onNew).toHaveBeenCalled();
  });

  it('clicking the Export button calls onExport', () => {
    const a = newProject('A');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, cb);
    div.querySelector<HTMLButtonElement>('[data-action="export"]')?.click();
    expect(cb.onExport).toHaveBeenCalled();
  });

  it('renders a Glossary link in the brand section that calls onShowGlossary', () => {
    const a = newProject('A');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, cb);
    const link = div.querySelector<HTMLButtonElement>('[data-action="show-glossary"]');
    expect(link).not.toBeNull();
    link?.click();
    expect(cb.onShowGlossary).toHaveBeenCalled();
  });

  it('renders the BG image controls when project.bg is non-null', () => {
    const proj: Project = {
      ...newProject('A'),
      bg: {
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        x: 0, y: 0, scale: 1, rotate: 0, opacity: 0.5,
      } as BgImage,
    };
    const div = newDiv();
    renderSidebar(div, { projects: [proj], currentId: proj.id, project: proj }, mockCb());
    expect(div.querySelector('[data-bg-control="opacity"]')).not.toBeNull();
    expect(div.querySelector('[data-bg-control="scale"]')).not.toBeNull();
    expect(div.querySelector('[data-bg-control="rotate"]')).not.toBeNull();
    expect(div.querySelector('[data-bg-control="locked"]')).not.toBeNull();
  });

  it('the Lock background checkbox reflects bg.locked and toggles it via onBgChange', () => {
    const proj: Project = {
      ...newProject('A'),
      bg: {
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        x: 0, y: 0, scale: 1, rotate: 0, opacity: 0.5, locked: true,
      } as BgImage,
    };
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [proj], currentId: proj.id, project: proj }, cb);
    const box = div.querySelector<HTMLInputElement>('[data-bg-control="locked"]')!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(cb.onBgChange).toHaveBeenCalledWith({ locked: false });
  });

  it('renders an "Add image" button when project.bg is null', () => {
    const a = newProject('A');
    const div = newDiv();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, mockCb());
    expect(div.querySelector('[data-action="bg-add"]')).not.toBeNull();
  });

  it('Stitch Settings shows Mode and Foot as read-only rows (no <select>)', () => {
    const proj: Project = {
      ...newProject('A', { mode: 'manual', suggestedFoot: 'B' }),
    };
    const div = newDiv();
    renderSidebar(div, { projects: [proj], currentId: proj.id, project: proj }, mockCb());
    // No editable foot select.
    expect(div.querySelector('[data-control="suggestedFoot"]')).toBeNull();
    // Both static rows show the locked values.
    const text = div.querySelector('.sb-stitch-controls')?.textContent ?? '';
    expect(text).toContain('Manual');
    expect(text).toContain('Foot B (Decorative)');
  });

  it('Stitch Settings tension inputs fire onThreadTension with the parsed number', () => {
    const proj = newProject('A');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [proj], currentId: proj.id, project: proj }, cb);

    const range = div.querySelector<HTMLInputElement>('[data-control="threadTensionRange"]')!;
    range.value = '5.5';
    range.dispatchEvent(new Event('input'));
    expect(cb.onThreadTension).toHaveBeenCalledWith(5.5);

    const num = div.querySelector<HTMLInputElement>('[data-control="threadTensionNumber"]')!;
    num.value = '6.2';
    num.dispatchEvent(new Event('change'));
    expect(cb.onThreadTension).toHaveBeenCalledWith(6.2);
  });

  it('renders Stitch Settings: Thread Tension bound to project', () => {
    const proj: Project = {
      ...newProject('A', { suggestedFoot: 'B' }),
      threadTension: 5.5,
    };
    const div = newDiv();
    renderSidebar(div, { projects: [proj], currentId: proj.id, project: proj }, mockCb());
    const tensionRange = div.querySelector<HTMLInputElement>('[data-control="threadTensionRange"]');
    const tensionNum = div.querySelector<HTMLInputElement>('[data-control="threadTensionNumber"]');
    expect(Number(tensionRange?.value)).toBe(5.5);
    expect(Number(tensionNum?.value)).toBe(5.5);
  });

  it('renders a left-collapse toggle button with data-action="toggle-left-collapse"', () => {
    const a = newProject('A');
    const div = newDiv();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, mockCb());
    const btn = div.querySelector('[data-action="toggle-left-collapse"]');
    expect(btn).not.toBeNull();
  });

  it('clicking the left-collapse toggle calls onToggleLeftCollapse', () => {
    const a = newProject('A');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, cb);
    div.querySelector<HTMLButtonElement>('[data-action="toggle-left-collapse"]')?.click();
    expect(cb.onToggleLeftCollapse).toHaveBeenCalled();
  });

  it('clicking the About button calls onShowDisclaimer', () => {
    const a = newProject('A');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, cb);
    const btn = div.querySelector<HTMLButtonElement>('[data-action="show-disclaimer"]');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(cb.onShowDisclaimer).toHaveBeenCalled();
  });

  it('renders a project-name input for the active project bound to project.name', () => {
    const a = newProject('Hello World');
    const b = newProject('Other');
    const div = newDiv();
    renderSidebar(div, { projects: [a, b], currentId: a.id, project: a }, mockCb());
    const aRow = div.querySelector<HTMLElement>(`[data-project-id="${a.id}"]`)!;
    const bRow = div.querySelector<HTMLElement>(`[data-project-id="${b.id}"]`)!;
    const aInput = aRow.querySelector<HTMLInputElement>('[data-control="project-name"]');
    const bInput = bRow.querySelector<HTMLInputElement>('[data-control="project-name"]');
    expect(aInput).not.toBeNull();
    expect(aInput?.value).toBe('Hello World');
    expect(bInput).toBeNull();
  });

  it('editing the project-name input fires onRename with the new name', () => {
    const a = newProject('Old Name');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a], currentId: a.id, project: a }, cb);
    const input = div.querySelector<HTMLInputElement>('[data-control="project-name"]')!;
    input.value = 'My Cool Stitch';
    input.dispatchEvent(new Event('change'));
    expect(cb.onRename).toHaveBeenCalledWith(a.id, 'My Cool Stitch');
  });

  it('clicking inside the project-name input does not trigger onSelect', () => {
    const a = newProject('A');
    const b = newProject('B');
    const div = newDiv();
    const cb = mockCb();
    renderSidebar(div, { projects: [a, b], currentId: a.id, project: a }, cb);
    const input = div.querySelector<HTMLInputElement>('[data-control="project-name"]')!;
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cb.onSelect).not.toHaveBeenCalled();
  });

  // Preview Settings section: simulation knobs (needle / thread / colors /
  // toggles) live here while the user is in preview mode. Frees up the
  // bottom transport bar for narrow widths and groups the simulation
  // configuration into one place. Hidden in edit mode where it would just
  // be noise.
  describe('Preview Settings section', () => {
    it('renders the section when mode is "preview"', () => {
      const a = newProject('A');
      const div = newDiv();
      renderSidebar(div, {
        projects: [a], currentId: a.id, project: a,
        mode: 'preview', preview: previewState,
      }, mockCb());
      expect(div.querySelector('[data-section="preview-settings"]')).not.toBeNull();
    });

    it('does NOT render the section in edit mode', () => {
      const a = newProject('A');
      const div = newDiv();
      renderSidebar(div, {
        projects: [a], currentId: a.id, project: a,
        mode: 'edit', preview: previewState,
      }, mockCb());
      expect(div.querySelector('[data-section="preview-settings"]')).toBeNull();
    });

    it('does NOT render the section when mode is omitted (back-compat)', () => {
      const a = newProject('A');
      const div = newDiv();
      renderSidebar(div, { projects: [a], currentId: a.id, project: a }, mockCb());
      expect(div.querySelector('[data-section="preview-settings"]')).toBeNull();
    });

    it('renders needle / thread selects, color pickers, and history+foot toggles', () => {
      const a = newProject('A');
      const div = newDiv();
      renderSidebar(div, {
        projects: [a], currentId: a.id, project: a,
        mode: 'preview', preview: previewState,
      }, mockCb());
      expect(div.querySelector('select[data-action="needle"]')).not.toBeNull();
      expect(div.querySelector('select[data-action="thread"]')).not.toBeNull();
      expect(div.querySelector('input[data-action="thread-color"]')).not.toBeNull();
      expect(div.querySelector('input[data-action="bg-color"]')).not.toBeNull();
      expect(div.querySelector('[data-action="toggle-history"]')).not.toBeNull();
      expect(div.querySelector('[data-action="toggle-foot"]')).not.toBeNull();
    });

    it('the needle / thread selects reflect previewState values', () => {
      const a = newProject('A');
      const div = newDiv();
      renderSidebar(div, {
        projects: [a], currentId: a.id, project: a,
        mode: 'preview',
        preview: { ...previewState, needleSizeNm: 110, threadDiameterMm: 0.30 },
      }, mockCb());
      expect(div.querySelector<HTMLSelectElement>('select[data-action="needle"]')!.value).toBe('110');
      expect(Number(div.querySelector<HTMLSelectElement>('select[data-action="thread"]')!.value)).toBeCloseTo(0.30, 5);
    });

    it('the color pickers reflect previewState values', () => {
      const a = newProject('A');
      const div = newDiv();
      renderSidebar(div, {
        projects: [a], currentId: a.id, project: a,
        mode: 'preview',
        preview: { ...previewState, threadColor: '#ff0000', bgColor: '#00ff00' },
      }, mockCb());
      const tc = div.querySelector<HTMLInputElement>('input[data-action="thread-color"]')!;
      const bc = div.querySelector<HTMLInputElement>('input[data-action="bg-color"]')!;
      expect(tc.value).toBe('#ff0000');
      expect(bc.value).toBe('#00ff00');
    });

    it('changing each control fires the matching callback', () => {
      const a = newProject('A');
      const div = newDiv();
      const cb = mockCb();
      renderSidebar(div, {
        projects: [a], currentId: a.id, project: a,
        mode: 'preview', preview: previewState,
      }, cb);

      const needle = div.querySelector<HTMLSelectElement>('select[data-action="needle"]')!;
      needle.value = '110';
      needle.dispatchEvent(new Event('change'));
      expect(cb.onPreviewNeedleChange).toHaveBeenCalledWith(110);

      const thread = div.querySelector<HTMLSelectElement>('select[data-action="thread"]')!;
      thread.value = '0.4';
      thread.dispatchEvent(new Event('change'));
      expect(cb.onPreviewThreadChange).toHaveBeenCalledWith(0.4);

      const tc = div.querySelector<HTMLInputElement>('input[data-action="thread-color"]')!;
      tc.value = '#abcdef';
      tc.dispatchEvent(new Event('input'));
      expect(cb.onPreviewThreadColorChange).toHaveBeenCalledWith('#abcdef');

      const bc = div.querySelector<HTMLInputElement>('input[data-action="bg-color"]')!;
      bc.value = '#123456';
      bc.dispatchEvent(new Event('input'));
      expect(cb.onPreviewBgColorChange).toHaveBeenCalledWith('#123456');

      div.querySelector<HTMLButtonElement>('[data-action="toggle-history"]')!.click();
      expect(cb.onPreviewToggleHistory).toHaveBeenCalledWith(false);

      div.querySelector<HTMLButtonElement>('[data-action="toggle-foot"]')!.click();
      expect(cb.onPreviewToggleFoot).toHaveBeenCalledWith(false);
    });
  });
});
