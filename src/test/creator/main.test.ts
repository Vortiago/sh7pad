// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { mountCreator } from '../../ui/creator/mountCreator.js';
import {
  openProjectRepository,
  type ProjectRepository,
} from '../../creator/projectRepository.js';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

let openRepos: ProjectRepository[] = [];
let dbCounter = 0;

afterEach(() => {
  for (const r of openRepos) r.close();
  openRepos = [];
});

async function makeRepo(): Promise<ProjectRepository> {
  // Per-test fresh IDBFactory + unique db name = clean slate.
  const factory = new IDBFactory();
  const repo = await openProjectRepository({
    factory,
    dbName: `sh7_creator_test_${++dbCounter}`,
  });
  openRepos.push(repo);
  return repo;
}

interface SetupResult {
  repo: ProjectRepository;
  sentinelStorage: FakeStorage;
}

async function setup(opts: { sentinelStorage?: FakeStorage } = {}): Promise<SetupResult> {
  const repo = await makeRepo();
  const sentinelStorage = opts.sentinelStorage ?? new FakeStorage();
  await mountCreator(document, repo, sentinelStorage);
  return { repo, sentinelStorage };
}

function buildCreatorDom(): void {
  document.body.innerHTML = `
    <div id="app">
      <aside id="sidebar"></aside>
      <main>
        <div id="mode-switch"></div>
        <div id="pane-edit">
          <div id="ed-toolbar"></div>
          <div id="ed-canvas-wrap">
            <svg id="ed-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
            <div id="ruler-top"></div>
            <div id="ruler-left"></div>
          </div>
          <div id="ed-inspector"></div>
        </div>
        <div id="pane-preview" hidden>
          <div id="pv-header"></div>
          <div id="pv-canvas-wrap">
            <svg id="pv-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
          <div id="pv-transport"></div>
        </div>
      </main>
      <aside id="stitch-list-panel">
        <div id="stitch-list-header"></div>
        <ol id="stitch-list"></ol>
      </aside>
    </div>
  `;
  document.body.dataset['mode'] = 'edit';
}

