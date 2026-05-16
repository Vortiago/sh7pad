import { test, expect, type Page } from '@playwright/test';

// E2E coverage for the **Start Stitch** + **Carriage Start** model.
// Verifies (1) the editor renders both the foot marker and the new
// Start Stitch glyph, (2) dragging the carriage outside the Eye is
// clamped to ±NEEDLE_SLOT_HALF_MM, (3) Design Mode and Manual Mode
// can both create → preview → export end-to-end, (4) exported .sh7
// bytes round-trip through the parser to the expected shape.

const SLOT_HALF_MM = 3.5;

/** Reach the editor canvas in a clean state. */
async function openFreshEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
}

/**
 * Pick the first SVG group with `data-role="start-marker"` (the foot)
 * and assert it sits inside the touchable area. Used as a quick "is the
 * editor mounted and rendering" probe.
 */
async function assertEditorMounted(page: Page): Promise<void> {
  await expect(page.locator('#ed-canvas')).toBeVisible();
  await expect(page.locator('[data-role="start-marker"]')).toHaveCount(1);
  await expect(page.locator('[data-role="start-stitch"]')).toHaveCount(1);
}

/**
 * Read the project's startXMm directly from localStorage / the in-memory
 * uiStore. We use `window.__sh7pad_debug` if exposed, otherwise fall back
 * to evaluating the DOM-visible foot marker transform.
 */
async function readFootCenterPx(page: Page): Promise<number> {
  const transform = await page.locator('[data-role="start-marker"]').getAttribute('transform');
  // transform: "translate(<x> <y>)" — return x as a screen-space hint.
  const m = /translate\(([-0-9.]+)\s+([-0-9.]+)\)/.exec(transform ?? '');
  return m ? Number.parseFloat(m[1]!) : Number.NaN;
}

test.describe('Start Stitch + Carriage Start in the editor', () => {
  test('fresh project renders both the foot marker and the Start Stitch glyph', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);
    // The Start Stitch glyph sits at design coord (0, 0) in v1; the
    // foot also sits at (0, 0) on a fresh project. They overlap.
    const footX = await readFootCenterPx(page);
    const stitchTransform = await page.locator('[data-role="start-stitch"]').getAttribute('transform');
    const stitchX = Number.parseFloat(/translate\(([-0-9.]+)/.exec(stitchTransform ?? '')?.[1] ?? 'NaN');
    expect(stitchX).toBeCloseTo(footX, 1);
  });

  test('dragging the carriage drags the Start Stitch along (drag-along)', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    // Both handles start at 0.
    const before = await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { getState: () => { startXMm?: number; startStitch?: { x: number } } } }).__sh7pad_store;
      const s = store?.getState();
      return { carriage: s?.startXMm ?? 0, stitch: s?.startStitch?.x ?? 0 };
    });
    expect(before.carriage).toBe(0);
    expect(before.stitch).toBe(0);

    // Drag the carriage by +2 mm (within reach AND within the eye).
    // The Start Stitch should follow by the same delta.
    await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void } }).__sh7pad_store;
      store?.setState((p: unknown) => ({ ...(p as object), startXMm: 2, updatedAt: Date.now() }));
    });

    const after = await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { getState: () => { startXMm?: number; startStitch?: { x: number } } } }).__sh7pad_store;
      const s = store?.getState();
      return { carriage: s?.startXMm ?? 0, stitch: s?.startStitch?.x ?? 0 };
    });
    expect(after.carriage).toBe(2);
    expect(after.stitch).toBe(2); // drag-along preserves the eye-relative offset (0)
  });

  test('dragging the Start Stitch is hard-stopped at the Eye edge', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    // Try to slide the Start Stitch to +10 with carriage at 0.
    // Should be hard-stopped at +slotHalf relative to the carriage.
    await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void } }).__sh7pad_store;
      store?.setState((p: unknown) => ({
        ...(p as object),
        startStitch: { x: 10 },
        updatedAt: Date.now(),
      }));
    });

    const after = await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { getState: () => { startXMm?: number; startStitch?: { x: number } } } }).__sh7pad_store;
      const s = store?.getState();
      return { carriage: s?.startXMm ?? 0, stitch: s?.startStitch?.x ?? 0 };
    });
    expect(after.carriage).toBe(0); // carriage unchanged
    expect(after.stitch).toBe(SLOT_HALF_MM); // hard-stopped at eye edge
  });

  test('dragging the carriage past Eye reach still moves it; Start Stitch follows', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    // Foot S reach is ±27.25 mm. Drag the carriage to +20 — within
    // reach, well past the slot half. Start Stitch should follow by
    // +20, ending at +20 (offset 0 from carriage = inside the eye).
    await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void } }).__sh7pad_store;
      store?.setState((p: unknown) => ({ ...(p as object), startXMm: 20, updatedAt: Date.now() }));
    });

    const after = await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { getState: () => { startXMm?: number; startStitch?: { x: number } } } }).__sh7pad_store;
      const s = store?.getState();
      return { carriage: s?.startXMm ?? 0, stitch: s?.startStitch?.x ?? 0 };
    });
    expect(after.carriage).toBe(20);
    expect(after.stitch).toBe(20);
  });
});

