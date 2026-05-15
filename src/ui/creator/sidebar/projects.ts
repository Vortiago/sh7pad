// Project list item + the "+ New / Import / Export" action button
// helper. Extracted from sidebar.ts so each row of the project list
// is a focused unit; the parent renderSidebar orchestrator only knows
// "render a row".

import { appBtn, el, textEl } from '../dom.js';
import type { Project } from '../../../creator/types.js';
import type { SidebarCallbacks } from './sidebar.js';

export function actionBtn(
  label: string,
  action: string,
  onClick: () => void,
  className: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset['action'] = action;
  btn.className = appBtn(className);
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function projectMetaLabel(p: Project): string {
  if (p.mode === 'manual') {
    const n = p.manualStitches.length;
    return `manual · ${n} stitch${n === 1 ? '' : 'es'}`;
  }
  return `design · ${p.points.length} pts · ${p.segments.length} seg`;
}

export function projectRow(p: Project, active: boolean, cb: SidebarCallbacks): HTMLDivElement {
  const row = document.createElement('div');
  row.dataset['projectId'] = p.id;
  row.dataset['active'] = active ? 'true' : 'false';
  row.className = 'sb-item';
  if (active) row.classList.add('active');

  const main = el('div', 'sb-item-main');
  if (active) {
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.dataset['control'] = 'project-name';
    nameInput.className = 'sb-item-name-input';
    nameInput.setAttribute('aria-label', 'Project name');
    nameInput.value = p.name;
    nameInput.addEventListener('click', (e) => e.stopPropagation());
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });
    nameInput.addEventListener('change', () => {
      const next = nameInput.value.trim();
      if (next && next !== p.name) cb.onRename(p.id, next);
      else nameInput.value = p.name;
    });
    main.appendChild(nameInput);
  } else {
    main.appendChild(textEl('div', 'sb-item-name', p.name));
  }
  main.appendChild(textEl('div', 'sb-item-meta', projectMetaLabel(p)));
  row.appendChild(main);

  if (active) {
    const del = document.createElement('button');
    del.type = 'button';
    del.dataset['action'] = 'delete';
    del.className = 'sb-item-del';
    del.textContent = '✕';
    del.title = 'Delete project';
    del.setAttribute('aria-label', 'Delete project');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      cb.onDelete(p.id);
    });
    row.appendChild(del);
  }
  row.addEventListener('click', () => cb.onSelect(p.id));
  return row;
}
