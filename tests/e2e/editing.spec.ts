import { test, expect } from '@playwright/test';
import { enterEdit, enterPreview, gotoApp } from './helpers';

// Edit-mode flows against the seeded Wave sample. Each test asserts
// the visible UI reaction (label rebuild, slider/control surface) so
// failures point to the user-facing wiring, not internal state.

test('Edit a satin segment from the stitch list', async ({ page }) => {
  await gotoApp(page);

  // Row 2 is the #03 satin segment per FLOWS.md ("Wave sample" seed).
  const row = page.locator('li[data-row="2"]');
  const segId = await row.getAttribute('data-seg-id');
  expect(segId).toBeTruthy();
  await row.click();

  const inspector = page.locator('#ed-inspector');
  await expect(inspector).toBeVisible();
  // Inspector pins the active segment via its data-segment-id slot.
  await expect(inspector).toHaveAttribute('data-segment-id', segId!);

  // Inspector renders for the segment with type=satin and endAt=right.
  await expect(inspector.locator('select[data-control="type"]')).toHaveValue('satin');
  await expect(inspector.locator('select[data-control="endAt"]')).toHaveValue('right');
  await expect(inspector.locator('[data-testid="inspector-length"]')).not.toBeEmpty();

  // Drag widthStart to 3.05 mm (step-aligned to 0.25+0.1n); the row
  // label rebuilds to reflect the new value. `fill` rejects range inputs
  // whose step doesn't divide the value evenly, so we drive the input
  // directly and dispatch the same `input` event the orchestrator listens for.
  const widthStart = inspector.locator('input[data-control="widthStart"]');
  await widthStart.evaluate((el: HTMLInputElement) => {
    el.value = '3.05';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(row).toContainText('3.0→');

  // Subdivide adds a row and bumps the toolbar segment count.
  const statsBefore = (await page.locator('[data-testid="toolbar-stats"]').textContent()) ?? '';
  const segBefore = Number(/(\d+) seg/.exec(statsBefore)?.[1] ?? '0');

  await inspector.locator('button[data-action="subdivide"]').click();
  await expect(page.locator('[data-testid="toolbar-stats"]')).toContainText(`${segBefore + 1} seg`);

  // Delete removes the selected segment.
  await page.locator('#ed-inspector button[data-action="delete"]').click();
  await expect(page.locator('[data-testid="toolbar-stats"]')).toContainText(`${segBefore} seg`);
});

test('Flip a straight segment to satin from the inspector', async ({ page }) => {
  await gotoApp(page);

  // Row 0 is #01 straight per FLOWS.md.
  const row = page.locator('li[data-row="0"]');
  const segId = await row.getAttribute('data-seg-id');
  expect(segId).toBeTruthy();
  await row.click();

  const inspector = page.locator('#ed-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute('data-segment-id', segId!);

  // Straight rows have no width sliders.
  await expect(inspector.locator('input[data-control="widthStart"]')).toHaveCount(0);
  await expect(inspector.locator('input[data-control="widthEnd"]')).toHaveCount(0);

  // Switch type -> satin. Inspector rebuilds with W START, W END, END AT.
  await inspector.locator('select[data-control="type"]').selectOption('satin');
  await expect(inspector.locator('input[data-control="widthStart"]')).toBeVisible();
  await expect(inspector.locator('input[data-control="widthEnd"]')).toBeVisible();
  await expect(inspector.locator('select[data-control="endAt"]')).toBeVisible();
  await expect(row).toContainText(/satin/);

  // Flip back to straight and confirm the sliders vanish.
  await inspector.locator('select[data-control="type"]').selectOption('straight');
  await expect(inspector.locator('input[data-control="widthStart"]')).toHaveCount(0);
  await expect(row).toContainText(/straight/);
});

test('Toggle DENSITY and watch drop counts change', async ({ page }) => {
  await gotoApp(page);

  const totalDrops = async (): Promise<number> => {
    const text = (await page.locator('[data-testid="preview-drop-count"]').textContent()) ?? '';
    const m = /\d+\/(\d+) drops/.exec(text);
    expect(m, `expected "<n>/<total> drops" in "${text}"`).not.toBeNull();
    return Number(m![1]);
  };

  // Baseline: Compact (default) -> 135 drops in preview.
  await enterPreview(page);
  expect(await totalDrops()).toBe(135);

  await enterEdit(page);
  await page.locator('.ed-toolbar button[data-action="encoder-mode"][data-mode="uniform"]').click();
  await expect(
    page.locator('.ed-toolbar button[data-action="encoder-mode"][data-mode="uniform"]'),
  ).toHaveAttribute('data-active', 'true');

  await enterPreview(page);
  expect(await totalDrops()).not.toBe(135);

  // Flip back to Compact; the total returns to the baseline 135.
  await enterEdit(page);
  await page.locator('.ed-toolbar button[data-action="encoder-mode"][data-mode="compact"]').click();
  await enterPreview(page);
  expect(await totalDrops()).toBe(135);
});
