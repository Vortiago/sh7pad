// Editor canvas grid. Three tiers (1mm "fine" only at high zoom, 5mm
// minor, 10mm major) extending past the fabric on all sides so the
// out-of-bounds wrap shows the same coordinate scaffolding. Pure
// geometry — no project / state dependency.

import { svgEl } from '../../svgDom.js';

export function renderGrid(
  halfW: number,
  H: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
): SVGGElement {
  const g = svgEl('g', {}, ['ed-grid']);
  // Three tiers (informational reference grid, not a snap target — the
  // editor itself does not snap): 1mm "fine" (only at high zoom),
  // 5mm "minor", 10mm "major".
  const step = 5;
  const major = step * 2;
  // Show 1mm lines only when each mm spans enough screen pixels to read —
  // otherwise they smear into a solid wash.
  const showFine = zoom >= 6;
  // Extend the grid past the fabric on all sides so the out-of-bounds wrap
  // bg shows the same coordinate scaffolding. 200mm overshoot covers any
  // plausible viewport at any plausible zoom; SVG clips the rest.
  const EXTEND = 200;
  const yTop = offsetY - EXTEND * zoom;
  const yBot = offsetY + (H + EXTEND) * zoom;
  const xLeft = offsetX - (halfW + EXTEND) * zoom;
  const xRight = offsetX + (halfW + EXTEND) * zoom;
  const xStart = Math.ceil(-halfW - EXTEND);
  const xEnd = Math.floor(halfW + EXTEND);
  for (let x = xStart; x <= xEnd; x += 1) {
    const isAxis = x === 0;
    const isMajor = !isAxis && x % major === 0;
    const isMinor = !isAxis && !isMajor && x % step === 0;
    if (!isAxis && !isMajor && !isMinor && !showFine) continue;
    const xp = x * zoom + offsetX;
    const cls = isAxis
      ? 'grid-axis-y'
      : isMajor
        ? 'grid-major-x'
        : isMinor
          ? 'grid-minor-x'
          : 'grid-fine-x';
    g.appendChild(svgEl('line', {
      x1: xp, x2: xp, y1: yTop, y2: yBot,
    }, [cls]));
  }
  const yStart = Math.ceil(-EXTEND);
  const yEnd = Math.floor(H + EXTEND);
  for (let y = yStart; y <= yEnd; y += 1) {
    const isAxis = y === 0;
    const isMajor = !isAxis && y % major === 0;
    const isMinor = !isAxis && !isMajor && y % step === 0;
    if (!isAxis && !isMajor && !isMinor && !showFine) continue;
    const yp = y * zoom + offsetY;
    const cls = isAxis
      ? 'grid-axis-x'
      : isMajor
        ? 'grid-major-y'
        : isMinor
          ? 'grid-minor-y'
          : 'grid-fine-y';
    g.appendChild(svgEl('line', {
      x1: xLeft, x2: xRight, y1: yp, y2: yp,
    }, [cls]));
  }
  return g;
}
