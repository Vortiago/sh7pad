// Preview scene — woven-cloth fabric background. Drawn first, beneath
// every other layer. Tile size scales with view.zoom so zooming in on
// the design also magnifies the cloth — what the eye expects.

import { svgEl } from '../../svgDom.js';
import { mixColor, type PreviewView } from './scene.js';

// Per-document counter so each renderPreviewScene call gets a unique
// pattern id — multiple SVGs in a test document or hot-reload remounts
// otherwise share the same id and one pattern would override the others.
let fabricIdCounter = 0;

export function renderFabricBackground(
  container: PreviewView,
  bgColor: string,
  viewZoom: number,
  pan: { x: number; y: number },
): SVGGElement {
  const id = `pv-fabric-${++fabricIdCounter}`;
  const g = svgEl('g', {}, ['pv-fabric']);
  // Basket-weave: alternating light / dark cells with thin fiber strokes
  // suggest weft and warp threads. Tile size is in mm × view.zoom so the
  // weave scales with the rest of the scene — zooming in on the design
  // also magnifies the cloth, which is what the user expects after seeing
  // every other element honour the camera. No floor: at very low zoom the
  // pattern collapses to a flat colour, matching how the threads also
  // disappear into a single line at extreme zoom-out.
  const TILE_MM = 0.7;
  const TILE = TILE_MM * viewZoom;
  const light = mixColor(bgColor, '#ffffff', 0.10);
  const dark = mixColor(bgColor, '#000000', 0.08);
  const fiberLight = mixColor(bgColor, '#ffffff', 0.30);
  const fiberDark = mixColor(bgColor, '#000000', 0.22);
  const defs = svgEl('defs');
  // Translate the pattern itself by the camera's pan offset so the weave
  // tracks the rest of the scene. The full-canvas rect doesn't move; the
  // tile origin slides by (pan.x, pan.y) so a pan-right shifts every fiber
  // right and the user's eye keeps a stable cloth landmark while panning.
  const pattern = svgEl('pattern', {
    id, patternUnits: 'userSpaceOnUse', width: TILE, height: TILE,
    patternTransform: `translate(${pan.x} ${pan.y})`,
  });
  pattern.appendChild(svgEl('rect', {
    x: 0, y: 0, width: TILE, height: TILE, fill: bgColor,
  }));
  // Two L-shaped weave cells: top-left + bottom-right are "over",
  // top-right + bottom-left are "under". Half-tile cells (4×4) give the
  // basket pattern its characteristic stagger.
  const half = TILE / 2;
  pattern.appendChild(svgEl('rect', { x: 0, y: 0, width: half, height: half, fill: light }));
  pattern.appendChild(svgEl('rect', { x: half, y: half, width: half, height: half, fill: light }));
  pattern.appendChild(svgEl('rect', { x: half, y: 0, width: half, height: half, fill: dark }));
  pattern.appendChild(svgEl('rect', { x: 0, y: half, width: half, height: half, fill: dark }));
  // Fiber accents — short strokes along the centre of each cell so the
  // texture reads as woven thread rather than flat squares. Offsets and
  // stroke width are fractions of TILE so the fibers stay visually
  // proportional as the pattern scales with view.zoom.
  const inset = TILE / 8;
  const fiberW = Math.max(0.4, TILE / 14);
  pattern.appendChild(svgEl('line', {
    x1: 0, y1: inset, x2: half, y2: inset,
    stroke: fiberDark, 'stroke-opacity': 0.45, 'stroke-width': fiberW,
  }));
  pattern.appendChild(svgEl('line', {
    x1: half, y1: half + inset, x2: TILE, y2: half + inset,
    stroke: fiberDark, 'stroke-opacity': 0.45, 'stroke-width': fiberW,
  }));
  pattern.appendChild(svgEl('line', {
    x1: inset, y1: half, x2: inset, y2: TILE,
    stroke: fiberLight, 'stroke-opacity': 0.55, 'stroke-width': fiberW,
  }));
  pattern.appendChild(svgEl('line', {
    x1: half + inset, y1: 0, x2: half + inset, y2: half,
    stroke: fiberLight, 'stroke-opacity': 0.55, 'stroke-width': fiberW,
  }));
  defs.appendChild(pattern);
  g.appendChild(defs);
  g.appendChild(svgEl('rect', {
    x: 0, y: 0,
    width: container.containerW, height: container.containerH,
    fill: `url(#${id})`,
  }, ['pv-fabric-fill']));
  return g;
}
