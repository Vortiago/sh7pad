import { test, expect } from '@playwright/test';

// Smoke suite — verifies the user-visible flows the unit tier can't reach:
// the app loads under the `/sh7pad/` base, the first-load disclaimer opens
// and stays dismissed, sidebar links reopen it plus the glossary, the
// new-project dialog adds a project, edit ↔ preview mode flips, and the
// export dialog surfaces both file-format options.
//
// Playwright gives every test a fresh browser context (no cookies, no
// localStorage, no IndexedDB), so tests don't need to clear storage manually.

test('loads under the /sh7pad/ base with the right title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('sh7pad');
  await expect(page.locator('.sb-brand-title')).toHaveText('sh7pad');
});

test('disclaimer auto-opens on first load with the GitHub link', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('.info-backdrop[data-component="disclaimer"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.info-title')).toContainText('sh7pad');
  const link = dialog.locator('a');
  await expect(link).toHaveAttribute('href', 'https://github.com/Vortiago/sh7pad');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
});

test('"Got it" closes the disclaimer and persists the dismissal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.info-backdrop[data-component="disclaimer"]')).toHaveCount(0);
  const seen = await page.evaluate(() => localStorage.getItem('sh7_disclaimer_seen_v1'));
  expect(seen).toBe('1');
});

test('reload after dismissal does not re-show the disclaimer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.reload();
  await expect(page.locator('.info-backdrop[data-component="disclaimer"]')).toHaveCount(0);
});

test('sidebar About button reopens the disclaimer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: /About this project/ }).click();
  await expect(page.locator('.info-backdrop[data-component="disclaimer"]')).toBeVisible();
});

test('sidebar Glossary button opens the glossary modal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: /Glossary/ }).click();
  const glossary = page.locator('.info-backdrop[data-component="glossary"]');
  await expect(glossary).toBeVisible();
  await expect(glossary.locator('.glossary-section-title').first()).toHaveText('Concepts');
});

test('new-project dialog creates a fresh design project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  const before = await page.locator('#sidebar [data-project-id]').count();
  await page.getByRole('button', { name: '+ New Stitch' }).click();
  await expect(page.locator('.info-backdrop[data-component="new-project"]')).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.info-backdrop[data-component="new-project"]')).toHaveCount(0);
  await expect(page.locator('#sidebar [data-project-id]')).toHaveCount(before + 1);
});

test('keyboard "2" switches to preview mode and "1" returns to edit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  // Click in the editor first so the canvas (not the dismissed dialog button) has focus.
  await page.locator('#ed-canvas-wrap').click({ position: { x: 100, y: 100 } });
  await page.keyboard.press('2');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  await expect(page.locator('#pane-preview')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
});

test('export dialog opens with both file-format options', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: /Export/ }).click();
  const dlg = page.locator('.info-backdrop[data-component="export"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('.sh7');
  await expect(dlg).toContainText('.sh7c.json');
});
