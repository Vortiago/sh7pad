import { test, expect, type Page } from '@playwright/test';

// Manual-mode Add tool: clicking inside the foot's Needle Slot must
// place a stitch. PR #4's Start Stitch + Carriage Start handles
// installed an SVG hit rect over the slot region, which the previous
// pointerdown handler swallowed in every tool — including Add, where
// the same region is the *only* place the user can drop the first
// manual stitch. These tests drive the real DOM with real pointer
// events so a regression in the routing path fails here rather than
// being caught by unit tests that synthesize their own hit targets.

async function openManualProject(page: Page, foot: 'S' | 'B' = 'S'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: '+ New Stitch' }).click();
  await expect(page.locator('.info-backdrop[data-component="new-project"]')).toBeVisible();
  await page.locator('label[data-option="manual"]').click();
  if (foot === 'B') await page.locator('label[data-option="B"]').click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.info-backdrop[data-component="new-project"]')).toHaveCount(0);
  // Wait for the editor to mount its start markers — the toolbar exists
  // as soon as the project is created, but the canvas renders one frame
  // later.
  await expect(page.locator('[data-role="start-marker"]')).toHaveCount(1);
  await expect(page.locator('[data-role="start-stitch"]')).toHaveCount(1);
}

async function readManualStitchCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (globalThis as unknown as {
      __sh7pad_store?: { getState: () => { manualStitches: unknown[] } };
    }).__sh7pad_store;
    return store?.getState().manualStitches.length ?? -1;
  });
}

async function readLastManualStitch(page: Page): Promise<{ kind: string; x: number; y: number } | null> {
  return page.evaluate(() => {
    const store = (globalThis as unknown as {
      __sh7pad_store?: { getState: () => { manualStitches: Array<{ kind: string; x: number; y: number }> } };
    }).__sh7pad_store;
    const list = store?.getState().manualStitches ?? [];
    return list.length === 0 ? null : list[list.length - 1] ?? null;
  });
}

test.describe('Manual mode Add tool routes clicks through the foot markers', () => {
  test('clicking inside the Needle Slot in Add mode places a manual needle stitch', async ({ page }) => {
    await openManualProject(page);

    // Activate Add tool + Needle stitch kind via the toolbar.
    await page.locator('button[data-tool="add"]').click();
    await expect(page.locator('button[data-tool="add"][data-active="true"]')).toBeVisible();
    await page.locator('button[data-stitch="needle"]').click();
    await expect(page.locator('button[data-stitch="needle"][data-active="true"]')).toBeVisible();

    expect(await readManualStitchCount(page)).toBe(0);

    // Click inside the foot's Needle Slot, slightly below the slot's
    // horizontal axis — the slot's vertical centre sits exactly on the
    // chain-anchor Y line (hoop Y = 0), so a click at the geometric
    // centre is on the inclusive yMin boundary and prone to sub-pixel
    // floating-point fuzz that flips the inside-bounds check. Picking a
    // point at 70% of the slot height keeps the test on the bug it's
    // chasing (Add-mode click-through) rather than testing fp tolerance.
    // Pre-fix, the `.ed-start-stitch-hit` rect intercepted this in
    // pointerdown and refused to forward it; post-fix the Add-tool gate
    // lets it through to onAddPoint.
    const slot = page.locator('[data-role="start-stitch"] .ed-start-stitch-hit');
    await expect(slot).toBeVisible();
    const slotBox = await slot.boundingBox();
    expect(slotBox).not.toBeNull();
    await page.mouse.click(
      slotBox!.x + slotBox!.width / 2,
      slotBox!.y + slotBox!.height * 0.7,
    );

    expect(await readManualStitchCount(page)).toBe(1);
    const last = await readLastManualStitch(page);
    expect(last?.kind).toBe('needle');
  });

  test('clicking the Foot Frame body in Add mode places a manual needle stitch (no carriage drag)', async ({ page }) => {
    await openManualProject(page);

    await page.locator('button[data-tool="add"]').click();
    await page.locator('button[data-stitch="needle"]').click();

    // Read carriage so we can confirm it did NOT move when the click
    // landed on the foot body.
    const carriageBefore = await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { getState: () => { startXMm?: number } };
      }).__sh7pad_store;
      return store?.getState().startXMm ?? 0;
    });

    // Pick a point on the foot body that is OUTSIDE the slot — half-way
    // between the body's left edge and the slot's left edge.
    const bodyBox = await page.locator('[data-role="start-marker"] .ed-start-body').boundingBox();
    const slotBox = await page.locator('[data-role="start-marker"] .ed-start-slot').boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(slotBox).not.toBeNull();
    const px = (bodyBox!.x + slotBox!.x) / 2;
    const py = bodyBox!.y + bodyBox!.height / 2;

    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.up();

    // The foot body region sits outside the Needle Slot, so the click
    // may land outside the live-needle window (carriage ± slotHalf).
    // That's a valid no-op — what matters is that the click is NOT
    // routed to onMoveStart: the carriage position is unchanged
    // regardless of whether a stitch landed.
    const carriageAfter = await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { getState: () => { startXMm?: number } };
      }).__sh7pad_store;
      return store?.getState().startXMm ?? 0;
    });
    expect(carriageAfter).toBe(carriageBefore);
  });

  test('jump live-window centres on the Start Stitch when no manual stitch has been placed', async ({ page }) => {
    // Bug B: an empty manual project used a trackFoot frame whose
    // needleXMm fell back to 0 instead of startStitch.x. The jump
    // overlay anchors on the frame's needleXMm, so it drew its ±1 mm
    // band centred on origin even when the user had slid the Start
    // Stitch elsewhere. Visually-driven assertion: with startStitch
    // at +2 mm and no stitches yet, the rendered jump band's centre
    // must equal the Start Stitch glyph's centre, not the hoop origin.
    await openManualProject(page);

    // Slide the Start Stitch to +2 mm via the store (drag would also
    // work but pixel-to-mm conversion would couple this assertion to
    // the dev-server zoom).
    await page.evaluate(() => {
      const store = (globalThis as unknown as {
        __sh7pad_store?: { setState: (u: (p: unknown) => unknown) => void };
      }).__sh7pad_store;
      store?.setState((p) => ({ ...(p as object), startStitch: { x: 2 }, updatedAt: Date.now() }));
    });

    // Activate Add tool + Jump kind so the renderer paints the band.
    await page.locator('button[data-tool="add"]').click();
    await page.locator('button[data-stitch="jump"]').click();
    await expect(page.locator('button[data-stitch="jump"][data-active="true"]')).toBeVisible();

    const band = page.locator('#ed-canvas .ed-needle-window.kind-jump');
    await expect(band).toBeVisible();
    // Target the diamond polygon directly — the parent `start-stitch`
    // group's boundingBox includes the slot-sized hit rect, which is
    // centred on the Carriage Start rather than on the Start Stitch.
    const stitchGlyph = page.locator('[data-role="start-stitch"] .ed-start-stitch-glyph');

    const bandBox = await band.boundingBox();
    const glyphBox = await stitchGlyph.boundingBox();
    expect(bandBox).not.toBeNull();
    expect(glyphBox).not.toBeNull();

    const bandCentreX = bandBox!.x + bandBox!.width / 2;
    const glyphCentreX = glyphBox!.x + glyphBox!.width / 2;
    // The two centres coincide within sub-pixel rendering noise. The
    // pre-fix code put the band at the hoop origin (a clearly visible
    // gap of dozens of px at the dev-server zoom).
    expect(Math.abs(bandCentreX - glyphCentreX)).toBeLessThan(2);
  });
});
