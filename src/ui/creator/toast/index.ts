// Tiny toast — appended to <body> so it floats above everything. Replaces
// any existing toast if called again.

import './toast.css';

let timer: number | null = null;

export function showToast(message: string, durationMs = 2200): void {
  removeToast();
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = message;
  document.body.appendChild(div);
  timer = window.setTimeout(() => removeToast(), durationMs);
}

export function removeToast(): void {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  document.querySelectorAll('.toast').forEach((el) => el.remove());
}
