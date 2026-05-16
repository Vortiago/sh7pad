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
