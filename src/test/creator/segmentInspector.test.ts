import { describe, it, expect, vi } from 'vitest';
import {
  renderSegmentInspector,
  type InspectorCallbacks,
  SATIN_WIDTH_MAX,
  SATIN_WIDTH_MIN,
} from '../../ui/creator/segmentInspector/index.js';
import { newProject } from '../../creator/project.js';
import type { Project, Segment } from '../../creator/types.js';

const newDiv = (): HTMLDivElement => document.createElement('div');

const noopCallbacks = (overrides: Partial<InspectorCallbacks> = {}): InspectorCallbacks => ({
  onChange: () => {},
  onSubdivide: () => {},
  onDelete: () => {},
  onDeletePoint: () => {},
  ...overrides,
});

const projectWith = (seg: Segment): Project => {
  const fresh = newProject('X');
  return {
    ...fresh,
    points: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 10 },
    ],
    segments: [seg],
  };
};

describe('renderSegmentInspector', () => {
  it('renders nothing visible when selection is null', () => {
    const div = newDiv();
    const project = newProject('X');
    renderSegmentInspector(div, project, null, noopCallbacks());
    expect(div.children.length).toBe(0);
  });

  it('renders a TYPE selector with current value', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    const sel = div.querySelector<HTMLSelectElement>('[data-control="type"]');
    expect(sel?.value).toBe('straight');
  });

  it('changing TYPE to satin calls onChange with type=satin and width defaults', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    const onChange = vi.fn();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks({ onChange }));
    const sel = div.querySelector<HTMLSelectElement>('[data-control="type"]')!;
    sel.value = 'satin';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [target, patch] = onChange.mock.calls[0]!;
    expect(target).toEqual({ kind: 'segment', id: 's1' });
    expect(patch.type).toBe('satin');
    expect(patch.widthStart).toBeGreaterThan(0);
    expect(patch.widthEnd).toBeGreaterThan(0);
  });

  it('renders W START and W END sliders for satin segments', () => {
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 4.5, density: 0.6,
    });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    expect(div.querySelector('[data-control="widthStart"]')).not.toBeNull();
    expect(div.querySelector('[data-control="widthEnd"]')).not.toBeNull();
  });

  it('does NOT render W START / W END for straight segments', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    expect(div.querySelector('[data-control="widthStart"]')).toBeNull();
  });

  it('shows "imported" hint for satin segments flagged as imported', () => {
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 4.5, density: 0.6, imported: true,
    });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    expect(div.textContent ?? '').toMatch(/imported/i);
  });

  it('satin width sliders span the firmware-needle-window envelope (0.25 to 7 mm)', () => {
    // The encoder caps satin widthStart / widthEnd at the firmware needle
    // window — see SATIN_WIDTH_MAX_MM in sh7Limits.ts. The slider must
    // mirror that envelope so the user can't author a cone the export
    // step is going to refuse. Asserts exact equality so the inspector
    // and encoder stay in lockstep when the observed bounds change.
    expect(SATIN_WIDTH_MIN).toBe(0.25);
    expect(SATIN_WIDTH_MAX).toBe(7);
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 4.5, density: 0.6,
    });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    const input = div.querySelector<HTMLInputElement>('[data-control="widthStart"]');
    expect(Number(input?.max)).toBe(7);
    expect(Number(input?.min)).toBe(0.25);
  });

  it('re-rendering the same segment does NOT replace the slider DOM element (drag preservation)', () => {
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 2.4, density: 0.6,
    });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    const before = div.querySelector('[data-control="widthStart"]');

    // Project value changes; re-render with same selection.
    const updated: Project = {
      ...project,
      segments: [{ ...project.segments[0]!, widthStart: 5.7 }] as Segment[],
    };
    renderSegmentInspector(div, updated, { kind: 'segment', id: 's1' }, noopCallbacks());
    const after = div.querySelector('[data-control="widthStart"]');

    expect(after).toBe(before); // same node, not destroyed
    expect((after as HTMLInputElement).value).toBe('5.7');
  });

  it('re-rendering for a different segment DOES replace the DOM (rebuild)', () => {
    const seg1: Segment = { id: 's1', from: 'a', to: 'b', type: 'satin', widthStart: 2.4, widthEnd: 2.4, density: 0.6 };
    const seg2: Segment = { id: 's2', from: 'a', to: 'b', type: 'satin', widthStart: 3.6, widthEnd: 3.6, density: 0.6 };
    const project = { ...projectWith(seg1), segments: [seg1, seg2] };
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    const before = div.querySelector('[data-control="widthStart"]');
    renderSegmentInspector(div, project, { kind: 'segment', id: 's2' }, noopCallbacks());
    const after = div.querySelector('[data-control="widthStart"]');
    expect(after).not.toBe(before); // rebuilt, different element
    expect((after as HTMLInputElement).value).toBe('3.6');
  });

  it('renders a Subdivide button and clicking it calls onSubdivide with the segment id', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    const onSubdivide = vi.fn();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks({ onSubdivide }));
    const btn = div.querySelector<HTMLButtonElement>('[data-action="subdivide"]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onSubdivide).toHaveBeenCalledWith('s1');
  });

  it('renders a Delete button and clicking it calls onDelete with the segment id', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    const onDelete = vi.fn();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks({ onDelete }));
    const btn = div.querySelector<HTMLButtonElement>('[data-action="delete"]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onDelete).toHaveBeenCalledWith({ kind: 'segment', id: 's1' });
  });

  it('renders an END AT selector for satin segments with the current value', () => {
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 2.4, density: 0.6, endAt: 'left',
    });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    const sel = div.querySelector<HTMLSelectElement>('[data-control="endAt"]');
    expect(sel).not.toBeNull();
    expect(sel!.value).toBe('left');
  });

  it('END AT defaults to "right" when endAt is undefined', () => {
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 2.4, density: 0.6,
    });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    const sel = div.querySelector<HTMLSelectElement>('[data-control="endAt"]');
    expect(sel!.value).toBe('right');
  });

  it('changing END AT calls onChange with { endAt: ... }', () => {
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 2.4, density: 0.6,
    });
    const div = newDiv();
    const onChange = vi.fn();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks({ onChange }));
    const sel = div.querySelector<HTMLSelectElement>('[data-control="endAt"]')!;
    sel.value = 'left';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ kind: 'segment', id: 's1' }, { endAt: 'left' });
  });

  it('does NOT render END AT for straight segments', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    expect(div.querySelector('[data-control="endAt"]')).toBeNull();
  });

  it('does not overwrite a focused slider value during re-render (focus drag in progress)', () => {
    const project = projectWith({
      id: 's1', from: 'a', to: 'b', type: 'satin',
      widthStart: 2.4, widthEnd: 2.4, density: 0.6,
    });
    const div = newDiv();
    document.body.appendChild(div); // focus only works for elements in the document
    renderSegmentInspector(div, project, { kind: 'segment', id: 's1' }, noopCallbacks());
    const input = div.querySelector<HTMLInputElement>('[data-control="widthStart"]')!;
    input.focus();
    // 6.0 mm sits inside [SATIN_WIDTH_MIN, SATIN_WIDTH_MAX] so jsdom won't
    // clamp it; the test's concern is focus preservation, not the value.
    input.value = '6.0';
    // Re-render with a different value (simulating an external change).
    const updated: Project = {
      ...project,
      segments: [{ ...project.segments[0]!, widthStart: 1.0 }] as Segment[],
    };
    renderSegmentInspector(div, updated, { kind: 'segment', id: 's1' }, noopCallbacks());
    expect(input.value).toBe('6.0'); // user's drag value preserved
    div.remove();
  });

  it('renders a point inspector when a non-anchor point is selected', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'point', id: 'b' }, noopCallbacks());
    // POINT label appears, no segment-only TYPE selector.
    expect(div.textContent ?? '').toMatch(/POINT/);
    expect(div.querySelector('[data-control="type"]')).toBeNull();
    const del = div.querySelector<HTMLButtonElement>('[data-action="delete-point"]');
    expect(del).not.toBeNull();
    expect(del!.disabled).toBe(false);
  });

  it('disables delete on the start anchor (points[0])', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'point', id: 'a' }, noopCallbacks());
    const del = div.querySelector<HTMLButtonElement>('[data-action="delete-point"]');
    expect(del!.disabled).toBe(true);
    expect(div.textContent ?? '').toMatch(/start anchor/i);
  });

  it('clicking the point delete button calls onDeletePoint with the id', () => {
    const project = projectWith({ id: 's1', from: 'a', to: 'b', type: 'straight' });
    const div = newDiv();
    const onDeletePoint = vi.fn();
    renderSegmentInspector(div, project, { kind: 'point', id: 'b' }, noopCallbacks({ onDeletePoint }));
    div.querySelector<HTMLButtonElement>('[data-action="delete-point"]')!.click();
    expect(onDeletePoint).toHaveBeenCalledWith('b');
  });
});

describe('renderSegmentInspector — manual-satin Delete is gated on last entry', () => {
  function manualSatinProject(count: number): Project {
    const fresh = newProject('M', { mode: 'manual', suggestedFoot: 'S' });
    return {
      ...fresh,
      manualStitches: Array.from({ length: count }, (_, i) => ({
        kind: 'satin' as const,
        x: 0, y: i * 4,
        toX: 0, toY: i * 4 + 3,
        widthStart: 2, widthEnd: 2, density: 0.6,
      })),
    };
  }

  it('renders a Delete button on the last manual-satin entry', () => {
    const project = manualSatinProject(2);
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'manual-satin', idx: 1 }, noopCallbacks());
    expect(div.querySelector('[data-action="delete"]')).not.toBeNull();
  });

  it('omits the Delete button on a non-last manual-satin entry', () => {
    const project = manualSatinProject(2);
    const div = newDiv();
    renderSegmentInspector(div, project, { kind: 'manual-satin', idx: 0 }, noopCallbacks());
    expect(div.querySelector('[data-action="delete"]')).toBeNull();
  });
});
