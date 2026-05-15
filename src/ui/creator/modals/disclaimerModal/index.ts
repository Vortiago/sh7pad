// First-visit disclaimer. Auto-shows once on a fresh browser, then sits
// behind the sidebar's "About this project" link.
//
// Built on the shared DialogBase (native <dialog> + .showModal()) so
// focus trap, Esc, and backdrop-click are handled in one place.
//
// Markup lives in disclaimerModal.html.

import './disclaimerModal.css';
import { tplFrom, slot, action } from '../../dom.js';
import { createDialogBase } from '../DialogBase.js';
import templateHtml from './disclaimerModal.html?raw';

export const DISCLAIMER_STORAGE_KEY = 'sh7_disclaimer_seen_v1';

const TITLE = 'About sh7pad';
const PARAGRAPHS: readonly string[] = [
  'sh7pad is a browser-based viewer, creator, and editor for .sh7 decorative-stitch files. Everything runs locally in your browser; no upload, no server.',
  'The .sh7 format here is reverse-engineered from sample files and trial-and-error on my own sewing machine. Files exported from here have not been validated by anyone. They might be wrong, they might confuse your machine, they might stitch something that looks nothing like what you drew. Treat every export as experimental.',
  'Use at your own risk. Test on a small piece of fabric first. Keep backups of anything you care about.',
];
const GITHUB_URL = 'https://github.com/Vortiago/sh7pad';

const templates = tplFrom(templateHtml);
const cardTpl = templates.content.querySelector<HTMLTemplateElement>('#disclaimer-card')!;
const paragraphTpl = templates.content.querySelector<HTMLTemplateElement>('#disclaimer-paragraph')!;

let activeClose: (() => void) | null = null;

export function hasSeenDisclaimer(storage: Storage): boolean {
  try {
    return storage.getItem(DISCLAIMER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markDisclaimerSeen(storage: Storage): void {
  try {
    storage.setItem(DISCLAIMER_STORAGE_KEY, '1');
  } catch {
    // localStorage can throw in private mode or when full. The disclaimer
    // is not load-bearing, so silently fall back to "show every time".
  }
}

export function showDisclaimer(storage?: Storage): void {
  // Single-instance is enforced by createDialogBase via componentTag.
  const base = createDialogBase({
    className: 'info-backdrop',
    componentTag: 'disclaimer',
    ariaLabelledBy: 'info-title',
    onCancel: () => {
      if (storage) markDisclaimerSeen(storage);
    },
  });
  activeClose = base.close;

  const card = cardTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  slot(card, 'title').textContent = TITLE;
  const body = slot(card, 'body');
  for (const text of PARAGRAPHS) {
    const p = paragraphTpl.content.firstElementChild!.cloneNode(true) as HTMLParagraphElement;
    p.textContent = text;
    body.appendChild(p);
  }
  const linkPara = paragraphTpl.content.firstElementChild!.cloneNode(true) as HTMLParagraphElement;
  linkPara.append('Source code: ');
  const a = document.createElement('a');
  a.href = GITHUB_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = GITHUB_URL.replace(/^https:\/\//, '');
  linkPara.appendChild(a);
  body.appendChild(linkPara);

  const okBtn = action<HTMLButtonElement>(card, 'disclaimer-dismiss');
  okBtn.addEventListener('click', () => {
    if (storage) markDisclaimerSeen(storage);
    base.close();
    activeClose = null;
  });

  base.dialog.appendChild(card);
  base.open();
  okBtn.focus();
}

export function hideDisclaimer(): void {
  if (activeClose) {
    activeClose();
    activeClose = null;
  }
  // Belt-and-suspenders: any orphaned dialogs (from a prior render
  // without the activeClose handle) still get cleaned up.
  document.querySelectorAll('.info-backdrop').forEach((el) => el.remove());
}
