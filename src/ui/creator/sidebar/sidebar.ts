// Sidebar orchestrator. Hosts the project list + actions, stitch
// settings, preview settings, and background image controls. Pure
// DOM — no React, no diff.
//
// Each section lives in its own sibling file so this orchestrator
// stays focused on layout + section composition. Action buttons
// carry data-action attributes so the orchestrator (main.ts) and
// tests can target them without depending on text content.
//
// Two-axis structure: the static shell (brand + import/export +
// region containers) is built once via `renderSidebarShell`. Each
// region's content is built by a focused builder (renderProjectsRegion
// etc.) so the index.ts orchestrator can rebuild ONLY the regions
// whose inputs changed — keeping a focused colour-picker attached
// while a sibling region's data mutates. renderSidebar is kept as
// the legacy "rebuild everything" entry point for tests and callers
// that don't care about granular updates.

import './sidebar.css';
import { el, textEl } from '../dom.js';
import type { BgImage, Project } from '../../../creator/types.js';
import type { Mode } from '../modeSwitch/index.js';
import { actionBtn, projectRow } from './projects.js';
import { stitchSettingsControls } from './stitchSettings.js';
import { previewSettingsControls, syncPreviewSettingsControls } from './previewSettings.js';
import { addBgButton, bgControls } from './bgImage.js';

export interface PreviewSettingsState {
  needleSizeNm: number;
  threadDiameterMm: number;
  threadColor: string;
  bgColor: string;
  showHistory: boolean;
  showFoot: boolean;
}

export interface SidebarState {
  projects: Project[];
  currentId: string;
  project: Project;
  /** Optional — when set to 'preview' AND `preview` is provided, the
   *  sidebar renders a Preview Settings section. Hidden in edit mode
   *  where these controls would just be noise. */
  mode?: Mode;
  preview?: PreviewSettingsState;
}

export interface SidebarCallbacks {
  onSelect: (id: string) => void;
  onNew: () => void;
  onImport: (data: ArrayBuffer | string, name: string) => void;
  onExport: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onBgChange: (patch: Partial<BgImage>) => void;
  onBgRemove: () => void;
  onToggleBg: (bg: BgImage) => void;
  onShowDisclaimer: () => void;
  onShowGlossary: () => void;
  onThreadTension: (value: number) => void;
  // Preview-only callbacks. Optional so tests + edit-mode flows that
  // don't surface the section can omit them. The orchestrator wires
  // them whenever the preview pane is mounted.
  onPreviewNeedleChange?: (sizeNm: number) => void;
  onPreviewThreadChange?: (diameterMm: number) => void;
  onPreviewThreadColorChange?: (color: string) => void;
  onPreviewBgColorChange?: (color: string) => void;
  onPreviewToggleHistory?: (show: boolean) => void;
  onPreviewToggleFoot?: (show: boolean) => void;
  onToggleLeftCollapse?: () => void;
}

/** Handles to each sub-region container, returned by renderSidebarShell.
 *  index.ts uses these to rebuild individual regions on store change
 *  without touching the rest of the sidebar (e.g. a focused colour
 *  picker survives an unrelated mutation because its host container
 *  is never replaceChildren'd). */
export interface SidebarRegions {
  projects: HTMLElement;
  stitchSettings: HTMLElement;
  /** Preview-settings wrapper. Always present in the shell; its
   *  contents are rebuilt only when mode === 'preview'. */
  previewSettings: HTMLElement;
  bgImage: HTMLElement;
}

/**
 * Build the static sidebar shell — brand row, action buttons, and an
 * empty container for each sub-region. Returns handles to the region
 * containers so the orchestrator can populate / rebuild each one
 * independently.
 */
