import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers';

// Export dialog: both file-format paths trigger a download, Cancel/Escape close it cleanly.

test('Export the project in both formats', async ({ page }) => {
  await gotoApp(page);

  const openExport = async (): Promise<void> => {
    await page.locator('#sidebar button[data-action="export"]').click();
    await expect(page.locator('[data-component="export"]')).toBeVisible();
  };

  // .sh7 download.
  await openExport();
  await expect(page.locator('[data-component="export"]')).toContainText('.sh7');
  await expect(page.locator('[data-component="export"]')).toContainText('.sh7c.json');

  const sh7Download = page.waitForEvent('download');
  await page.locator('button[data-action="export-sh7"]').click();
  const sh7 = await sh7Download;
  expect(sh7.suggestedFilename()).toMatch(/\.sh7$/);
  await expect(page.locator('[data-component="export"]')).toHaveCount(0);

  // .sh7c.json download.
  await openExport();
  const jsonDownload = page.waitForEvent('download');
  await page.locator('button[data-action="export-sh7c-json"]').click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toMatch(/\.sh7c\.json$/);
  await expect(page.locator('[data-component="export"]')).toHaveCount(0);

  // Cancel closes the dialog without triggering a download.
  await openExport();
  await page.locator('button[data-action="export-cancel"]').click();
  await expect(page.locator('[data-component="export"]')).toHaveCount(0);

  // Escape closes the dialog (single-instance guard means it can't double up).
  await openExport();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-component="export"]')).toHaveCount(0);
});
