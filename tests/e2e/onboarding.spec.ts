import { test, expect } from '@playwright/test';
import { dismissDisclaimer } from './helpers';

// First-load onboarding flows from FLOWS.md: disclaimer dismissal +
// the two sidebar info entry points (About + Glossary). Each test runs
// in a fresh browser context so the disclaimer reliably auto-opens.

test('Dismiss the first-load disclaimer', async ({ page }) => {
  await page.goto('/');

  const dialog = page.locator('[data-component="disclaimer"]');
  await expect(dialog).toBeVisible();

  await page.locator('button[data-action="disclaimer-dismiss"]').click();
  await expect(dialog).toHaveCount(0);

  // Persistence sentinel: dismissal records into localStorage and survives reload.
  const seen = await page.evaluate(() => localStorage.getItem('sh7_disclaimer_seen_v1'));
  expect(seen).toBe('1');

  await page.reload();
  await expect(page.locator('[data-component="disclaimer"]')).toHaveCount(0);
});

test('Reopen the About modal from the sidebar', async ({ page }) => {
  await page.goto('/');
  await dismissDisclaimer(page);

  await page.locator('button[data-action="show-disclaimer"]').click();
  const dialog = page.locator('[data-component="disclaimer"]');
  await expect(dialog).toBeVisible();

  const link = dialog.locator('a[href*="github.com/Vortiago/sh7pad"]');
  await expect(link).toHaveAttribute('href', 'https://github.com/Vortiago/sh7pad');

  await page.locator('button[data-action="disclaimer-dismiss"]').click();
  await expect(dialog).toHaveCount(0);
});

test('Reopen the Glossary modal from the sidebar', async ({ page }) => {
  await page.goto('/');
  await dismissDisclaimer(page);

  await page.locator('button[data-action="show-glossary"]').click();
  const glossary = page.locator('[data-component="glossary"]');
  await expect(glossary).toBeVisible();
  await expect(glossary.locator('.glossary-section-title').first()).toHaveText('Concepts');

  await page.locator('button[data-action="glossary-close"]').click();
  await expect(glossary).toHaveCount(0);
});
