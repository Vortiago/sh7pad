// Tap-to-add ripple — spawns a transient element near a tap so users
// get visual confirmation the tap registered (touch UX, no cursor
// change to confirm).
//
// The ripple isn't drawn inside the SVG — it's a positioned span on
// the canvas wrapper (.ed-canvas-wrap) so editor/render's wipe-and-
// rebuild doesn't take it down before the animation completes.

import './tapRipple.css';

const RIPPLE_LIFETIME_MS = 350;

export function spawnRipple(host: HTMLElement, x: number, y: number): void {
  const dot = host.ownerDocument!.createElement('span');
  dot.className = 'ed-tap-ripple';
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  // Sit above the SVG content but ignore pointer events so the ripple
  // never swallows a follow-up tap.
  host.appendChild(dot);
  const remove = (): void => { dot.remove(); };
  dot.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, RIPPLE_LIFETIME_MS + 100);
}
