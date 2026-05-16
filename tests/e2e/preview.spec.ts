import { test, expect } from '@playwright/test';
import { enterEdit, enterPreview, gotoApp } from './helpers';

// Preview transport + Preview Settings flows. Uses the seeded "Wave
// sample" which has 135 drops at the Compact (default) encoder.

test('Switch to Preview, play, scrub, and return to Edit', async ({ page }) => {
  await gotoApp(page);
  await enterPreview(page);

  // Preview pane visible, edit pane hidden, drop readout at 0/135.
  await expect(page.locator('#pane-preview')).toBeVisible();
  await expect(page.locator('#pane-edit')).toBeHidden();
  await expect(page.locator('[data-testid="preview-drop-count"]')).toContainText('0/135 drops');

  const transport = page.locator('.pv-transport');

  // Hitting play swaps the button to its pause form.
  await transport.locator('button[data-action="play"]').click();
  const pauseBtn = transport.locator('button[data-action="pause"]');
  await expect(pauseBtn).toBeVisible();
  await expect(pauseBtn).toHaveText('❚❚');

  // Pause and confirm the scrub slider holds a step >= 0.
  await pauseBtn.click();
  await expect(transport.locator('button[data-action="play"]')).toBeVisible();

  // Scrub back to step 0; the readout returns to 0/135.
  const scrub = transport.locator('input[data-action="scrub"]');
  await scrub.fill('0');
  await expect(page.locator('[data-testid="preview-drop-count"]')).toContainText('0/135 drops');

  // Returning to edit hides the transport.
  await enterEdit(page);
  await expect(transport).toBeHidden();
});

test('Adjust playback speed and zoom in preview', async ({ page }) => {
  await gotoApp(page);
  await enterPreview(page);

  const transport = page.locator('.pv-transport');

  // Speed slider routes through the playback controller; the readout follows.
  const speed = transport.locator('input[data-action="speed"]');
  await speed.fill('20');
  await expect(transport.locator('.pv-tx-speed-val')).toHaveText('20/s');

  // Transport zoom buttons share the camera with wheel zoom; just confirm
  // clicks land on stable buttons (no DOM assertion on the canvas itself —
  // it's a <canvas>, not a queryable DOM tree).
  const zoomIn = transport.locator('button[data-zoom="in"]');
  await zoomIn.click();
  await zoomIn.click();
  await transport.locator('button[data-zoom="reset"]').click();

  // Playback can be started again after the zoom interactions.
  await transport.locator('button[data-action="play"]').click();
  await expect(transport.locator('button[data-action="pause"]')).toBeVisible();
});

test('Tune Preview Settings (needle, thread, colours, toggles)', async ({ page }) => {
  await gotoApp(page);
  await enterPreview(page);

  const previewSection = page.locator('.sb-preview-settings');
  await expect(previewSection).toBeVisible();

  // Needle: 80 -> 100. The select fires `change`; the canvas re-renders
  // off-DOM so we only assert the control reflects the new value.
  const needle = previewSection.locator('select[data-action="needle"]');
  await needle.selectOption('100');
  await expect(needle).toHaveValue('100');

  // Thread weight: pick the 20wt option (0.40 mm in THREAD_OPTIONS).
  // Options are keyed by mm diameter so we select by value, then verify
  // the visible label resolved to the 20wt entry.
  const thread = previewSection.locator('select[data-action="thread"]');
  await thread.selectOption('0.4');
  await expect(thread.locator('option:checked')).toContainText('20wt');

  // Colours: live `input` event drives the canvas; we only assert the
  // form value advanced (programmatic colour entry is well-supported).
  const threadColor = previewSection.locator('input[data-action="thread-color"]');
  await threadColor.fill('#aa0000');
  await expect(threadColor).toHaveValue('#aa0000');

  const bgColor = previewSection.locator('input[data-action="bg-color"]');
  await bgColor.fill('#ffffff');
  await expect(bgColor).toHaveValue('#ffffff');

  // Toggle history / foot — aria-pressed flips on each click.
  const historyBtn = previewSection.locator('button[data-action="toggle-history"]');
  const initialHistory = await historyBtn.getAttribute('aria-pressed');
  await historyBtn.click();
  await expect(
    page.locator('.sb-preview-settings button[data-action="toggle-history"]'),
  ).not.toHaveAttribute('aria-pressed', initialHistory ?? '');

  const footBtn = page.locator('.sb-preview-settings button[data-action="toggle-foot"]');
  const initialFoot = await footBtn.getAttribute('aria-pressed');
  await footBtn.click();
  await expect(
    page.locator('.sb-preview-settings button[data-action="toggle-foot"]'),
  ).not.toHaveAttribute('aria-pressed', initialFoot ?? '');
});
