// Export dialog. Shown when the user clicks "Export" in the sidebar so
// they can pick between the binary .sh7 (machine-loadable) and the
// .sh7c.json design file (round-trips losslessly in this editor).
//
// Built on the shared DialogBase. Pure DOM, no framework.
// Single-instance; mounting twice is a no-op.
//
// Markup lives in exportDialog.html.

import '../disclaimerModal/disclaimerModal.css';
import './exportDialog.css';
import { tplFrom, slot, action } from '../../dom.js';
import { createDialogBase } from '../DialogBase.js';
import templateHtml from './exportDialog.html?raw';

export type ExportChoice = 'sh7' | 'sh7c-json';

export interface ExportDialogCallbacks {
  onChoose(choice: ExportChoice): void;
  onCancel?(): void;
}

interface ExportOption {
  id: ExportChoice;
  label: string;
  description: string;
}

const OPTIONS: readonly ExportOption[] = [
  {
    id: 'sh7',
    label: 'For your sewing machine',
    description: 'Loads onto your sewing machine so you can stitch the design. Filename ends with .sh7.',
  },
  {
    id: 'sh7c-json',
    label: 'For editing later',
    description: 'Keeps your project so you can open it again here, or share it with someone else who uses this editor. The machine cannot read this one. Filename ends with .sh7c.json.',
  },
];

const templates = tplFrom(templateHtml);
const cardTpl = templates.content.querySelector<HTMLTemplateElement>('#export-card')!;
const optionTpl = templates.content.querySelector<HTMLTemplateElement>('#export-option')!;

export function showExportDialog(
  callbacks: ExportDialogCallbacks,
  doc: Document = document,
): void {
  // Single-instance is enforced by createDialogBase via componentTag.
  const base = createDialogBase({
    className: 'info-backdrop',
    componentTag: 'export',
    ariaLabelledBy: 'export-title',
    onCancel: () => callbacks.onCancel?.(),
    doc,
  });

  const card = cardTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const body = slot(card, 'body');

  // Each option is a button: a single click both picks and submits.
  // Two clicks (radio + confirm) would be busywork for a binary choice.
  for (const opt of OPTIONS) {
    const btn = optionTpl.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
    btn.dataset['action'] = `export-${opt.id}`;
    slot(btn, 'label').textContent = opt.label;
    slot(btn, 'desc').textContent = opt.description;
    btn.addEventListener('click', () => {
      base.close();
      callbacks.onChoose(opt.id);
    });
    body.appendChild(btn);
  }

  const cancelBtn = action<HTMLButtonElement>(card, 'export-cancel');
  cancelBtn.addEventListener('click', () => {
    base.close();
    callbacks.onCancel?.();
  });

  base.dialog.appendChild(card);
  base.open();
  cancelBtn.focus();
}

/**
 * Force-close the dialog without firing onCancel. Symmetric with
 * disclaimerModal's hideDisclaimer — exists so tests (and any future
 * external caller) can clean up regardless of whether a backdrop is
 * currently in the DOM.
 */
export function hideExportDialog(doc: Document = document): void {
  doc.querySelectorAll('.info-backdrop[data-component="export"]').forEach((el) => el.remove());
}
