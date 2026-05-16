import { test, expect } from '@playwright/test';
import { activeProjectRow, gotoApp, projectRows } from './helpers';

// Project lifecycle: create (design + manual), rename, delete.

test('Create a new design project from the sidebar', async ({ page }) => {
  await gotoApp(page);

  const rows = projectRows(page);
  const before = await rows.count();

  await page.locator('#sidebar button[data-action="new"]').click();

  const dialog = page.locator('[data-component="new-project"]');
  await expect(dialog).toBeVisible();

  const nameInput = page.locator('input[data-testid="new-project-name"]');
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveAttribute('placeholder', /Stitch /);

  // Defaults: design mode + Foot S.
  await expect(dialog.locator('label[data-option="design"] input[type="radio"]')).toBeChecked();
  await expect(dialog.locator('label[data-option="S"] input[type="radio"]')).toBeChecked();

  await page.locator('button[data-action="np-create"]').click();
  await expect(dialog).toHaveCount(0);

  await expect(rows).toHaveCount(before + 1);
  await expect(activeProjectRow(page)).toHaveCount(1);

  // Fresh design project has only the start anchor (1 pt, 0 seg).
  await expect(page.locator('[data-testid="toolbar-stats"]')).toContainText('0 seg');
});

test('Create a manual-mode project on Foot B', async ({ page }) => {
  await gotoApp(page);

  await page.locator('#sidebar button[data-action="new"]').click();
  const dialog = page.locator('[data-component="new-project"]');
  await expect(dialog).toBeVisible();

  await page.locator('input[data-testid="new-project-name"]').fill('Manual demo');
  await dialog.locator('label[data-option="manual"]').click();
  await dialog.locator('label[data-option="B"]').click();

  // Confirm the radios followed the label clicks.
  await expect(dialog.locator('label[data-option="manual"] input[type="radio"]')).toBeChecked();
  await expect(dialog.locator('label[data-option="B"] input[type="radio"]')).toBeChecked();

  await page.locator('button[data-action="np-create"]').click();
  await expect(dialog).toHaveCount(0);

  // The active project row exposes the typed name through its input control.
  await expect(activeProjectRow(page).locator('input[data-control="project-name"]')).toHaveValue('Manual demo');

  // Sidebar Stitch Settings reflects Mode=Manual and Suggested Foot=Foot B.
  const stitchSection = page.locator('.sb-stitch');
  await expect(stitchSection).toContainText('Manual');
  await expect(stitchSection).toContainText(/Foot B/);

  // Toolbar STITCH group now offers Needle/Satin/Jump and hides Move.
  const toolbar = page.locator('.ed-toolbar');
  await expect(toolbar.locator('button[data-stitch="needle"]')).toBeVisible();
  await expect(toolbar.locator('button[data-stitch="satin"]')).toBeVisible();
  await expect(toolbar.locator('button[data-stitch="jump"]')).toBeVisible();
  await expect(toolbar.locator('button[data-tool="move"]')).toHaveCount(0);

  // Stitch-list panel renders the manual empty-state placeholder.
  await expect(page.locator('[data-testid="stitch-list-empty"]')).toBeVisible();
});

test('Rename, then delete the active project', async ({ page }) => {
  await gotoApp(page);

  // Seed a second project so the test has something to fall back to
  // after deleting the renamed one (and to keep a stable starting count).
  await page.locator('#sidebar button[data-action="new"]').click();
  await expect(page.locator('[data-component="new-project"]')).toBeVisible();
  await page.locator('button[data-action="np-create"]').click();
  await expect(page.locator('[data-component="new-project"]')).toHaveCount(0);

  const startCount = await projectRows(page).count();
  expect(startCount).toBeGreaterThanOrEqual(2);

  // Rename the active row via the inline input.
  const activeId = await activeProjectRow(page).getAttribute('data-project-id');
  const nameInput = activeProjectRow(page).locator('input[data-control="project-name"]');
  await nameInput.click();
  await nameInput.fill('Renamed');
  await nameInput.press('Enter');

  await expect(activeProjectRow(page).locator('input[data-control="project-name"]')).toHaveValue('Renamed');

  // Persistence: reload should preserve the new name on the same project.
  // Active rows surface the name through an <input>'s value; inactive rows
  // through a text div. Cover both shapes so the test doesn't depend on
  // which project the store picks as active after reload.
  await page.reload();
  const renamedRow = page.locator(`#sidebar [data-project-id="${activeId}"]`);
  await expect(renamedRow).toBeVisible();
  const renamedInput = renamedRow.locator('input[data-control="project-name"]');
  if (await renamedInput.count()) {
    await expect(renamedInput).toHaveValue('Renamed');
  } else {
    await expect(renamedRow.locator('.sb-item-name')).toHaveText('Renamed');
    // Click to make it active so the delete button surfaces.
    await renamedRow.click();
  }
  await expect(activeProjectRow(page)).toHaveAttribute('data-project-id', activeId!);

  // Delete the renamed project; sidebar/callbacks.ts gates the action
  // behind a native confirm(), so auto-accept it. Another row becomes active.
  page.once('dialog', (dialog) => dialog.accept());
  await activeProjectRow(page).locator('button[data-action="delete"]').click();
  await expect(projectRows(page)).toHaveCount(startCount - 1);
  await expect(page.locator(`#sidebar [data-project-id="${activeId}"]`)).toHaveCount(0);
  await expect(activeProjectRow(page)).toHaveCount(1);
});
