// Overflow menu builder for the phone app bar. Builds the items list
// — stats string (when a projectStore is supplied), rulers toggle,
// "About this project" — and opens a contextMenu anchored under the
// supplied trigger element.
//
// Pulled out of appBar/index.ts so the orchestrator stays focused on
// mode segmented-control wiring.

import { showContextMenu, type ContextMenuItem } from '../contextMenu/index.js';
import type { ProjectStore } from '../../../creator/projectStore.js';
import type { UiStore } from '../store/uiStore.js';

// At phone width rulers are hidden by default (Q15); uiStore.rulersShown
// opts back in. attachLayoutAttrs owns the html.ed-rulers-shown class
// write — this module just flips the store field.

export interface OverflowMenuDeps {
  /** Element the menu anchors to (its bottom-right corner). */
  trigger: HTMLElement;
  /** uiStore — read uiStore.rulersShown for the label, write the flag
   *  on toggle so attachLayoutAttrs flips the html class. */
  uiStore: UiStore;
  /** Optional — surfaces the desktop toolbar's stats string in the menu. */
  projectStore?: ProjectStore;
  /** Called when "About this project" is chosen. */
  onShowDisclaimer(): void;
}

export function openOverflowMenu(deps: OverflowMenuDeps): void {
  const rect = deps.trigger.getBoundingClientRect();
  const items: ContextMenuItem[] = [];
  if (deps.projectStore) {
    const project = deps.projectStore.getState();
    // Read-only stats row — non-focusable so screen readers don't
    // announce a fake button.
    items.push({
      kind: 'text',
      label: `${project.points.length} pts · ${project.segments.length} seg · ±${project.hoop.halfW}×${project.hoop.h} mm`,
      action: 'stats',
    });
  }
  const visible = deps.uiStore.getState().rulersShown;
  items.push({
    label: visible ? 'Hide rulers' : 'Show rulers',
    action: 'toggle-rulers',
    onClick: () => {
      deps.uiStore.update({ rulersShown: !deps.uiStore.getState().rulersShown });
    },
  });
  items.push({
    label: 'About this project',
    action: 'show-disclaimer',
    onClick: () => deps.onShowDisclaimer(),
  });
  showContextMenu({
    anchorX: rect.right,
    anchorY: rect.bottom,
    label: 'More options',
    items,
  });
}
