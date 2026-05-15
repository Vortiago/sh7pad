// Full glossary modal, reached from the sidebar's "Glossary" link.
//
// Built on the shared DialogBase (native <dialog> + .showModal()) so
// focus trap, Esc, backdrop-click, and single-instance are handled in
// one place. Reuses the same .info-backdrop / .info-card chrome as the
// disclaimer modal — only the body content differs.
//
// Markup lives in glossaryModal.html.

import './help.css';
import { tplFrom, slot, action } from '../dom.js';
import { createDialogBase } from '../modals/DialogBase.js';
import templateHtml from './glossaryModal.html?raw';
import {
  CATEGORY_ORDER,
  entriesByCategory,
  type GlossaryCategory,
} from './glossaryEntries.js';

const SECTION_LABELS: Readonly<Record<GlossaryCategory, string>> = {
  concept: 'Concepts',
  design: 'Design constructs',
  stitch: 'Stitches',
  density: 'Density',
};

const templates = tplFrom(templateHtml);
const cardTpl = templates.content.querySelector<HTMLTemplateElement>('#glossary-card')!;
const sectionTpl = templates.content.querySelector<HTMLTemplateElement>('#glossary-section')!;
const entryTpl = templates.content.querySelector<HTMLTemplateElement>('#glossary-entry')!;

let activeClose: (() => void) | null = null;

export function showGlossary(): void {
  // Single-instance is enforced by createDialogBase via componentTag.
  const base = createDialogBase({
    className: 'info-backdrop',
    componentTag: 'glossary',
    ariaLabelledBy: 'glossary-title',
  });
  activeClose = base.close;

  const card = cardTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const body = slot(card, 'body');

  const grouped = entriesByCategory();
  for (const cat of CATEGORY_ORDER) {
    const entries = grouped[cat];
    if (entries.length === 0) continue;

    const section = sectionTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
    section.dataset['category'] = cat;
    slot(section, 'heading').textContent = SECTION_LABELS[cat];

    for (const entry of entries) {
      const row = entryTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.dataset['entryId'] = entry.id;
      slot(row, 'term').textContent = entry.term;
      slot(row, 'body').textContent = entry.short;
      section.appendChild(row);
    }

    body.appendChild(section);
  }

  const okBtn = action<HTMLButtonElement>(card, 'glossary-close');
  okBtn.addEventListener('click', () => {
    base.close();
    activeClose = null;
  });

  base.dialog.appendChild(card);
  base.open();
  okBtn.focus();
}

export function hideGlossary(): void {
  if (activeClose) {
    activeClose();
    activeClose = null;
  }
  // Belt-and-suspenders: any orphaned dialogs (from a prior render
  // without the activeClose handle) still get cleaned up.
  document
    .querySelectorAll('dialog[data-component="glossary"]')
    .forEach((el) => el.remove());
}
