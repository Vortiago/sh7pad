// New-project dialog. Shown when the user clicks "New project" in the
// sidebar. Mode and Foot are creation-only (the projectStore enforces
// this on every setState), so picking them up-front is the only path.
//
// Pure DOM, no framework. Identical pattern to disclaimerModal.ts and
// toast.ts: append to <body>, dismiss on backdrop click or Escape.
//
// Markup lives in newProjectDialog.html alongside this file. This module
// owns state, event wiring, and slot-filling only.

import '../disclaimerModal/disclaimerModal.css';
import './newProjectDialog.css';
import templateHtml from './newProjectDialog.html?raw';
import { tplFrom, slot, action } from '../../dom.js';
import { createDialogBase } from '../DialogBase.js';
import type { ProjectMode } from '../../../../creator/types.js';
import type { FootId } from '../../../../creator/foot.js';

export interface NewProjectChoice {
  /** User-typed name. Empty string means "use the placeholder". */
  name: string;
  mode: ProjectMode;
  suggestedFoot: FootId;
}

export interface NewProjectDialogCallbacks {
  onCreate(choice: NewProjectChoice): void;
  onCancel?(): void;
}

export interface NewProjectDialogOptions {
  /**
   * Placeholder shown in the name input. The caller typically passes
   * the auto-generated next name (e.g. "Stitch 4"). When the user
   * leaves the field blank the placeholder is used as the project name.
   */
  namePlaceholder?: string;
}

interface ModeOption {
  id: ProjectMode;
  label: string;
  description: string;
}

interface FootOption {
  id: FootId;
  label: string;
  description: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    id: 'design',
    label: 'Design',
    description: 'Place points and connect them with straight or satin segments.',
  },
  {
    id: 'manual',
    label: 'Manual',
    description: 'Place individual needle and jump stitches by hand.',
  },
];

const FOOT_OPTIONS: readonly FootOption[] = [
  {
    id: 'S',
    label: 'Foot S — Side-motion',
    description: 'Movable carriage spans the full ±27 mm side-motion range. Supports jumps to walk the carriage.',
  },
  {
    id: 'B',
    label: 'Foot B — Decorative',
    description: 'Narrower carriage at ±4.5 mm. Supports jumps within that range — wider designs need Foot S.',
  },
];

// Parsed once at module init. Each call to showNewProjectDialog clones
// the templates rather than re-parsing the HTML string.
const templates = tplFrom(templateHtml);
const cardTpl = templates.content.querySelector<HTMLTemplateElement>('#np-card')!;
const sectionTpl = templates.content.querySelector<HTMLTemplateElement>('#np-section')!;
const optionTpl = templates.content.querySelector<HTMLTemplateElement>('#np-option')!;

export function showNewProjectDialog(
  callbacks: NewProjectDialogCallbacks,
  options: NewProjectDialogOptions = {},
  doc: Document = document,
): void {
  // Single-instance is enforced by createDialogBase via componentTag.
  const namePlaceholder = options.namePlaceholder ?? 'Untitled';
  let chosenMode: ProjectMode = 'design';
  let chosenFoot: FootId = 'S';

  const base = createDialogBase({
    className: 'info-backdrop',
    componentTag: 'new-project',
    ariaLabelledBy: 'new-project-title',
    onCancel: () => callbacks.onCancel?.(),
    doc,
  });

  const card = cardTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const nameInput = slot<HTMLInputElement>(card, 'name-input');
  nameInput.placeholder = namePlaceholder;

  slot(card, 'mode-section').replaceWith(
    buildSection('Mode', 'np-mode', MODE_OPTIONS, chosenMode, (v) => {
      chosenMode = v as ProjectMode;
    }),
  );
  slot(card, 'foot-section').replaceWith(
    buildSection('Foot', 'np-foot', FOOT_OPTIONS, chosenFoot, (v) => {
      chosenFoot = v as FootId;
    }),
  );

  const cancelBtn = action<HTMLButtonElement>(card, 'np-cancel');
  cancelBtn.addEventListener('click', () => {
    base.close();
    callbacks.onCancel?.();
  });

  const createBtn = action<HTMLButtonElement>(card, 'np-create');
  const submit = (): void => {
    const typed = nameInput.value.trim();
    base.close();
    callbacks.onCreate({
      name: typed.length > 0 ? typed : namePlaceholder,
      mode: chosenMode,
      suggestedFoot: chosenFoot,
    });
  };
  createBtn.addEventListener('click', submit);
  // Enter inside the name input submits — saves the user from reaching
  // for the mouse after typing. Other inputs (radios) ignore Enter, so
  // we wire this only to the name field.
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  base.dialog.appendChild(card);
  base.open();
  nameInput.focus();
}

function buildSection<T extends string>(
  heading: string,
  groupName: string,
  options: readonly { id: T; label: string; description: string }[],
  initial: T,
  onChange: (id: T) => void,
): HTMLElement {
  const section = sectionTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  slot(section, 'heading').textContent = heading;
  const optionsSlot = slot(section, 'options');
  for (const opt of options) {
    const row = optionTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
    row.dataset['option'] = opt.id;
    const radio = slot<HTMLInputElement>(row, 'radio');
    radio.name = groupName;
    radio.value = opt.id;
    radio.checked = opt.id === initial;
    radio.addEventListener('change', () => {
      if (radio.checked) onChange(opt.id);
    });
    slot(row, 'label').textContent = opt.label;
    slot(row, 'desc').textContent = opt.description;
    optionsSlot.appendChild(row);
  }
  // Drop the unused [data-slot="options"] wrapper, keeping the rows
  // inline with the section. Matches the original DOM shape.
  while (optionsSlot.firstChild) section.appendChild(optionsSlot.firstChild);
  optionsSlot.remove();
  return section;
}
