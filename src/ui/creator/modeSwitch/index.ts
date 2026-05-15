// Edit / Preview pill toggle. Lives in the top bar above the active pane.
// Keys 1 = Edit, 2 = Preview are wired in main.ts (not here, so the keymap
// is in one place).

import './modeSwitch.css';

export type Mode = 'edit' | 'preview';

export function renderModeSwitch(
  root: HTMLElement,
  mode: Mode,
  onChange: (next: Mode) => void,
): void {
  root.replaceChildren();
  root.classList.add('ms-wrap');

  root.appendChild(modeButton('Edit', '1', 'edit', mode === 'edit', () => {
    if (mode !== 'edit') onChange('edit');
  }));
  root.appendChild(modeButton('Preview', '2', 'preview', mode === 'preview', () => {
    if (mode !== 'preview') onChange('preview');
  }));
}

function modeButton(label: string, key: string, value: Mode, active: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset['mode'] = value;
  btn.dataset['active'] = active ? 'true' : 'false';
  btn.className = 'ms-btn';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  const keySpan = document.createElement('span');
  keySpan.className = 'ms-kbd';
  keySpan.textContent = key;
  btn.appendChild(labelSpan);
  btn.appendChild(keySpan);
  btn.addEventListener('click', onClick);
  return btn;
}