describe('mountCreator (integration)', () => {
  it('seeds a sample project when storage is empty', async () => {
    buildCreatorDom();
    await setup();
    expect(document.querySelectorAll('#sidebar [data-project-id]').length).toBeGreaterThan(0);
  });

  it('clicking + New opens the new-project dialog (Mode + Foot pickers)', async () => {
    buildCreatorDom();
    await setup();
    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    expect(document.querySelector('.info-backdrop[data-component="new-project"]')).not.toBeNull();
    expect(document.querySelector('input[name="np-mode"]')).not.toBeNull();
    expect(document.querySelector('input[name="np-foot"]')).not.toBeNull();
  });

  it('confirming the new-project dialog adds a project to the sidebar', async () => {
    buildCreatorDom();
    await setup();
    const before = document.querySelectorAll('#sidebar [data-project-id]').length;
    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')?.click();
    const after = document.querySelectorAll('#sidebar [data-project-id]').length;
    expect(after).toBe(before + 1);
  });

  it('the new project picks up the dialog\'s name, mode, and foot choices', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    document.querySelector<HTMLInputElement>('#np-name')!.value = 'My Embroidery';
    const manual = document.querySelector<HTMLInputElement>('input[name="np-mode"][value="manual"]')!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change'));
    const footB = document.querySelector<HTMLInputElement>('input[name="np-foot"][value="B"]')!;
    footB.checked = true;
    footB.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')?.click();

    const list = await repo.loadAll();
    const fresh = list.find((p) => p.name === 'My Embroidery');
    expect(fresh).toBeDefined();
    expect(fresh?.mode).toBe('manual');
    expect(fresh?.suggestedFoot).toBe('B');
  });

  it('blank name in the dialog falls back to the auto-generated "Stitch N" placeholder', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    // Name input left blank.
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')?.click();

    const list = await repo.loadAll();
    // The newly-created project's name should match the placeholder
    // mountCreator passed in (Stitch <existing+1>).
    expect(list.some((p) => /^Stitch \d+$/.test(p.name))).toBe(true);
  });

  it('writes to storage on every change', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')?.click();
    const list = await repo.loadAll();
    expect(list.length).toBeGreaterThan(0);
  });

  it('mode switch flips body[data-mode] and pane visibility', async () => {
    buildCreatorDom();
    await setup();
    expect(document.body.dataset['mode']).toBe('edit');
    document.querySelector<HTMLButtonElement>('[data-mode="preview"]')?.click();
    expect(document.body.dataset['mode']).toBe('preview');
    expect((document.getElementById('pane-edit') as HTMLElement).hidden).toBe(true);
    expect((document.getElementById('pane-preview') as HTMLElement).hidden).toBe(false);
  });

  it('clicking the sidebar Glossary link opens the glossary modal', async () => {
    buildCreatorDom();
    await setup();
    expect(document.querySelector('.info-backdrop[data-component="glossary"]')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="show-glossary"]')?.click();
    expect(document.querySelector('.info-backdrop[data-component="glossary"]')).not.toBeNull();
    // Foundational concept entries appear under the first section heading.
    const firstHeading = document.querySelector('.glossary-section-title');
    expect(firstHeading?.textContent).toBe('Concepts');
    // Close so the next test starts clean.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  // Suggested Foot is now creation-only (locked at newProject, immutable
  // afterwards). Phase 6 swaps the sidebar dropdown for a read-only label
  // and the change-handler test that used to live here is no longer
  // applicable.

  it('changing Thread Tension in the sidebar persists to storage', async () => {
    buildCreatorDom();
    const { repo } = await setup();

    const range = document.querySelector<HTMLInputElement>('[data-control="threadTensionRange"]')!;
    range.value = '5.5';
    range.dispatchEvent(new Event('input'));

    const list = await repo.loadAll();
    expect(list.some((p) => p.threadTension === 5.5)).toBe(true);
  });

  it('renders the stitch list with one row per segment plus a START row', async () => {
    buildCreatorDom();
    await setup();
    const items = document.querySelectorAll('#stitch-list li[data-row]');
    expect(items.length).toBeGreaterThan(0);
  });

  it('keyboard "2" switches to preview mode', async () => {
    buildCreatorDom();
    await setup();
    expect(document.body.dataset['mode']).toBe('edit');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    expect(document.body.dataset['mode']).toBe('preview');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(document.body.dataset['mode']).toBe('edit');
  });

  it('default active tool is Select', async () => {
    buildCreatorDom();
    await setup();
    const selectBtn = document.querySelector('[data-tool="select"]');
    expect(selectBtn?.getAttribute('data-active')).toBe('true');
    expect(document.querySelector('[data-tool="add"]')?.getAttribute('data-active')).toBe('false');
  });

  it('the canvas-wrap dataset reflects the current tool', async () => {
    buildCreatorDom();
    await setup();
    const wrap = document.getElementById('ed-canvas-wrap')!;
    expect(wrap.dataset['tool']).toBe('select');
    document.querySelector<HTMLButtonElement>('[data-tool="pan"]')?.click();
    expect(wrap.dataset['tool']).toBe('pan');
  });

  it('stitch list shows segment rows including satin (one per segment + START)', async () => {
    buildCreatorDom();
    await setup();
    // Sample project has 8 segments + the start point.
    const rows = document.querySelectorAll('#stitch-list li[data-row]');
    expect(rows.length).toBe(9);
    // At least one satin row should be present (sample has satin segments).
    expect(document.querySelectorAll('#stitch-list li.kind-satin').length).toBeGreaterThan(0);
  });

  it('newly added segment is auto-selected so the inspector pops up immediately', async () => {
    buildCreatorDom();
    await setup();


    document.querySelector<HTMLButtonElement>('[data-tool="add"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-stitch="satin"]')?.click();

    const inspectorBefore = document.getElementById('ed-inspector')!;
    const hadSegmentBefore = inspectorBefore.dataset['segmentId'];

    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 305, clientY: 200,
    }) as unknown as PointerEvent);

    const inspectorAfter = document.getElementById('ed-inspector')!;
    expect(inspectorAfter.dataset['segmentId']).toBeDefined();
    expect(inspectorAfter.dataset['segmentId']).not.toBe(hadSegmentBefore);
    // Inspector should show satin width controls because the new segment is satin.
    expect(inspectorAfter.querySelector('[data-control="widthStart"]')).not.toBeNull();
  });

  it('manual mode: first click after creating a manual project adds a needle stitch (regression: stale closure on project switch)', async () => {
    buildCreatorDom();
    const { repo } = await setup();

    // Create a fresh manual-mode project via the dialog. Default foot is fine —
    // the bug is that the editor's interaction closure still holds the previous
    // 'straight' activeStitch even though the toolbar correctly normalized
    // ui.activeStitch to 'needle' on the new project.
    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    const manual = document.querySelector<HTMLInputElement>('input[name="np-mode"][value="manual"]')!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')?.click();

    // Switch to Add tool. Crucially, do NOT touch the stitch buttons —
    // toggling needle ↔ jump would mask the bug by re-syncing the closure.
    document.querySelector<HTMLButtonElement>('[data-tool="add"]')?.click();

    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    // Click slightly below the start point — within the manual-mode carriage
    // reach of (0,0) and within the 4 mm Y envelope from the start point.
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 300, clientY: 110,
    }) as unknown as PointerEvent);

    const list = await repo.loadAll();
    const manualProj = list.find((p) => p.mode === 'manual');
    expect(manualProj).toBeDefined();
    expect(manualProj?.manualStitches.length).toBe(1);
    expect(manualProj?.manualStitches[0]?.kind).toBe('needle');
  });

  it('design mode: first click after deleting a manual project (falling back to a sibling design project) adds a straight segment (regression: stale closure on delete)', async () => {
    // Reverse direction of the previous test. Sequence:
    //   1. Mount → seeded sample (design) is the only project, active.
    //   2. Create a manual project → it becomes active, ui.activeStitch = 'needle'.
    //   3. Delete the active manual project → fall back to the sample (design).
    //      ui.activeStitch must re-sync to 'straight' on both the toolbar and
    //      the editor's interaction closure.
    //   4. First click on canvas should append a straight segment to the
    //      sample. Without the fix, the closure still holds 'needle' and the
    //      click is routed through the manual-mode bounds check + onAddPoint,
    //      so no design segment lands.
    buildCreatorDom();
    const { repo } = await setup();

    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    const manual = document.querySelector<HTMLInputElement>('input[name="np-mode"][value="manual"]')!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')?.click();

    // Snapshot the sample's segment count before deleting the manual project.
    const beforeList = await repo.loadAll();
    const sampleBefore = beforeList.find((p) => p.mode === 'design')!;
    const sampleSegmentsBefore = sampleBefore.segments.length;

    // Delete the active manual project. With only one delete the active
    // selection falls back to the seeded sample (design mode).
    const origConfirm = window.confirm;
    window.confirm = () => true;
    try {
      document.querySelector<HTMLButtonElement>('[data-action="delete"]')!.click();
    } finally {
      window.confirm = origConfirm;
    }

    document.querySelector<HTMLButtonElement>('[data-tool="add"]')?.click();
    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 305, clientY: 210,
    }) as unknown as PointerEvent);

    const afterList = await repo.loadAll();
    const sampleAfter = afterList.find((p) => p.mode === 'design')!;
    expect(sampleAfter.segments.length).toBe(sampleSegmentsBefore + 1);
    expect(sampleAfter.segments[sampleAfter.segments.length - 1]?.type).toBe('straight');
  });

  it('satin is added when activeStitch=satin and a new point is placed (regression: stale closure)', async () => {
    buildCreatorDom();
    await setup();

    // Switch to Add tool + Satin stitch via the toolbar.
    document.querySelector<HTMLButtonElement>('[data-tool="add"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-stitch="satin"]')?.click();

    const beforeSatin = document.querySelectorAll('#stitch-list li.kind-satin').length;

    // Simulate a pointerdown on empty canvas (close to center so we land
    // inside the hoop regardless of the resize-observer-driven sizing).
    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 305, clientY: 200,
    }) as unknown as PointerEvent);

    const afterSatin = document.querySelectorAll('#stitch-list li.kind-satin').length;
    expect(afterSatin).toBe(beforeSatin + 1);
  });

  it('satin spine is vertical (both endpoints share the previous chain X, top-to-bottom)', async () => {
    buildCreatorDom();
    const { repo } = await setup();


    // Drop a straight stitch off-center first so the chain endpoint is at a
    // non-zero X; the satin should then start at THAT X (not snap to centerline).
    document.querySelector<HTMLButtonElement>('[data-tool="add"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-stitch="straight"]')?.click();

    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 340, clientY: 250,
    }) as unknown as PointerEvent);

    const chainAfterStraight = (await repo.loadAll())[0]!;
    const lastPt = chainAfterStraight.points[chainAfterStraight.points.length - 1]!;
    expect(lastPt.x).not.toBe(0); // sanity: previous chain isn't at centerline

    // Now drop a satin somewhere else; the new satin endpoint should inherit
    // the previous chain endpoint's X (vertical spine, no auto-bridge).
    document.querySelector<HTMLButtonElement>('[data-stitch="satin"]')?.click();
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 360, clientY: 350,
    }) as unknown as PointerEvent);

    const project = (await repo.loadAll())[0]!;
    const lastSatin = [...project.segments].reverse().find((s) => s.type === 'satin')!;
    const fromPt = project.points.find((p) => p.id === lastSatin.from)!;
    const toPt = project.points.find((p) => p.id === lastSatin.to)!;
    expect(fromPt.x).toBe(toPt.x); // spine is vertical
    expect(toPt.x).toBe(lastPt.x); // satin starts where the previous chain left off
    expect(toPt.y).toBeGreaterThan(fromPt.y); // top-to-bottom
  });

  it('Move tool dragging a point updates its coordinates (regression: pointer-move guard)', async () => {
    buildCreatorDom();
    const { repo } = await setup();


    document.querySelector<HTMLButtonElement>('[data-tool="move"]')?.click();

    // Pick a non-satin point so the drag isn't constrained.
    const project = (await repo.loadAll())[0]!;
    const satinPointIds = new Set<string>();
    for (const s of project.segments) {
      if (s.type === 'satin') {
        satinPointIds.add(s.from);
        satinPointIds.add(s.to);
      }
    }
    const target = project.points.find((p) => !satinPointIds.has(p.id) && p.id !== project.points[0]!.id)!;

    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    const ptGroup = svg.querySelector(`[data-point-id="${target.id}"]`)!;
    ptGroup.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 0,
    }) as unknown as PointerEvent);

    // Drag pointer to a deliberate position inside the hoop.
    window.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 380, clientY: 280,
    }) as unknown as PointerEvent);
    window.dispatchEvent(new MouseEvent('pointerup', {
      bubbles: true,
    }) as unknown as PointerEvent);

    const after = (await repo.loadAll())[0]!;
    const moved = after.points.find((p) => p.id === target.id)!;
    // The point should have moved away from its original coordinates.
    expect(moved.x !== target.x || moved.y !== target.y).toBe(true);
  });

  it('clicking on an existing point in Add mode lays a co-located new point (backtrack)', async () => {
    buildCreatorDom();
    const { repo } = await setup();


    document.querySelector<HTMLButtonElement>('[data-tool="add"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-stitch="straight"]')?.click();

    const before = (await repo.loadAll())[0]!;
    const targetId = before.points[2]!.id; // some earlier point in the chain
    const targetCoords = { x: before.points[2]!.x, y: before.points[2]!.y };

    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    // Synthesize a pointerdown whose target is the existing point's group.
    const ptGroup = svg.querySelector(`[data-point-id="${targetId}"]`)!;
    const ev = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }) as unknown as PointerEvent;
    ptGroup.dispatchEvent(ev);

    const after = (await repo.loadAll())[0]!;
    expect(after.points.length).toBe(before.points.length + 1);
    const lastPt = after.points[after.points.length - 1]!;
    expect(lastPt.x).toBe(targetCoords.x);
    expect(lastPt.y).toBe(targetCoords.y);
    expect(lastPt.id).not.toBe(targetId); // new point, not the same one
  });

  it('Subdivide button on a selected segment splits it at its midpoint', async () => {
    buildCreatorDom();
    const { repo } = await setup();

    // Select the first segment (#01) of the SAMPLE.
    const project = (await repo.loadAll())[0]!;
    const segCountBefore = project.segments.length;
    const firstSeg = project.segments[0]!;
    const fromPt = project.points.find((p) => p.id === firstSeg.from)!;
    const toPt = project.points.find((p) => p.id === firstSeg.to)!;
    const midX = (fromPt.x + toPt.x) / 2;
    const midY = (fromPt.y + toPt.y) / 2;

    document.querySelector<HTMLElement>('#stitch-list li[data-row="0"]')!.click();
    const btn = document.querySelector<HTMLButtonElement>('[data-action="subdivide"]');
    expect(btn).not.toBeNull();
    btn!.click();

    const after = (await repo.loadAll())[0]!;
    expect(after.segments.length).toBe(segCountBefore + 1); // split adds 1 segment
    // A new midpoint exists with the expected coordinates.
    const midPt = after.points.find((p) => p.x === midX && p.y === midY);
    expect(midPt).toBeDefined();
  });

  it('Subdivide on a satin segment creates two satin halves with interpolated widths', async () => {
    buildCreatorDom();
    const { repo } = await setup();

    // Find a satin segment in the SAMPLE and select it.
    const project = (await repo.loadAll())[0]!;
    const satinIdx = project.segments.findIndex((s) => s.type === 'satin');
    expect(satinIdx).toBeGreaterThanOrEqual(0);
    const satin = project.segments[satinIdx] as { type: 'satin'; widthStart: number; widthEnd: number };
    const expectedMidWidth = (satin.widthStart + satin.widthEnd) / 2;

    document.querySelector<HTMLElement>(`#stitch-list li[data-row="${satinIdx}"]`)!.click();
    document.querySelector<HTMLButtonElement>('[data-action="subdivide"]')!.click();

    const after = (await repo.loadAll())[0]!;
    const newSatins = after.segments.filter((s) => s.type === 'satin');
    // Both halves should be satin; the first ends at midWidth, second starts there.
    const halfA = after.segments[satinIdx] as { type: 'satin'; widthEnd: number };
    const halfB = after.segments[satinIdx + 1] as { type: 'satin'; widthStart: number };
    expect(halfA.type).toBe('satin');
    expect(halfB.type).toBe('satin');
    expect(halfA.widthEnd).toBeCloseTo(expectedMidWidth, 3);
    expect(halfB.widthStart).toBeCloseTo(expectedMidWidth, 3);
    expect(newSatins.length).toBe(
      project.segments.filter((s) => s.type === 'satin').length + 1,
    );
  });

  it('pressing Delete with a segment selected removes it from the project', async () => {
    buildCreatorDom();
    const { repo } = await setup();

    const before = (await repo.loadAll())[0]!;
    const segCountBefore = before.segments.length;
    const targetSegId = before.segments[1]!.id; // pick a middle segment

    // Select the segment via the stitch list (data-row="1" = second segment).
    document.querySelector<HTMLElement>('#stitch-list li[data-row="1"]')!.click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));

    const after = (await repo.loadAll())[0]!;
    expect(after.segments.length).toBe(segCountBefore - 1);
    expect(after.segments.some((s) => s.id === targetSegId)).toBe(false);
  });

  it('Backspace also deletes a selected segment', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    const segCountBefore = (await repo.loadAll())[0]!.segments.length;
    document.querySelector<HTMLElement>('#stitch-list li[data-row="0"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    const after = (await repo.loadAll())[0]!;
    expect(after.segments.length).toBe(segCountBefore - 1);
  });

  it('Delete is a no-op when only the START row is selected (anchor protection)', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    const segCountBefore = (await repo.loadAll())[0]!.segments.length;
    document.querySelector<HTMLElement>('#stitch-list li[data-row="start"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    const after = (await repo.loadAll())[0]!;
    expect(after.segments.length).toBe(segCountBefore);
  });

  it('Delete pressed inside a slider INPUT does not delete the segment', async () => {
    buildCreatorDom();
    const { repo } = await setup();

    // Select a satin segment so width sliders render.
    const project = (await repo.loadAll())[0]!;
    const satinIdx = project.segments.findIndex((s) => s.type === 'satin');
    document.querySelector<HTMLElement>(`#stitch-list li[data-row="${satinIdx}"]`)!.click();

    const segCountBefore = project.segments.length;

    const slider = document.querySelector<HTMLInputElement>('[data-control="widthStart"]')!;
    slider.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete', bubbles: true,
    }));

    const after = (await repo.loadAll())[0]!;
    expect(after.segments.length).toBe(segCountBefore);
  });

  it('the inspector Delete button removes the selected segment', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    const segCountBefore = (await repo.loadAll())[0]!.segments.length;
    document.querySelector<HTMLElement>('#stitch-list li[data-row="0"]')!.click();
    const btn = document.querySelector<HTMLButtonElement>('#ed-inspector [data-action="delete"]');
    expect(btn).not.toBeNull();
    btn!.click();
    const after = (await repo.loadAll())[0]!;
    expect(after.segments.length).toBe(segCountBefore - 1);
  });

  it('the stitch list trash icon removes that segment without selecting the row', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    const before = (await repo.loadAll())[0]!;
    const segCountBefore = before.segments.length;
    const targetSegId = before.segments[2]!.id;
    const row = document.querySelector<HTMLElement>('#stitch-list li[data-row="2"]')!;
    const del = row.querySelector<HTMLButtonElement>('[data-action="delete"]')!;
    del.click();
    const after = (await repo.loadAll())[0]!;
    expect(after.segments.length).toBe(segCountBefore - 1);
    expect(after.segments.some((s) => s.id === targetSegId)).toBe(false);
  });

  // Color picker regression guards. The color callbacks route through
  // `renderPreviewLive` (canvas + in-place readouts only) instead of a full
  // transport rebuild — that's deliberate, so the native color dialog stays
  // attached to its input element while the user explores colors. These
  // tests guard both the wiring (state propagates to the SVG) and the DOM
  // identity invariant (the input element survives an `input` event).

  it('changing the thread color picker updates the preview SVG --threadColor', async () => {
    buildCreatorDom();
    await setup();
    document.querySelector<HTMLButtonElement>('[data-mode="preview"]')?.click();

    const picker = document.querySelector<HTMLInputElement>('input[data-action="thread-color"]')!;
    expect(picker).not.toBeNull();
    picker.value = '#ff00aa';
    picker.dispatchEvent(new Event('input', { bubbles: true }));

    const svg = document.getElementById('pv-canvas') as unknown as SVGSVGElement;
    expect(svg.style.getPropertyValue('--threadColor')).toBe('#ff00aa');
  });

  it('changing the bg color picker updates the fabric base rect fill in the preview SVG', async () => {
    buildCreatorDom();
    await setup();
    document.querySelector<HTMLButtonElement>('[data-mode="preview"]')?.click();

    const picker = document.querySelector<HTMLInputElement>('input[data-action="bg-color"]')!;
    expect(picker).not.toBeNull();
    picker.value = '#112233';
    picker.dispatchEvent(new Event('input', { bubbles: true }));

    const baseRect = document
      .querySelector('#pv-canvas g.pv-fabric defs pattern rect') as SVGRectElement | null;
    expect(baseRect).not.toBeNull();
    expect(baseRect!.getAttribute('fill')).toBe('#112233');
  });

  // The reason the color callbacks call renderPreviewLive (not a full
  // renderPreviewIfActive) is that `<input type="color">` keeps a native
  // dialog open across many `input` events while the user explores colors.
  // Rebuilding the transport DOM on every event would replace the input
  // element and detach the dialog. This test asserts the picker DOM node
  // identity survives an `input` event so a regression that switches the
  // callback to a full re-render gets caught.
  it('color picker input element identity survives its own input event', async () => {
    buildCreatorDom();
    await setup();
    document.querySelector<HTMLButtonElement>('[data-mode="preview"]')?.click();

    const before = document.querySelector<HTMLInputElement>('input[data-action="thread-color"]')!;
    before.value = '#abcdef';
    before.dispatchEvent(new Event('input', { bubbles: true }));
    const after = document.querySelector<HTMLInputElement>('input[data-action="thread-color"]')!;
    expect(after).toBe(before);
  });

  // The encoder-mode toggle lives in the editor toolbar (next to STITCH)
  // because it controls how design segments get sliced into needle drops —
  // a design-authoring concern, not a preview rendering one. Clicking
  // 'Uniform' must (a) flip the project's persisted encoderMode, and (b)
  // update the toggle's own active state so the next click is meaningful.
  // The mode is on the Project, not UiState, because it must affect the
  // exported bytes — the preview never lies about what the machine will sew.
  it('editor toolbar has an encoder-mode toggle that defaults to compact and switches to uniform on click', async () => {
    buildCreatorDom();
    const { repo } = await setup();
    // SAMPLE seed is a design-mode project; toolbar should render the toggle.

    const compactBtn = document.querySelector<HTMLButtonElement>(
      '#ed-toolbar [data-action="encoder-mode"][data-mode="compact"]',
    );
    const uniformBtn = document.querySelector<HTMLButtonElement>(
      '#ed-toolbar [data-action="encoder-mode"][data-mode="uniform"]',
    );
    expect(compactBtn).not.toBeNull();
    expect(uniformBtn).not.toBeNull();
    expect(compactBtn!.getAttribute('aria-pressed')).toBe('true');
    expect(uniformBtn!.getAttribute('aria-pressed')).toBe('false');

    uniformBtn!.click();

    const loaded = await repo.loadAll();
    expect(loaded[0]?.encoderMode).toBe('uniform');
    const uniformAfter = document.querySelector<HTMLButtonElement>(
      '#ed-toolbar [data-action="encoder-mode"][data-mode="uniform"]',
    )!;
    const compactAfter = document.querySelector<HTMLButtonElement>(
      '#ed-toolbar [data-action="encoder-mode"][data-mode="compact"]',
    )!;
    expect(uniformAfter.getAttribute('aria-pressed')).toBe('true');
    expect(compactAfter.getAttribute('aria-pressed')).toBe('false');
  });

  // Manual projects don't route segments through planFoot — manualSequence
  // emits user-placed stitches verbatim — so the encoder-mode toggle would
  // be misleading there. Pin the contract: manual mode hides the toggle.
  it('encoder-mode toggle is hidden in manual mode', async () => {
    buildCreatorDom();
    await setup();
    document.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    const manual = document.querySelector<HTMLInputElement>('input[name="np-mode"][value="manual"]')!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('[data-action="np-create"]')?.click();

    expect(
      document.querySelector('#ed-toolbar [data-action="encoder-mode"]'),
    ).toBeNull();
  });

  // Sanity check on the wiring: the color pickers boot to the documented
  // defaults exposed from preview.constants. If the UiState init drifts, the
  // pickers would show whatever the renderer assumes and the user's first
  // interaction would jump the preview color rather than refining it.
  it('color pickers initialize to DEFAULT_THREAD_COLOR / DEFAULT_BG_COLOR', async () => {
    const { DEFAULT_THREAD_COLOR, DEFAULT_BG_COLOR } = await import('../../ui/creator/preview/constants.js');
    buildCreatorDom();
    await setup();
    document.querySelector<HTMLButtonElement>('[data-mode="preview"]')?.click();

    const tc = document.querySelector<HTMLInputElement>('input[data-action="thread-color"]')!;
    const bc = document.querySelector<HTMLInputElement>('input[data-action="bg-color"]')!;
    expect(tc.value).toBe(DEFAULT_THREAD_COLOR);
    expect(bc.value).toBe(DEFAULT_BG_COLOR);
  });

  it('adds exactly one new satin segment when previous chain is off-center (no auto-bridge)', async () => {
    buildCreatorDom();
    const { repo } = await setup();


    document.querySelector<HTMLButtonElement>('[data-tool="add"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-stitch="straight"]')?.click();

    const svg = document.getElementById('ed-canvas') as unknown as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 340, clientY: 250,
    }) as unknown as PointerEvent);

    const segCountAfterStraight = (await repo.loadAll())[0]!.segments.length;

    document.querySelector<HTMLButtonElement>('[data-stitch="satin"]')?.click();
    svg.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 360, clientY: 350,
    }) as unknown as PointerEvent);

    const segments = (await repo.loadAll())[0]!.segments;
    expect(segments.length).toBe(segCountAfterStraight + 1); // just the satin, no bridge
    expect(segments[segments.length - 1]!.type).toBe('satin');
  });

  describe('sidebar collapse toggles', () => {
    it('clicking the left-collapse toggle flips body[data-left-collapsed]', async () => {
      buildCreatorDom();
      await setup();

      expect(document.body.dataset['leftCollapsed']).toBeUndefined();

      document.querySelector<HTMLButtonElement>('[data-action="toggle-left-collapse"]')?.click();
      expect(document.body.dataset['leftCollapsed']).toBe('true');

      document.querySelector<HTMLButtonElement>('[data-action="toggle-left-collapse"]')?.click();
      expect(document.body.dataset['leftCollapsed']).toBeUndefined();
    });

    it('clicking the right-collapse toggle flips body[data-right-collapsed]', async () => {
      buildCreatorDom();
      await setup();

      expect(document.body.dataset['rightCollapsed']).toBeUndefined();

      document.querySelector<HTMLButtonElement>('[data-action="toggle-right-collapse"]')?.click();
      expect(document.body.dataset['rightCollapsed']).toBe('true');

      document.querySelector<HTMLButtonElement>('[data-action="toggle-right-collapse"]')?.click();
      expect(document.body.dataset['rightCollapsed']).toBeUndefined();
    });

    it('persists the left-collapsed state to localStorage sentinel', async () => {
      buildCreatorDom();
      const { sentinelStorage } = await setup();

      document.querySelector<HTMLButtonElement>('[data-action="toggle-left-collapse"]')?.click();
      expect(sentinelStorage.getItem('sh7.ui.leftCollapsed')).toBe('1');

      document.querySelector<HTMLButtonElement>('[data-action="toggle-left-collapse"]')?.click();
      expect(sentinelStorage.getItem('sh7.ui.leftCollapsed')).toBeNull();
    });

    it('persists the right-collapsed state to localStorage sentinel', async () => {
      buildCreatorDom();
      const { sentinelStorage } = await setup();

      document.querySelector<HTMLButtonElement>('[data-action="toggle-right-collapse"]')?.click();
      expect(sentinelStorage.getItem('sh7.ui.rightCollapsed')).toBe('1');

      document.querySelector<HTMLButtonElement>('[data-action="toggle-right-collapse"]')?.click();
      expect(sentinelStorage.getItem('sh7.ui.rightCollapsed')).toBeNull();
    });

    it('restores the collapsed state from sentinel storage on mount', async () => {
      buildCreatorDom();
      const seeded = new FakeStorage();
      seeded.setItem('sh7.ui.leftCollapsed', '1');
      seeded.setItem('sh7.ui.rightCollapsed', '1');
      await setup({ sentinelStorage: seeded });

      expect(document.body.dataset['leftCollapsed']).toBe('true');
      expect(document.body.dataset['rightCollapsed']).toBe('true');
    });
  });
});
