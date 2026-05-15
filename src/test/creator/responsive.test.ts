// responsive controller — mounts/unmounts phone-only chrome based on
// matchMedia('(max-width: 639px)'). The mount path re-parents the
// existing sidebar and stitch-list panels into bottom sheets and adds
// a pill bar. Unmount restores the original DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachResponsiveController } from '../../ui/creator/responsive/index.js';
import { createUiStore, defaultUiState } from '../../ui/creator/store/uiStore.js';
import { attachLayoutAttrs } from '../../ui/creator/store/attachLayoutAttrs.js';

function makeUiStoreForLayout(): ReturnType<typeof createUiStore> {
  return createUiStore(defaultUiState());
}

interface MockMQ {
  matches: boolean;
  listeners: Array<(ev: MediaQueryListEvent) => void>;
  addEventListener: (
    _type: 'change',
    cb: (ev: MediaQueryListEvent) => void,
  ) => void;
  removeEventListener: (
    _type: 'change',
    cb: (ev: MediaQueryListEvent) => void,
  ) => void;
}

function makeMQ(initial: boolean): MockMQ {
  const mq: MockMQ = {
    matches: initial,
    listeners: [],
    addEventListener(_type, cb) { mq.listeners.push(cb); },
    removeEventListener(_type, cb) {
      mq.listeners = mq.listeners.filter((x) => x !== cb);
    },
  };
  return mq;
}

let originalMM: typeof window.matchMedia;
let mockMQ: MockMQ;

beforeEach(() => {
  document.body.innerHTML = `
    <div class="app-root">
      <aside id="sidebar"><p>sidebar contents</p></aside>
      <main><div id="canvas">canvas</div></main>
      <aside id="stitch-list-panel"><p>stitch list</p></aside>
    </div>
  `;
  originalMM = window.matchMedia;
  mockMQ = makeMQ(false);
  window.matchMedia = vi.fn(() => mockMQ as unknown as MediaQueryList);
});

afterEach(() => {
  window.matchMedia = originalMM;
});

