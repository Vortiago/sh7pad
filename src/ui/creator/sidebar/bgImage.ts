// Background image section — file picker (when no bg) and
// opacity/scale/rotate/x/y/lock controls (when one is loaded).
//
// Markup lives in bgImage.html.

import { tplFrom, slot, action } from '../dom.js';
import templateHtml from './bgImage.html?raw';
import type { BgImage } from '../../../creator/types.js';
import type { SidebarCallbacks } from './sidebar.js';

const templates = tplFrom(templateHtml);
const addTpl = templates.content.querySelector<HTMLTemplateElement>('#bg-add')!;
const controlsTpl = templates.content.querySelector<HTMLTemplateElement>('#bg-controls')!;
const sliderTpl = templates.content.querySelector<HTMLTemplateElement>('#bg-slider-row')!;
const numInputTpl = templates.content.querySelector<HTMLTemplateElement>('#bg-num-input')!;

export function addBgButton(cb: SidebarCallbacks): HTMLDivElement {
  const wrap = addTpl.content.firstElementChild!.cloneNode(true) as HTMLDivElement;
  const input = slot<HTMLInputElement>(wrap, 'file-input');
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    // File extends Blob — stash directly. IDB stores Blob natively, and
    // the editor renders via URL.createObjectURL so we never need base64.
    cb.onToggleBg({
      blob: f,
      x: 20, y: 20, scale: 1.2, rotate: 0, opacity: 0.5,
    });
    input.value = '';
  });
  action(wrap, 'bg-add').addEventListener('click', () => input.click());
  return wrap;
}

export function bgControls(bg: BgImage, cb: SidebarCallbacks): HTMLDivElement {
  const wrap = controlsTpl.content.firstElementChild!.cloneNode(true) as HTMLDivElement;
  const slidersSlot = slot(wrap, 'sliders');
  slidersSlot.replaceWith(
    slider('Opacity', 'opacity', bg.opacity, 0, 1, 0.05, (v) => cb.onBgChange({ opacity: v })),
    slider('Scale', 'scale', bg.scale, 0.2, 4, 0.05, (v) => cb.onBgChange({ scale: v })),
    slider('Rotate', 'rotate', bg.rotate, -180, 180, 1, (v) => cb.onBgChange({ rotate: v })),
  );

  const xy = slot(wrap, 'xy');
  xy.appendChild(numInput('X', bg.x, (v) => cb.onBgChange({ x: v })));
  xy.appendChild(numInput('Y', bg.y, (v) => cb.onBgChange({ y: v })));

  const lockBox = slot<HTMLInputElement>(wrap, 'lock-input');
  lockBox.checked = bg.locked === true;
  lockBox.addEventListener('change', () => cb.onBgChange({ locked: lockBox.checked }));

  action(wrap, 'bg-remove').addEventListener('click', () => cb.onBgRemove());
  return wrap;
}

function slider(
  label: string,
  control: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLDivElement {
  const wrap = sliderTpl.content.firstElementChild!.cloneNode(true) as HTMLDivElement;
  const lbl = slot<HTMLLabelElement>(wrap, 'label');
  lbl.textContent = label;
  lbl.htmlFor = `sb-bg-${control}`;
  const input = slot<HTMLInputElement>(wrap, 'input');
  input.id = `sb-bg-${control}`;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.dataset['bgControl'] = control;
  input.addEventListener('input', () => onChange(Number(input.value)));
  return wrap;
}

function numInput(label: string, value: number, onChange: (v: number) => void): HTMLLabelElement {
  const wrap = numInputTpl.content.firstElementChild!.cloneNode(true) as HTMLLabelElement;
  slot(wrap, 'label').textContent = label;
  const input = slot<HTMLInputElement>(wrap, 'input');
  input.value = value.toFixed(0);
  input.addEventListener('change', () => onChange(Number(input.value)));
  return wrap;
}