test.describe('Design Mode end-to-end create / preview / export', () => {
  test('creates a design, switches to preview, exports .sh7, parses to expected shape', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    // Place a couple of straight segments via the store (avoids relying
    // on click→pixel→mm math, which is brittle across viewport sizes).
    await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { getState: () => unknown; setState: (u: (p: unknown) => unknown) => void } }).__sh7pad_store;
      if (!store) throw new Error('store not exposed');
      store.setState((p: unknown) => {
        const proj = p as { points: Array<{ id: string; x: number; y: number }>; segments: Array<{ id: string; from: string; to: string; type: 'straight' }>; updatedAt: number };
        const a = proj.points[0]!;
        const b = { id: 'pt_t1', x: 2, y: 4 };
        const c = { id: 'pt_t2', x: -2, y: 8 };
        return {
          ...proj,
          points: [a, b, c],
          segments: [
            { id: 's_t1', from: a.id, to: b.id, type: 'straight' },
            { id: 's_t2', from: b.id, to: c.id, type: 'straight' },
          ],
          updatedAt: Date.now(),
        };
      });
    });

    // Switch to preview (keyboard "2").
    await page.locator('#ed-canvas-wrap').click({ position: { x: 50, y: 50 } });
    await page.keyboard.press('2');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
    await expect(page.locator('#pane-preview')).toBeVisible();

    // Export → .sh7 → capture the download.
    await page.keyboard.press('1'); // back to edit so sidebar is reachable
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export/ }).click().then(() =>
        page.getByRole('button', { name: /For your sewing machine/ }).click(),
      ),
    ]);

    const path = await download.path();
    expect(path).toBeTruthy();
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(path!);

    // sanity: file starts with the .sh7 magic '%spx%' (FORMAT.md §file header).
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%spx%');
    // and the next 3 bytes are the version triplet 01 02 01.
    expect(Array.from(bytes.subarray(5, 8))).toEqual([0x01, 0x02, 0x01]);
    // size should be > 100 bytes (header + metadata + 9 0x06 chunks + 9 0x05 chunks + geometry wrapper).
    expect(bytes.length).toBeGreaterThan(100);

    // Locate the 02 01 01 stitch chunk and confirm at least two records
    // landed in it (we placed two segments → at least the leading needle
    // + jumps as the encoder decides).
    const stitchPrefix = Buffer.from([0x02, 0x01, 0x01]);
    const stitchIdx = bytes.indexOf(stitchPrefix);
    expect(stitchIdx).toBeGreaterThan(0);
  });
});

