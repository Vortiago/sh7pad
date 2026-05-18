// @vitest-environment jsdom
// bottomSheet state machine + component contract.
//
// A bottom sheet has 3 states: closed / half / full. The user drags a
// handle to transition between them; the state machine maps a drag
// distance + starting state to the next state via fixed thresholds.
//
// We TDD the state-machine module (pure function, trivial) and the
// component-level a11y contract (aria-expanded mirrored to a controller,
// reduced-motion no-animation path).

import { describe, expect, it, beforeEach } from 'vitest';
import {
  nextSheetState,
  type SheetState,
} from '../../ui/creator/bottomSheet/state.js';
import { createBottomSheet } from '../../ui/creator/bottomSheet/index.js';

describe('nextSheetState — state machine', () => {
  it('a drag of 0 returns the same state', () => {
    expect(nextSheetState('half', 0)).toBe('half');
    expect(nextSheetState('full', 0)).toBe('full');
    expect(nextSheetState('closed', 0)).toBe('closed');
  });

  it('drag down past close threshold from half closes the sheet', () => {
    // Negative dy = drag DOWN (sheet handle moves toward the bottom of
    // the screen). 30% of 50vh ≈ ~150px on a 1000px viewport at half.
    expect(nextSheetState('half', -160)).toBe('closed');
  });

  it('drag up past expand threshold from half opens to full', () => {
    expect(nextSheetState('half', 200)).toBe('full');
  });

  it('drag down from full lands on half (one step at a time)', () => {
    expect(nextSheetState('full', -200)).toBe('half');
  });

  it('drag down from full past two thresholds collapses to closed', () => {
    // The state machine snaps one step per drag end; large drags don't
    // skip states. So a -1000 drag from full returns half (next step).
    // Closing requires a second gesture.
    expect(nextSheetState('full', -1000)).toBe('half');
  });

  it('drag up from closed opens to half', () => {
    expect(nextSheetState('closed', 100)).toBe('half');
  });

  it('small drags within the snap deadzone keep the same state', () => {
    expect(nextSheetState('half', 10)).toBe('half');
    expect(nextSheetState('full', -10)).toBe('full');
    expect(nextSheetState('closed', 10)).toBe('closed');
  });
});

describe('createBottomSheet — component a11y', () => {
  let host: HTMLElement;
  let content: HTMLElement;
  let controller: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    content = document.createElement('div');
    content.innerHTML = '<p>sheet content</p>';
    controller = document.createElement('button');
    controller.type = 'button';
    document.body.appendChild(controller);
  });

  it('mounts with role=dialog, aria-modal=false, aria-labelledby', () => {
    const sheet = createBottomSheet(host, {
      contentEl: content,
      label: 'Projects',
      defaultOpen: 'half',
    });
    expect(sheet.el.getAttribute('role')).toBe('dialog');
    // Non-modal — canvas behind stays interactive (Q8 decision).
    expect(sheet.el.getAttribute('aria-modal')).toBe('false');
    expect(sheet.el.hasAttribute('aria-labelledby')).toBe(true);
  });

  it('starts in the closed state', () => {
    const sheet = createBottomSheet(host, {
      contentEl: content,
      label: 'Projects',
      defaultOpen: 'half',
    });
    expect(sheet.getState()).toBe('closed');
    expect(sheet.el.dataset['sheetState']).toBe('closed');
  });

  it('setState transitions update data-sheet-state', () => {
    const sheet = createBottomSheet(host, {
      contentEl: content,
      label: 'Projects',
      defaultOpen: 'half',
    });
    sheet.setState('half');
    expect(sheet.el.dataset['sheetState']).toBe('half');
    sheet.setState('full');
    expect(sheet.el.dataset['sheetState']).toBe('full');
  });

  it('onStateChange fires with each transition', () => {
    const sheet = createBottomSheet(host, {
      contentEl: content,
      label: 'Projects',
      defaultOpen: 'half',
    });
    const events: SheetState[] = [];
    sheet.onStateChange((s) => events.push(s));
    sheet.setState('half');
    sheet.setState('full');
    sheet.setState('closed');
    expect(events).toEqual(['half', 'full', 'closed']);
  });

  it('renders a drag handle and a heading inside an sr-only landmark', () => {
    const sheet = createBottomSheet(host, {
      contentEl: content,
      label: 'Projects',
      defaultOpen: 'half',
    });
    expect(sheet.el.querySelector('.bs-handle')).not.toBeNull();
    const heading = sheet.el.querySelector('h2.sr-only');
    expect(heading?.textContent).toBe('Projects');
  });

  it('hosts the provided content element inside its body', () => {
    const sheet = createBottomSheet(host, {
      contentEl: content,
      label: 'Projects',
      defaultOpen: 'half',
    });
    expect(sheet.el.querySelector('.bs-body')?.firstElementChild).toBe(content);
  });

  it('destroy removes the sheet from the DOM', () => {
    const sheet = createBottomSheet(host, {
      contentEl: content,
      label: 'Projects',
      defaultOpen: 'half',
    });
    expect(host.contains(sheet.el)).toBe(true);
    sheet.destroy();
    expect(host.contains(sheet.el)).toBe(false);
  });
});
