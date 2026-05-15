import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/sh7pad/',
  server: process.env['PORT']
    ? { port: Number(process.env['PORT']), strictPort: true }
    : undefined,
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    // Vitest owns the unit/integration tier under src/test; Playwright owns
    // tests/e2e (driven by playwright.config.ts). Exclude the e2e tree so
    // `npm test` doesn't try to load `@playwright/test` in a Node context.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
    environmentMatchGlobs: [
      ['src/test/creator/editorRender.test.ts', 'jsdom'],
      ['src/test/creator/preview.test.ts', 'jsdom'],
      ['src/test/creator/stitchListPanel.test.ts', 'jsdom'],
      ['src/test/creator/rulers.test.ts', 'jsdom'],
      ['src/test/creator/rulerAlignment.test.ts', 'jsdom'],
      ['src/test/creator/sidebar.test.ts', 'jsdom'],
      ['src/test/creator/sidebarAutoSubscribe.test.ts', 'jsdom'],
      ['src/test/creator/bgImage.test.ts', 'jsdom'],
      ['src/test/creator/editorInteract.test.ts', 'jsdom'],
      ['src/test/creator/panInteract.test.ts', 'jsdom'],
      ['src/test/creator/previewTransport.test.ts', 'jsdom'],
      ['src/test/creator/segmentInspector.test.ts', 'jsdom'],
      ['src/test/creator/toolbar.test.ts', 'jsdom'],
      ['src/test/creator/modeSwitch.test.ts', 'jsdom'],
      ['src/test/creator/toast.test.ts', 'jsdom'],
      ['src/test/creator/main.test.ts', 'jsdom'],
      ['src/test/creator/disclaimerModal.test.ts', 'jsdom'],
      ['src/test/creator/preview.snapshot.test.ts', 'jsdom'],
      ['src/test/creator/editor.snapshot.test.ts', 'jsdom'],
      ['src/test/creator/newProjectDialog.test.ts', 'jsdom'],
      ['src/test/creator/exportDialog.test.ts', 'jsdom'],
      ['src/test/creator/bottomSheet.test.ts', 'jsdom'],
      ['src/test/creator/responsive.test.ts', 'jsdom'],
      ['src/test/creator/pillBar.test.ts', 'jsdom'],
      ['src/test/creator/canvasGesture.test.ts', 'jsdom'],
      ['src/test/creator/editor.keyboard.test.ts', 'jsdom'],
      ['src/test/creator/appBar.test.ts', 'jsdom'],
      ['src/test/creator/attachLayoutAttrs.test.ts', 'jsdom'],
      ['src/test/creator/inspectorPeek.test.ts', 'jsdom'],
      ['src/test/creator/tapRipple.test.ts', 'jsdom'],
      ['src/test/creator/paneSelfBootstrap.test.ts', 'jsdom'],
      ['src/test/creator/paneProjectStoreSubscribe.test.ts', 'jsdom'],
      ['src/test/creator/help/**/*.test.ts', 'jsdom'],
      ['src/test/a11y/**', 'jsdom'],
    ],
  },
  assetsInclude: ['**/*.sh7'],
});