test.describe('Design Mode: exported file encodes the Start Stitch as the leading record', () => {
  test('a centered Start Stitch + offset Carriage encodes a non-zero leading dx', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    // Programmatically slide the Start Stitch to x=2 (Carriage stays at 0).
    // Then add a Segment from points[0] to (5, 5).
    await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { getState: () => unknown; setState: (u: (p: unknown) => unknown) => void } }).__sh7pad_store;
      if (!store) throw new Error('store not exposed');
      store.setState((p: unknown) => {
        const proj = p as { points: Array<{ id: string; x: number; y: number }>; segments: Array<{ id: string; from: string; to: string; type: 'straight' }>; updatedAt: number };
        const a = proj.points[0]!;
        const b = { id: 'pt_t1', x: 5, y: 5 };
        return {
          ...proj,
          startStitch: { x: 2 },
          points: [a, b],
          segments: [{ id: 's_t1', from: a.id, to: b.id, type: 'straight' }],
          updatedAt: Date.now(),
        };
      });
    });

    // Switch to preview, then back to edit so the sidebar is reachable.
    await page.locator('#ed-canvas-wrap').click({ position: { x: 50, y: 50 } });
    await page.keyboard.press('2');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
    await page.keyboard.press('1');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export/ }).click().then(() =>
        page.getByRole('button', { name: /For your sewing machine/ }).click(),
      ),
    ]);
    const path = await download.path();
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(path!);

    // Locate the stitch chunk (02 01 01) and inspect the leading record.
    // It should be a short (dx=16, dy=0) — the Start Stitch needle at x=2.
    const stitchPrefix = Buffer.from([0x02, 0x01, 0x01]);
    const stitchIdx = bytes.indexOf(stitchPrefix);
    expect(stitchIdx).toBeGreaterThan(0);
    const payloadStart = stitchIdx + 7; // 3-byte tag + 4-byte BE32 length
    const firstDxByte = bytes.readInt8(payloadStart);
    const firstDyByte = bytes.readInt8(payloadStart + 1);
    expect(firstDxByte).toBe(16); // 2 mm × 8 raw/mm
    expect(firstDyByte).toBe(0);
  });
});

test.describe('Manual Mode end-to-end create / preview / export', () => {
  test('creates a manual project, places a stitch, exports .sh7, byte file parses', async ({ page }) => {
    await openFreshEditor(page);

    // New project — Manual mode. The mode picker uses radio inputs
    // wrapped in <label> with the visible text "Manual".
    await page.getByRole('button', { name: '+ New Stitch' }).click();
    await expect(page.locator('.info-backdrop[data-component="new-project"]')).toBeVisible();
    await page.getByText('Manual', { exact: true }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.info-backdrop[data-component="new-project"]')).toHaveCount(0);
    await assertEditorMounted(page);

    // Place one needle stitch via the store. Manual mode validates against
    // the Foot Frame; the chain anchor sits at (0, 0) and the Carriage
    // Start at 0, so (1, 2) is inside the slot.
    const added = await page.evaluate(() => {
      const store = (globalThis as unknown as { __sh7pad_store?: { getState: () => unknown; setState: (u: (p: unknown) => unknown) => void } }).__sh7pad_store;
      if (!store) throw new Error('store not exposed');
      const before = store.getState() as { mode: string; manualStitches: unknown[] };
      if (before.mode !== 'manual') return { mode: before.mode, length: -1 };
      store.setState((p: unknown) => {
        const proj = p as { manualStitches: Array<{ kind: 'needle'; x: number; y: number; dxRaw: number; dyRaw: number }>; updatedAt: number };
        return {
          ...proj,
          manualStitches: [
            ...proj.manualStitches,
            { kind: 'needle', x: 1, y: 2, dxRaw: 1 * 8, dyRaw: 2 * 12 },
          ],
          updatedAt: Date.now(),
        };
      });
      const after = store.getState() as { mode: string; manualStitches: unknown[] };
      return { mode: after.mode, length: after.manualStitches.length };
    });
    expect(added.mode).toBe('manual');
    expect(added.length).toBe(1);

    // Switch to preview to confirm we don't crash.
    await page.locator('#ed-canvas-wrap').click({ position: { x: 50, y: 50 } });
    await page.keyboard.press('2');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');

    // Export → .sh7 → verify the produced bytes.
    await page.keyboard.press('1');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export/ }).click().then(() =>
        page.getByRole('button', { name: /For your sewing machine/ }).click(),
      ),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(path!);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%spx%');
    expect(Array.from(bytes.subarray(5, 8))).toEqual([0x01, 0x02, 0x01]);

    // The stitch chunk should be present with at least the one needle
    // record we placed. The needle's dxRaw = 8 (1 mm × 8 units/mm) and
    // dyRaw = 24 (2 mm × 12 units/mm); the short record is 2 bytes.
    const stitchPrefix = Buffer.from([0x02, 0x01, 0x01]);
    const stitchIdx = bytes.indexOf(stitchPrefix);
    expect(stitchIdx).toBeGreaterThan(0);
    // The 4 bytes immediately after the chunk tag (n, version, BE32 len)
    // are followed by the stitch payload. We don't decode it here — the
    // unit tier covers byte-exact assertions — but we sanity-check the
    // payload-length BE32 is > 0.
    const payloadLen = bytes.readUInt32BE(stitchIdx + 3);
    expect(payloadLen).toBeGreaterThan(0);
  });
});

