import { expect, type Page, type Locator } from '@playwright/test';

// Shared helpers for the FLOWS.md-driven specs. Kept minimal: only
// bits used in 3+ specs end up here. Selectors follow the FLOWS.md
// convention order: data-action > data-testid > data-component >
// role+name.

/**
 * Open the app at /sh7pad/ and dismiss the first-load disclaimer.
 * Every spec begins from a fresh context so the dialog always shows
 * — we click "Got it" and wait for the backdrop to detach before
 * yielding control back to the test.
 */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await dismissDisclaimer(page);
}

/**
 * Dismiss the disclaimer if it's open. No-op when already dismissed —
 * useful for tests that reload the page mid-flow.
 */
export async function dismissDisclaimer(page: Page): Promise<void> {
  const dismiss = page.locator('button[data-action="disclaimer-dismiss"]');
  if (await dismiss.count()) {
    await dismiss.click();
    await expect(
      page.locator('[data-component="disclaimer"]'),
    ).toHaveCount(0);
  }
}

/** The active project row in the sidebar (data-active="true"). */
export function activeProjectRow(page: Page): Locator {
  return page.locator('#sidebar [data-project-id][data-active="true"]');
}

/** All project rows in the sidebar (regardless of active state). */
export function projectRows(page: Page): Locator {
  return page.locator('#sidebar [data-project-id]');
}

/** Switch into preview mode via the mode-switch pill above the editor pane. */
export async function enterPreview(page: Page): Promise<void> {
  await page.locator('#mode-switch button[data-mode="preview"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
}

/** Switch into edit mode via the mode-switch pill above the editor pane. */
export async function enterEdit(page: Page): Promise<void> {
  await page.locator('#mode-switch button[data-mode="edit"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
}