describe('attachResponsiveController', () => {
  it('on desktop, leaves sidebars in place and adds no pill bar', () => {
    mockMQ.matches = false;
    const sidebar = document.getElementById('sidebar')!;
    const stitchList = document.getElementById('stitch-list-panel')!;
    const originalSidebarParent = sidebar.parentElement;

    attachResponsiveController({
      sidebarHost: sidebar,
      stitchListHost: stitchList,
      chromeHost: document.body,
    });

    expect(sidebar.parentElement).toBe(originalSidebarParent);
    expect(document.querySelector('.pb-root')).toBeNull();
    expect(document.querySelector('.bs-root')).toBeNull();
  });

  it('on phone, re-hosts sidebars into sheets and mounts a pill bar', () => {
    mockMQ.matches = true;
    const sidebar = document.getElementById('sidebar')!;
    const stitchList = document.getElementById('stitch-list-panel')!;

    attachResponsiveController({
      sidebarHost: sidebar,
      stitchListHost: stitchList,
      chromeHost: document.body,
    });

    expect(document.querySelectorAll('.bs-root').length).toBe(2);
    expect(document.querySelector('.pb-root')).not.toBeNull();
    // Sidebar contents are now inside a sheet body.
    expect(sidebar.closest('.bs-body')).not.toBeNull();
    expect(stitchList.closest('.bs-body')).not.toBeNull();
  });

  it('on phone→desktop transition, restores the original DOM', () => {
    mockMQ.matches = true;
    const sidebar = document.getElementById('sidebar')!;
    const stitchList = document.getElementById('stitch-list-panel')!;
    const appRoot = document.querySelector('.app-root') as HTMLElement;

    attachResponsiveController({
      sidebarHost: sidebar,
      stitchListHost: stitchList,
      chromeHost: document.body,
    });
    expect(sidebar.closest('.bs-body')).not.toBeNull();

    // Flip to desktop.
    mockMQ.matches = false;
    for (const cb of [...mockMQ.listeners]) {
      cb({ matches: false } as MediaQueryListEvent);
    }

    expect(sidebar.parentElement).toBe(appRoot);
    expect(stitchList.parentElement).toBe(appRoot);
    expect(document.querySelector('.pb-root')).toBeNull();
    expect(document.querySelector('.bs-root')).toBeNull();
  });

  it('Esc closes any open sheet on phone', () => {
    mockMQ.matches = true;
    const sidebar = document.getElementById('sidebar')!;
    const stitchList = document.getElementById('stitch-list-panel')!;

    attachResponsiveController({
      sidebarHost: sidebar,
      stitchListHost: stitchList,
      chromeHost: document.body,
    });

    // Tap the projects pill to open the sheet to half.
    const projectsPill = document.querySelector<HTMLButtonElement>('#pb-projects')!;
    projectsPill.click();
    const projectsSheet = document.getElementById('sheet-projects')!;
    expect(projectsSheet.dataset['sheetState']).toBe('half');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(projectsSheet.dataset['sheetState']).toBe('closed');
  });

  it('on tablet, only the stitch list becomes a bottom sheet (left sidebar stays docked)', () => {
    // Phone-OFF, tablet-ON.
    mockMQ.matches = false;
    const tabletMQ = makeMQ(true);
    window.matchMedia = vi.fn((query: string) => {
      const cleanQuery = query.replace(/\s+/g, ' ').trim();
      if (cleanQuery.includes('max-width: 639px')) return mockMQ as unknown as MediaQueryList;
      return tabletMQ as unknown as MediaQueryList;
    });

    const sidebar = document.getElementById('sidebar')!;
    const stitchList = document.getElementById('stitch-list-panel')!;
    const appRoot = document.querySelector('.app-root') as HTMLElement;

    // body.dataset.rightAsSheet is now derived from uiStore.layout via
    // attachLayoutAttrs. Provide both so the controller's syncFromMatchMedia
    // can push `layout: 'tablet'` and the derivation can flip the attr.
    const uiStore = makeUiStoreForLayout();
    attachLayoutAttrs(uiStore);
    attachResponsiveController({
      sidebarHost: sidebar,
      stitchListHost: stitchList,
      chromeHost: document.body,
      uiStore,
    });

    // Sidebar stayed in place.
    expect(sidebar.parentElement).toBe(appRoot);
    // Stitch list got re-hosted into a sheet body.
    expect(stitchList.closest('.bs-body')).not.toBeNull();
    // A single tablet-pill was added (not the full 2-pill phone bar).
    const pill = document.querySelector<HTMLButtonElement>('#pb-stitches-tablet');
    expect(pill).not.toBeNull();
    // Right column zero-ed via the data-right-as-sheet flag (derived
    // from uiStore.layout === 'tablet' by attachLayoutAttrs). The
    // dock-collapsed flag stays unset because the layout suppression
    // hides it on non-desktop layouts.
    expect(document.body.dataset['rightAsSheet']).toBe('true');
    expect(document.body.dataset['rightCollapsed']).toBeUndefined();
  });

  it('on tablet, tapping the Stitches pill opens the sheet to full', () => {
    mockMQ.matches = false;
    const tabletMQ = makeMQ(true);
    window.matchMedia = vi.fn((query: string) => {
      const cleanQuery = query.replace(/\s+/g, ' ').trim();
      if (cleanQuery.includes('max-width: 639px')) return mockMQ as unknown as MediaQueryList;
      return tabletMQ as unknown as MediaQueryList;
    });
    const sidebar = document.getElementById('sidebar')!;
    const stitchList = document.getElementById('stitch-list-panel')!;
    attachResponsiveController({
      sidebarHost: sidebar,
      stitchListHost: stitchList,
      chromeHost: document.body,
    });
    const sheet = document.getElementById('sheet-stitches')!;
    expect(sheet.dataset['sheetState']).toBe('closed');
    document.querySelector<HTMLButtonElement>('#pb-stitches-tablet')!.click();
    expect(sheet.dataset['sheetState']).toBe('full');
  });
});