export function renderSidebarShell(
  root: HTMLElement,
  cb: SidebarCallbacks,
): SidebarRegions {
  root.replaceChildren();
  root.classList.add('sb-root');

  // 1. Brand + about/glossary links.
  const brand = el('div', 'sb-brand');

  // Collapse / expand toggle. Same button in both states; CSS swaps the
  // chevron based on body[data-left-collapsed]. The expanded label "‹"
  // is shown when the sidebar is open; the rule in sidebar/sidebar.css flips it
  // to "›" when collapsed.
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.dataset['action'] = 'toggle-left-collapse';
  collapseBtn.className = 'sb-collapse-btn';
  collapseBtn.setAttribute('aria-label', 'Collapse sidebar');
  collapseBtn.textContent = '‹';
  collapseBtn.addEventListener('click', () => cb.onToggleLeftCollapse?.());
  brand.appendChild(collapseBtn);

  brand.appendChild(textEl('div', 'sb-brand-title', 'sh7pad'));
  brand.appendChild(textEl('div', 'sb-brand-sub', 'sh7pad · v0.1'));

  const infoLink = document.createElement('button');
  infoLink.type = 'button';
  infoLink.dataset['action'] = 'show-disclaimer';
  infoLink.className = 'sb-info-link';
  infoLink.textContent = 'ⓘ About this project';
  infoLink.addEventListener('click', () => cb.onShowDisclaimer());
  brand.appendChild(infoLink);

  const glossaryLink = document.createElement('button');
  glossaryLink.type = 'button';
  glossaryLink.dataset['action'] = 'show-glossary';
  glossaryLink.className = 'sb-info-link';
  glossaryLink.textContent = '📖 Glossary';
  glossaryLink.addEventListener('click', () => cb.onShowGlossary());
  brand.appendChild(glossaryLink);

  root.appendChild(brand);

  // 2. Action buttons.
  const actions = el('div', 'sb-actions');
  actions.appendChild(actionBtn('+ New Stitch', 'new', () => cb.onNew(), 'sb-btn-primary'));

  const row = el('div', 'sb-act-row');
  const importBtn = actionBtn('↑ Import', 'import', () => importInput.click(), 'sb-btn-ghost');
  const exportBtn = actionBtn('↓ Export', 'export', () => cb.onExport(), 'sb-btn-ghost');
  row.appendChild(importBtn);
  row.appendChild(exportBtn);
  actions.appendChild(row);

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.sh7,.sh7c,.sh7c.json,.json';
  importInput.style.display = 'none';
  importInput.setAttribute('aria-label', 'Import .sh7 or .sh7c file');
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const baseName = file.name.replace(/\.(sh7c\.json|sh7c|sh7|json)$/i, '');
    reader.onload = () => {
      const result = reader.result;
      if (result == null) return;
      cb.onImport(result, baseName);
    };
    if (file.name.toLowerCase().endsWith('.sh7')) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
    importInput.value = '';
  });
  actions.appendChild(importInput);
  root.appendChild(actions);

  // 3. Projects region container. Built/rebuilt by renderProjectsRegion.
  const projects = el('div', 'sb-section');
  root.appendChild(projects);

  // 4. Stitch Settings region.
  const stitchSettings = el('div', 'sb-section sb-stitch');
  root.appendChild(stitchSettings);

  // 5. Preview Settings region. Always present in the shell; the body
  // is rebuilt only when mode === 'preview' (otherwise emptied).
  const previewSettings = el('div', 'sb-section sb-preview-settings');
  root.appendChild(previewSettings);

  // 6. Background image region.
  const bgImage = el('div', 'sb-section sb-bg');
  root.appendChild(bgImage);

  return { projects, stitchSettings, previewSettings, bgImage };
}

export function renderProjectsRegion(
  region: HTMLElement,
  state: Pick<SidebarState, 'projects' | 'currentId'>,
  cb: SidebarCallbacks,
): void {
  region.replaceChildren();
  const secH = el('div', 'sb-section-h');
  secH.appendChild(textEl('span', 'sb-section-label', 'Projects'));
  secH.appendChild(textEl('span', 'sb-section-count', String(state.projects.length)));
  region.appendChild(secH);

  const list = el('div', 'sb-list');
  for (const p of state.projects) {
    list.appendChild(projectRow(p, p.id === state.currentId, cb));
  }
  region.appendChild(list);
}

export function renderStitchSettingsRegion(
  region: HTMLElement,
  state: Pick<SidebarState, 'project'>,
  cb: SidebarCallbacks,
): void {
  region.replaceChildren();
  region.appendChild(textEl('div', 'sb-section-h', 'Stitch Settings'));
  region.appendChild(stitchSettingsControls(state.project, cb));
}

export function renderPreviewSettingsRegion(
  region: HTMLElement,
  state: Pick<SidebarState, 'mode' | 'preview'>,
  cb: SidebarCallbacks,
): void {
  // Hidden in edit mode where these controls would just be noise.
  if (state.mode !== 'preview' || !state.preview) {
    region.replaceChildren();
    delete region.dataset['section'];
    return;
  }
  // If the region was already mounted in preview mode, sync the
  // existing inputs in place rather than replaceChildren'ing them.
  // The colour picker's native dialog stays attached to the same
  // input node across `input` events, and a programmatic value
  // re-write only happens when the latest store value disagrees with
  // the input's current value.
  if (region.dataset['section'] === 'preview-settings'
      && syncPreviewSettingsControls(region, state.preview, cb)) {
    return;
  }
  region.replaceChildren();
  region.dataset['section'] = 'preview-settings';
  region.appendChild(textEl('div', 'sb-section-h', 'Preview Settings'));
  region.appendChild(previewSettingsControls(state.preview, cb));
}

export function renderBgImageRegion(
  region: HTMLElement,
  state: Pick<SidebarState, 'project'>,
  cb: SidebarCallbacks,
): void {
  region.replaceChildren();
  region.appendChild(textEl('div', 'sb-section-h', 'Background Guide'));
  if (state.project.bg) {
    region.appendChild(bgControls(state.project.bg, cb));
  } else {
    region.appendChild(addBgButton(cb));
  }
}

/**
 * Legacy "rebuild the whole sidebar" entry point. Still used by the
 * sidebar.test.ts shape-pin tests and by any caller that doesn't care
 * about granular updates. Internally just composes the shell + four
 * region renderers — the same path attachSidebar uses, only without
 * the focused-region skip.
 */
export function renderSidebar(
  root: HTMLElement,
  state: SidebarState,
  cb: SidebarCallbacks,
): void {
  const regions = renderSidebarShell(root, cb);
  renderProjectsRegion(regions.projects, state, cb);
  renderStitchSettingsRegion(regions.stitchSettings, state, cb);
  renderPreviewSettingsRegion(regions.previewSettings, state, cb);
  renderBgImageRegion(regions.bgImage, state, cb);
}
