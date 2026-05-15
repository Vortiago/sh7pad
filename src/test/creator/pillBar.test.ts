// pillBar — phone-only bottom toggle pair for the Projects + Stitches
// sheets. Mirrors aria-expanded from each sheet via onStateChange,
// flips data-active for visual styling.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPillBar } from '../../ui/creator/pillBar/index.js';
import { createBottomSheet } from '../../ui/creator/bottomSheet/index.js';

let host: HTMLElement;
let projectsSheet: ReturnType<typeof createBottomSheet>;
let stitchesSheet: ReturnType<typeof createBottomSheet>;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);

  const projectsContent = document.createElement('div');
  projectsSheet = createBottomSheet(host, {
    contentEl: projectsContent,
    label: 'Projects',
    defaultOpen: 'half',
  });
  projectsSheet.el.id = 'sheet-projects';

  const stitchesContent = document.createElement('div');
  stitchesSheet = createBottomSheet(host, {
    contentEl: stitchesContent,
    label: 'Stitches',
    defaultOpen: 'full',
  });
  stitchesSheet.el.id = 'sheet-stitches';
});

describe('createPillBar', () => {
  it('renders two pills with aria-controls pointing at each sheet', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const projectsPill = host.querySelector<HTMLButtonElement>('#pb-projects')!;
    const stitchesPill = host.querySelector<HTMLButtonElement>('#pb-stitches')!;
    expect(projectsPill).not.toBeNull();
    expect(stitchesPill).not.toBeNull();
    expect(projectsPill.getAttribute('aria-controls')).toBe('sheet-projects');
    expect(stitchesPill.getAttribute('aria-controls')).toBe('sheet-stitches');
  });

  it('starts both pills with aria-expanded=false (sheets closed by default)', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const pills = host.querySelectorAll<HTMLButtonElement>('.pb-pill');
    expect(pills.length).toBe(2);
    pills.forEach((p) => expect(p.getAttribute('aria-expanded')).toBe('false'));
  });

  it('clicking the Projects pill opens the projects sheet to half (its default)', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const pill = host.querySelector<HTMLButtonElement>('#pb-projects')!;
    pill.click();
    expect(projectsSheet.getState()).toBe('half');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(pill.dataset['active']).toBe('true');
  });

  it('clicking the Stitches pill opens its sheet to full (its default)', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const pill = host.querySelector<HTMLButtonElement>('#pb-stitches')!;
    pill.click();
    expect(stitchesSheet.getState()).toBe('full');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the same pill again closes the sheet', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const pill = host.querySelector<HTMLButtonElement>('#pb-projects')!;
    pill.click();
    expect(projectsSheet.getState()).toBe('half');
    pill.click();
    expect(projectsSheet.getState()).toBe('closed');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-expanded mirrors external sheet state changes', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const pill = host.querySelector<HTMLButtonElement>('#pb-projects')!;
    projectsSheet.setState('full');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    projectsSheet.setState('closed');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
  });

  it('destroy removes the pill bar and detaches state listeners', () => {
    const pillBar = createPillBar(host, { projectsSheet, stitchesSheet });
    pillBar.destroy();
    expect(host.querySelector('.pb-root')).toBeNull();
    // Subsequent state changes don't throw.
    expect(() => projectsSheet.setState('half')).not.toThrow();
  });

  it('aria-label on the bar names it as a navigation landmark', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const nav = host.querySelector<HTMLElement>('.pb-root')!;
    expect(nav.tagName.toLowerCase()).toBe('nav');
    expect(nav.getAttribute('aria-label')).toBe('Sheet navigation');
  });

  it('opening one sheet closes the other (mutual exclusion)', () => {
    createPillBar(host, { projectsSheet, stitchesSheet });
    const projectsPill = host.querySelector<HTMLButtonElement>('#pb-projects')!;
    const stitchesPill = host.querySelector<HTMLButtonElement>('#pb-stitches')!;

    projectsPill.click();
    expect(projectsSheet.getState()).toBe('half');
    expect(stitchesSheet.getState()).toBe('closed');

    stitchesPill.click();
    // Stitches opens to full; Projects auto-closes so the user always
    // sees a single foreground sheet.
    expect(stitchesSheet.getState()).toBe('full');
    expect(projectsSheet.getState()).toBe('closed');
  });
});

// Silence unused vi import in case of further extension.
void vi;