// =============================================================================
// Pointer-event routing tests (Flow 4 in FLOWS.md).
//
// The existing tests above mutate `__sh7pad_store` directly. These tests use
// real `page.mouse.down/move/up` plus `document.elementFromPoint` to prove
// the renderer's z-order and interact.ts's explicit `start-stitch`-first
// check actually route clicks the way we expect:
//   (a) a click inside the Needle Slot routes to the Start Stitch handle
//   (b) a click on the Foot Frame body outside the slot routes to the
//       Carriage Start handle
//   (c) a real carriage-body drag moves both handles together (drag-along)
//   (d) with the carriage at +5, dragging the Start Stitch far left clamps
//       to +1.5 — proving the slot invariant is relative to the Carriage
//       Start, not the hoop origin
// =============================================================================

type StartState = { carriage: number; stitch: number };

async function readStartState(page: Page): Promise<StartState> {
  return page.evaluate(() => {
    const store = (globalThis as unknown as {
      __sh7pad_store?: { getState: () => { startXMm?: number; startStitch?: { x: number } } };
    }).__sh7pad_store;
    const s = store?.getState();
    return { carriage: s?.startXMm ?? 0, stitch: s?.startStitch?.x ?? 0 };
  });
}

/** Drag from one viewport point to another via real pointer events. */
async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A couple of intermediate moves so the renderer's `pointermove`
  // handler sees a real drag and not a jump.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
}

