// Bottom pill bar that toggles bottom sheets — Q6 decision.
//
// Two layouts, same component:
//   - Phone: two 50%-width buttons toggling the Projects and Stitches
//     sheets. Sits in the flex-column body flow above the editor.
//   - Tablet: a single right-anchored Stitches button (the left sidebar
//     stays docked at tablet width, so no Projects pill is needed).
//     CSS fixes it to the viewport bottom via `data-variant='tablet'`.
//
// Callers pass whichever sheets they want; the bar renders one pill per
// provided sheet. Each pill mirrors aria-expanded from its sheet's
// state via the onStateChange callback exposed by bottomSheet.
//
// Mutual-exclusion (opening one sheet closes the other) only kicks in
// when both pills exist — the tablet single-pill case has nothing to
// mutually-exclude against.

import './pillBar.css';
import type { BottomSheet, SheetState } from '../bottomSheet/index.js';
import { tplFrom } from '../dom.js';
import templateHtml from './pillBar.html?raw';

const templates = tplFrom(templateHtml);
const rootTpl = templates.content.querySelector<HTMLTemplateElement>('#pb-root')!;
const pillTpl = templates.content.querySelector<HTMLTemplateElement>('#pb-pill')!;

export interface PillBarOptions {
  /** Projects pill — phone only. Omit for the tablet single-pill bar. */
  projectsSheet?: BottomSheet;
  /** Stitches pill — required (both phone and tablet have it). */
  stitchesSheet: BottomSheet;
  /** Visual variant. 'phone' (default) puts the bar in the flow with
   *  two 50% pills; 'tablet' fixes the bar to the viewport bottom-right
   *  with a single pill. Bound to `data-variant` on the root. */
  variant?: 'phone' | 'tablet';
  /** Override the bar's aria-label. Defaults match the variant:
   *  phone = 'Sheet navigation', tablet = 'Stitch sheet toggle'. */
  ariaLabel?: string;
}

export interface PillBar {
  el: HTMLElement;
  destroy(): void;
}

export function createPillBar(host: HTMLElement, opts: PillBarOptions): PillBar {
  const variant = opts.variant ?? 'phone';
  const root = rootTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  root.dataset['variant'] = variant;
  root.setAttribute(
    'aria-label',
    opts.ariaLabel ?? (variant === 'tablet' ? 'Stitch sheet toggle' : 'Sheet navigation'),
  );

  // Each pill closes the OTHER sheet when opening its own — the two
  // sheets share the same bottom edge, so two-open simultaneously
  // would visually bury the older one with no obvious dismiss path.
  // Single-pill (tablet) callers pass no `otherSheet` so the close-side
  // is a no-op.
  const disposers: Array<() => void> = [];

  if (opts.projectsSheet) {
    const projectsBtn = makePill(
      'pb-projects',
      'Projects',
      opts.projectsSheet,
      'half',
      opts.stitchesSheet,
    );
    root.appendChild(projectsBtn.el);
    disposers.push(projectsBtn.dispose);
  }

  // Tablet variant uses a distinct id so existing selectors that
  // distinguish 'pb-stitches-tablet' vs the phone 'pb-stitches' keep
  // working without renames.
  const stitchesId = variant === 'tablet' ? 'pb-stitches-tablet' : 'pb-stitches';
  const stitchesBtn = makePill(
    stitchesId,
    'Stitches',
    opts.stitchesSheet,
    'full',
    opts.projectsSheet,
  );
  root.appendChild(stitchesBtn.el);
  disposers.push(stitchesBtn.dispose);

  host.appendChild(root);

  return {
    el: root,
    destroy() {
      for (const off of disposers) off();
      root.remove();
    },
  };
}

function makePill(
  id: string,
  label: string,
  sheet: BottomSheet,
  defaultOpen: 'half' | 'full',
  otherSheet: BottomSheet | undefined,
): { el: HTMLButtonElement; dispose: () => void } {
  const btn = pillTpl.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
  btn.id = id;
  btn.dataset['action'] = `toggle-${id}`;
  btn.textContent = label;

  // Sheets are created without an id when called directly from the
  // component test — assign one on first wire so aria-controls works.
  if (!sheet.el.id) sheet.el.id = `${id}-sheet`;
  btn.setAttribute('aria-controls', sheet.el.id);
  btn.setAttribute('aria-expanded', 'false');

  btn.addEventListener('click', () => {
    const isOpen = sheet.getState() !== 'closed';
    if (isOpen) {
      sheet.setState('closed');
    } else {
      if (otherSheet && otherSheet.getState() !== 'closed') otherSheet.setState('closed');
      sheet.setState(defaultOpen);
    }
  });

  const off = sheet.onStateChange((s: SheetState) => {
    btn.setAttribute('aria-expanded', s === 'closed' ? 'false' : 'true');
    btn.dataset['active'] = s === 'closed' ? 'false' : 'true';
  });

  return { el: btn, dispose: off };
}
