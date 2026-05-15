// Stitch Settings section — Mode (read-only), Suggested Foot
// (read-only), and Thread Tension (paired range + number).

import { el, textEl } from '../dom.js';
import { FEET } from '../../../creator/foot.js';
import {
  TENSION_MAX,
  TENSION_MIN,
  TENSION_STEP,
} from '../../../creator/project.js';
import type { Project } from '../../../creator/types.js';
import type { FootId } from '../../../creator/foot.js';
import type { SidebarCallbacks } from './sidebar.js';

export function stitchSettingsControls(project: Project, cb: SidebarCallbacks): HTMLDivElement {
  const wrap = el('div', 'sb-stitch-controls') as HTMLDivElement;

  // Locked-at-creation metadata: Mode and Foot are immutable for the
  // life of the project (the projectStore invariant rejects in-place
  // changes). Render them as read-only rows so the UI matches the
  // data model — no silent revert when the user pokes a dropdown.
  wrap.appendChild(staticRow('Mode', formatMode(project.mode)));
  wrap.appendChild(staticRow('Suggested Foot', formatFoot(project.suggestedFoot)));
  wrap.appendChild(textEl('div', 'sb-locked-note', 'Mode and foot are set when the project is created.'));

  // Thread tension: paired range + number input. Both fire the same
  // callback; the next render re-syncs both from project state.
  const tWrap = el('div', 'sb-bg-row') as HTMLDivElement;
  const tLabel = textEl('label', 'sb-bg-lbl', 'Thread Tension') as HTMLLabelElement;
  tLabel.htmlFor = 'sb-threadTensionRange';
  tWrap.appendChild(tLabel);
  const range = document.createElement('input');
  range.type = 'range';
  range.id = 'sb-threadTensionRange';
  range.min = String(TENSION_MIN);
  range.max = String(TENSION_MAX);
  range.step = String(TENSION_STEP);
  range.value = String(project.threadTension);
  range.dataset['control'] = 'threadTensionRange';
  range.addEventListener('input', () => cb.onThreadTension(Number(range.value)));
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(TENSION_MIN);
  num.max = String(TENSION_MAX);
  num.step = String(TENSION_STEP);
  num.value = String(project.threadTension);
  num.dataset['control'] = 'threadTensionNumber';
  num.setAttribute('aria-label', 'Thread tension (numeric)');
  num.addEventListener('change', () => cb.onThreadTension(Number(num.value)));
  tWrap.appendChild(range);
  tWrap.appendChild(num);
  wrap.appendChild(tWrap);

  return wrap;
}

function formatMode(mode: Project['mode']): string {
  return mode === 'manual' ? 'Manual' : 'Design';
}

function formatFoot(foot: FootId): string {
  return FEET.find((f) => f.id === foot)?.name ?? foot;
}

export function staticRow(label: string, value: string): HTMLDivElement {
  const wrap = el('div', 'sb-bg-row sb-static-row') as HTMLDivElement;
  wrap.appendChild(textEl('span', 'sb-bg-lbl', label));
  const v = textEl('span', 'sb-static-val', value);
  v.dataset['readonly'] = 'true';
  wrap.appendChild(v);
  return wrap;
}