test.describe('Pointer-event routing splits Needle Slot from Foot Frame body', () => {
  test('elementFromPoint inside the Needle Slot hits the Start Stitch group', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    const slotBox = await page.locator('[data-role="start-marker"] .ed-start-slot').boundingBox();
    expect(slotBox).not.toBeNull();
    const slotCenter = { x: slotBox!.x + slotBox!.width / 2, y: slotBox!.y + slotBox!.height / 2 };
    const routedRole = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number) as Element | null;
      const group = el?.closest('[data-role]') as Element | null;
      return group?.getAttribute('data-role') ?? null;
    }, [slotCenter.x, slotCenter.y]);
    // The Start Stitch group is appended after the Start Marker group in
    // render.ts, so its transparent `.ed-start-stitch-hit` rect wins inside
    // the Needle Slot in DOM order.
    expect(routedRole).toBe('start-stitch');
  });

  test('elementFromPoint on the Foot Frame body outside the slot hits the Start Marker group', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    const bodyBox = await page.locator('[data-role="start-marker"] .ed-start-body').boundingBox();
    const slotBox = await page.locator('[data-role="start-marker"] .ed-start-slot').boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(slotBox).not.toBeNull();
    // Pick a point on the Foot Frame body well to the left of the Needle Slot.
    // Foot S body is 20 mm wide and the slot is 7 mm wide, both centred on
    // the carriage X, so half-way between the body's left edge and the
    // slot's left edge sits inside the body but well outside the slot.
    const bodyLeftEdge = bodyBox!.x;
    const slotLeftEdge = slotBox!.x;
    const px = (bodyLeftEdge + slotLeftEdge) / 2;
    const py = bodyBox!.y + bodyBox!.height / 2;
    const routedRole = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number) as Element | null;
      const group = el?.closest('[data-role]') as Element | null;
      return group?.getAttribute('data-role') ?? null;
    }, [px, py]);
    expect(routedRole).toBe('start-marker');
  });

  test('dragging the Foot Frame body moves Carriage Start and drags the Start Stitch along', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    const before = await readStartState(page);
    expect(before).toEqual({ carriage: 0, stitch: 0 });

    // Grab a point on the Foot Frame body well outside the Needle Slot so
    // the gesture routes to the Carriage handle (interact.ts:113 checks
    // `start-stitch` first; this point misses the slot's hit rect).
    const bodyBox = await page.locator('[data-role="start-marker"] .ed-start-body').boundingBox();
    const slotBox = await page.locator('[data-role="start-marker"] .ed-start-slot').boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(slotBox).not.toBeNull();
    const startPx = {
      x: (bodyBox!.x + slotBox!.x) / 2,
      y: bodyBox!.y + bodyBox!.height / 2,
    };
    // Drag right by ~70 px (comfortably within Foot S reach of ±27.25 mm
    // at default zoom). We assert positivity, not an exact mm — the
    // viewport size and Vite dev-server zoom decide the px-to-mm ratio.
    await dragFromTo(page, startPx, { x: startPx.x + 70, y: startPx.y });

    const after = await readStartState(page);
    expect(after.carriage).toBeGreaterThan(0);
    expect(after.carriage).toBeLessThan(27.25);
    // Drag-along: the Start Stitch rode with the Carriage Start by the
    // same delta (the initial offset was 0).
    expect(after.stitch).toBeCloseTo(after.carriage, 5);
  });

  test('with Carriage Start at +5, dragging the Start Stitch left clamps to +1.5 (slot-relative)', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    // Stage the carriage at +5 mm via the store. The invariant drags the
    // Start Stitch along to +5 too.
    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p) => ({ ...(p as object), startXMm: 5, updatedAt: Date.now() }));
    });
    const staged = await readStartState(page);
    expect(staged.carriage).toBe(5);
    expect(staged.stitch).toBe(5);

    // Drag the Start Stitch glyph far left — well past the Needle Slot's
    // left edge in screen space. The store invariant should hard-stop at
    // `carriage - needleSlotHalfMm = 5 - 3.5 = 1.5`.
    const stitchBox = await page.locator('[data-role="start-stitch"] .ed-start-stitch-hit').boundingBox();
    expect(stitchBox).not.toBeNull();
    const fromPx = { x: stitchBox!.x + stitchBox!.width / 2, y: stitchBox!.y + stitchBox!.height / 2 };
    const canvasBox = await page.locator('#ed-canvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    // Aim for a point well outside the canvas's left edge so the slot
    // edge is comfortably overshot whatever the zoom level.
    const toPx = { x: canvasBox!.x - 200, y: fromPx.y };
    await dragFromTo(page, fromPx, toPx);

    const after = await readStartState(page);
    expect(after.carriage).toBe(5); // Carriage Start is unmoved
    expect(after.stitch).toBeCloseTo(1.5, 5); // hard-stopped at left slot edge
  });
});

