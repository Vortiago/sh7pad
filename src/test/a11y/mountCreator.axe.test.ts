// axe-core gate: mounts the full creator UI in jsdom and runs axe.run().
// Fails the build on any violation. This drives the WCAG 2.1 AA work in
// commit 1 (focus styles, label/input pairing, modal focus traps, skip link)
// red-then-green: any new accessibility regression shows up here first.
//
// We disable rules that jsdom can't evaluate truthfully (color-contrast
// needs computed styles; landmark-* and region rules need a viewport).
// Lighthouse-CI (commit 5) covers those in a real headless browser.

import { describe, expect, it, afterEach } from 'vitest';
import axe from 'axe-core';
import { IDBFactory } from 'fake-indexeddb';
import { mountCreator } from '../../ui/creator/mountCreator.js';
import {
  openProjectRepository,
  type ProjectRepository,
} from '../../creator/projectRepository.js';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

let openRepos: ProjectRepository[] = [];
let dbCounter = 0;
afterEach(() => {
  for (const r of openRepos) r.close();
  openRepos = [];
});

async function makeRepo(): Promise<ProjectRepository> {
  const factory = new IDBFactory();
  const repo = await openProjectRepository({
    factory,
    dbName: `sh7_creator_axe_${++dbCounter}`,
  });
  openRepos.push(repo);
  return repo;
}

function buildCreatorDom(): void {
  // Mirror index.html document-level attributes so axe sees what production
  // serves: lang on <html>, <title>, viewport meta. The body markup matches
  // the real index.html structure 1:1.
  document.documentElement.setAttribute('lang', 'en');
  if (!document.querySelector('title')) {
    const title = document.createElement('title');
    title.textContent = 'sh7pad';
    document.head.appendChild(title);
  }
  document.body.innerHTML = `
    <div id="app" class="app-root">
      <aside id="sidebar" class="sb-root"></aside>
      <main class="main main-single">
        <div class="ms-bar">
          <div id="mode-switch" class="ms-wrap"></div>
        </div>
        <div id="pane-edit" class="pane pane-full">
          <div id="ed-toolbar" class="ed-toolbar"></div>
          <div id="ed-canvas-wrap" class="ed-canvas-wrap">
            <svg id="ed-canvas" class="ed-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
            <div id="ruler-top" class="ed-ruler ed-ruler-top"></div>
            <div id="ruler-left" class="ed-ruler ed-ruler-left"></div>
          </div>
          <div id="ed-inspector" class="ed-inspector"></div>
        </div>
        <div id="pane-preview" class="pane pane-full" hidden>
          <div id="pv-header" class="pv-header"></div>
          <div id="pv-canvas-wrap" class="pv-canvas-wrap">
            <svg id="pv-canvas" class="pv-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
          <div id="pv-transport" class="pv-transport"></div>
        </div>
      </main>
      <aside id="stitch-list-panel" class="sl-root">
        <div id="stitch-list-header" class="sl-header"></div>
        <ol id="stitch-list" class="sl-list" aria-label="Drop list"></ol>
      </aside>
    </div>
  `;
  document.body.dataset['mode'] = 'edit';
}

// Rules disabled in jsdom: see header comment.
const DISABLED_IN_JSDOM = [
  'color-contrast',
  'region',
  'landmark-one-main',
  'page-has-heading-one',
];

describe('axe-core: mountCreator has no WCAG 2.1 AA violations', () => {
  it('edit mode mounts cleanly', async () => {
    buildCreatorDom();
    const repo = await makeRepo();
    await mountCreator(document, repo, new FakeStorage());

    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: Object.fromEntries(
        DISABLED_IN_JSDOM.map((id) => [id, { enabled: false }]),
      ),
    });

    if (results.violations.length > 0) {
      const summary = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => n.html.slice(0, 200)),
      }));
      // eslint-disable-next-line no-console
      console.error('axe violations:', JSON.stringify(summary, null, 2));
    }
    expect(results.violations).toEqual([]);
  });
});
