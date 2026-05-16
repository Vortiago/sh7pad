import { test, expect } from '@playwright/test';
import { enterEdit, gotoApp } from './helpers';

// Sidebar-driven flows: background tracing image, side-rail collapse,
// thread tension. None require Preview mode.

// 1×1 transparent PNG. Used by the background-image flow so the file
// picker has something tangible to upload without depending on disk
// fixtures.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('Add and remove a background tracing image', async ({ page }) => {
  await gotoApp(page);

  const fileInput = page.locator('input[aria-label="Choose background image"]');
  await fileInput.setInputFiles({
    name: 'tracing.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });

  // Controls block replaces the Add button.
  await expect(page.locator('button[data-action="bg-add"]')).toHaveCount(0);
  const opacity = page.locator('input[data-bg-control="opacity"]');
  await expect(opacity).toBeVisible();

  // Drag opacity to 0.3. The input's value reflects the change; the
  // canvas is a <canvas> so we don't assert pixels here.
  await opacity.fill('0.3');
  await expect(opacity).toHaveValue('0.3');

  // Lock toggle suppresses pointer drags on the bg image.
  const lock = page.locator('input[data-bg-control="locked"]');
  await lock.check();
  await expect(lock).toBeChecked();

  // Remove image returns the panel to the Add state.
  await page.locator('button[data-action="bg-remove"]').click();
  await expect(page.locator('button[data-action="bg-add"]')).toBeVisible();
});

test('Collapse and expand the side rails', async ({ page }) => {
  await gotoApp(page);

  const body = page.locator('body');

  // Collapse the left rail.
  await page.locator('button[data-action="toggle-left-collapse"]').click();
  await expect(body).toHaveAttribute('data-left-collapsed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('sh7.ui.leftCollapsed'))).toBe('1');

  // Collapse the right rail.
  await page.locator('button[data-action="toggle-right-collapse"]').click();
  await expect(body).toHaveAttribute('data-right-collapsed', 'true');

  // Reload preserves both collapsed states.
  await page.reload();
  await expect(body).toHaveAttribute('data-left-collapsed', 'true');
  await expect(body).toHaveAttribute('data-right-collapsed', 'true');

  // Expand both rails. Layout flips back; localStorage sentinel is cleared.
  await page.locator('button[data-action="toggle-left-collapse"]').click();
  await page.locator('button[data-action="toggle-right-collapse"]').click();
  await expect(body).not.toHaveAttribute('data-left-collapsed', 'true');
  await expect(body).not.toHaveAttribute('data-right-collapsed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('sh7.ui.leftCollapsed'))).toBeNull();
});

test('Adjust Thread Tension from the sidebar', async ({ page }) => {
  await gotoApp(page);
  await enterEdit(page);

  const range = page.locator('input[data-control="threadTensionRange"]');
  const number = page.locator('input[data-control="threadTensionNumber"]');

  // Default tension is 4 — both controls mirror each other at the start.
  await expect(range).toHaveValue('4');
  await expect(number).toHaveValue('4');

  // Range drives the number.
  await range.fill('2');
  await expect(number).toHaveValue('2');

  // Number drives the range (blur via Tab fires `change`).
  await number.fill('6');
  await number.press('Tab');
  await expect(range).toHaveValue('6');

  // Persistence: round-trip through reload.
  await page.reload();
  await expect(page.locator('input[data-control="threadTensionRange"]')).toHaveValue('6');
  await expect(page.locator('input[data-control="threadTensionNumber"]')).toHaveValue('6');
});