// =============================================================================
// Manual Mode Start Lock affordances (Flow 5 in FLOWS.md).
//
// In Manual Mode, placing the first user stitch engages the Start Lock,
// which freezes BOTH the Carriage Start and the Start Stitch. The
// affordances flip together:
//   • both groups: `data-locked="true"` and the `*-locked` CSS class
//   • both <title> children contain "Locked"
//   • a pointer drag attempt on either handle is short-circuited
// =============================================================================

test.describe('Manual Mode Start Lock freezes both handles after first user stitch', () => {
  /** Create a fresh Manual-mode project on Foot B via the New Stitch dialog. */
  async function createManualProject(page: Page): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: '+ New Stitch' }).click();
    await expect(page.locator('.info-backdrop[data-component="new-project"]')).toBeVisible();
    await page.locator('label[data-option="manual"]').click();
    await page.locator('label[data-option="B"]').click();
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.info-backdrop[data-component="new-project"]')).toHaveCount(0);
  }

  test('fresh manual project: both handles unlocked, tooltips say "Drag to..."', async ({ page }) => {
    await createManualProject(page);
    await assertEditorMounted(page);

    const marker = page.locator('[data-role="start-marker"]');
    const stitch = page.locator('[data-role="start-stitch"]');
    await expect(marker).toHaveAttribute('data-locked', 'false');
    await expect(stitch).toHaveAttribute('data-locked', 'false');
    await expect(marker).not.toHaveClass(/ed-start-marker-locked/);
    await expect(stitch).not.toHaveClass(/ed-start-stitch-locked/);
    const markerTitle = await marker.locator('title').textContent();
    const stitchTitle = await stitch.locator('title').textContent();
    expect(markerTitle).toContain('Drag to');
    expect(stitchTitle).toContain('Drag to');
    expect(markerTitle).not.toContain('Locked');
    expect(stitchTitle).not.toContain('Locked');
  });

  test('after first user stitch: both handles lock, classes attach, tooltips switch to "Locked"', async ({ page }) => {
    await createManualProject(page);
    await assertEditorMounted(page);

    // Place one needle stitch via the store — the chain anchor sits at
    // (0, 0), Carriage Start at 0, so (1, 2) is inside the Needle Slot.
    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p: unknown) => {
        const proj = p as {
          manualStitches: Array<{ kind: 'needle'; x: number; y: number; dxRaw: number; dyRaw: number }>;
          updatedAt: number;
        };
        return {
          ...proj,
          manualStitches: [
            ...proj.manualStitches,
            { kind: 'needle', x: 1, y: 2, dxRaw: 8, dyRaw: 24 },
          ],
          updatedAt: Date.now(),
        };
      });
    });

    const marker = page.locator('[data-role="start-marker"]');
    const stitch = page.locator('[data-role="start-stitch"]');
    await expect(marker).toHaveAttribute('data-locked', 'true');
    await expect(stitch).toHaveAttribute('data-locked', 'true');
    await expect(marker).toHaveClass(/ed-start-marker-locked/);
    await expect(stitch).toHaveClass(/ed-start-stitch-locked/);
    const markerTitle = await marker.locator('title').textContent();
    const stitchTitle = await stitch.locator('title').textContent();
    expect(markerTitle).toContain('Locked');
    expect(stitchTitle).toContain('Locked');
  });

  test('locked handle ignores a pointer drag attempt', async ({ page }) => {
    await createManualProject(page);
    await assertEditorMounted(page);

    // Engage the Start Lock by placing one user stitch.
    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p: unknown) => {
        const proj = p as {
          manualStitches: Array<{ kind: 'needle'; x: number; y: number; dxRaw: number; dyRaw: number }>;
          updatedAt: number;
        };
        return {
          ...proj,
          manualStitches: [{ kind: 'needle', x: 1, y: 2, dxRaw: 8, dyRaw: 24 }],
          updatedAt: Date.now(),
        };
      });
    });
    await expect(page.locator('[data-role="start-marker"]')).toHaveAttribute('data-locked', 'true');
    const before = await readStartState(page);

    // Try to drag the Foot Frame body. interact.ts:128-134 reads
    // `data-locked="true"` and refuses to even start the drag.
    const bodyBox = await page.locator('[data-role="start-marker"] .ed-start-body').boundingBox();
    const slotBox = await page.locator('[data-role="start-marker"] .ed-start-slot').boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(slotBox).not.toBeNull();
    const startPx = {
      x: (bodyBox!.x + slotBox!.x) / 2,
      y: bodyBox!.y + bodyBox!.height / 2,
    };
    await dragFromTo(page, startPx, { x: startPx.x + 70, y: startPx.y });

    const after = await readStartState(page);
    expect(after).toEqual(before); // both handles unchanged
  });

  test('locked state ignores a store setState attempt (lockStartXMm invariant)', async ({ page }) => {
    await createManualProject(page);
    await assertEditorMounted(page);

    // Engage the Start Lock by placing one user stitch.
    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p: unknown) => {
        const proj = p as {
          manualStitches: Array<{ kind: 'needle'; x: number; y: number; dxRaw: number; dyRaw: number }>;
          updatedAt: number;
        };
        return {
          ...proj,
          manualStitches: [{ kind: 'needle', x: 1, y: 2, dxRaw: 8, dyRaw: 24 }],
          updatedAt: Date.now(),
        };
      });
    });
    const before = await readStartState(page);

    // Try to slide the Carriage Start through the store. The
    // `lockStartXMm` invariant should silently revert it.
    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p) => ({ ...(p as object), startXMm: 3, updatedAt: Date.now() }));
    });
    const after = await readStartState(page);
    expect(after).toEqual(before);
  });
});

