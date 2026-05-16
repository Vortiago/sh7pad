// Dev-only seed project. Imported by mountCreator (for the "load
// sample" affordance) and by tests that want a non-trivial Project
// without hand-building geometry. Kept in its own module so production
// bundles that don't reference SAMPLE can tree-shake it cleanly.

import type { IdGenOptions, Point, Project, Segment } from './types.js';
import { newProject } from './projectFactory.js';

/**
 * Seed project — wavy straights with two vertical satin runs at varied X.
 * Satin segments must run top-to-bottom (vertical spine) but their X
 * position is wherever the previous chain left off — the user does not
 * have to detour through the centerline first.
 */
export function SAMPLE(opts: IdGenOptions = {}): Project {
  const idGen = opts.idGen ?? (() => Math.random().toString(36).slice(2, 9));
  const proj = newProject('Wave sample', { idGen });
  // Layout fits inside the SH7_MAX_Y_MM (43.69 mm) hoop — every Y stays
  // within the file-format-supported range so the seed exports cleanly.
  const layout: Array<{ x: number; y: number; type: 'straight' | 'satin' | 'start' }> = [
    { x: 0,   y: 2,    type: 'start' },
    { x: -15, y: 6,    type: 'straight' },
    { x: 12,  y: 10,   type: 'straight' },
    { x: 12,  y: 18,   type: 'satin' },    // vertical satin run at X=12
    { x: -18, y: 22,   type: 'straight' },
    { x: 0,   y: 26,   type: 'straight' },
    { x: 0,   y: 34,   type: 'satin' },    // vertical satin run at X=0
    { x: 15,  y: 38,   type: 'straight' },
    { x: -10, y: 42,   type: 'straight' },
  ];
  const points: Point[] = [{ id: proj.points[0]!.id, x: layout[0]!.x, y: layout[0]!.y }];
  for (let i = 1; i < layout.length; i++) {
    points.push({ id: `pt_${idGen()}`, x: layout[i]!.x, y: layout[i]!.y });
  }
  const segments: Segment[] = [];
  for (let i = 1; i < layout.length; i++) {
    const step = layout[i]!;
    if (step.type === 'satin') {
      segments.push({
        id: `s_${idGen()}`,
        from: points[i - 1]!.id,
        to: points[i]!.id,
        type: 'satin',
        widthStart: 2.4,
        widthEnd: 4.5,
        density: 0.6,
      });
    } else {
      segments.push({
        id: `s_${idGen()}`,
        from: points[i - 1]!.id,
        to: points[i]!.id,
        type: 'straight',
      });
    }
  }
  return { ...proj, points, segments };
}