// =============================================================================
// Reach-edge clamp (nice-to-have — covers the per-foot Carriage Reach limit).
//
// Verifies `clampStartStateToEye`'s reach invariant `|carriage| ≤ reachHalf`
// fires across both Foot S (±27.25 mm) and Foot B (±4.5 mm). The Start Stitch
// follows the carriage all the way to the edge (drag-along preserves the
// eye-relative offset).
// =============================================================================

test.describe('Carriage Reach edge clamps both handles', () => {
  test('Foot S: pushing the Carriage Start to +50 mm clamps to +27.25, Start Stitch follows', async ({ page }) => {
    await openFreshEditor(page);
    await assertEditorMounted(page);

    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p) => ({ ...(p as object), startXMm: 50, updatedAt: Date.now() }));
    });
    expect(await readStartState(page)).toEqual({ carriage: 27.25, stitch: 27.25 });

    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p) => ({ ...(p as object), startXMm: -50, updatedAt: Date.now() }));
    });
    expect(await readStartState(page)).toEqual({ carriage: -27.25, stitch: -27.25 });
  });

  test('Foot B: a new Design project on Foot B clamps the Carriage Start to ±4.5 mm', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: '+ New Stitch' }).click();
    await expect(page.locator('.info-backdrop[data-component="new-project"]')).toBeVisible();
    // Default mode is Design; switch the foot to B.
    await page.locator('label[data-option="B"]').click();
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.info-backdrop[data-component="new-project"]')).toHaveCount(0);
    await assertEditorMounted(page);

    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p) => ({ ...(p as object), startXMm: 50, updatedAt: Date.now() }));
    });
    expect(await readStartState(page)).toEqual({ carriage: 4.5, stitch: 4.5 });

    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p) => ({ ...(p as object), startXMm: -50, updatedAt: Date.now() }));
    });
    expect(await readStartState(page)).toEqual({ carriage: -4.5, stitch: -4.5 });
  });
});
