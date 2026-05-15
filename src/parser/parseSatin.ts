import { readBE16, readBE32 } from './bytes.js';
import { umToRawX, Y_UNITS_PER_MM } from './units.js';
import type { AbsolutePoint, SimulatedSatinStitch } from './types.js';
import { satinStitches } from '../shared/satinShape.js';

// 02 03 01 satin chunk payload (verified empirically against the multi-element reference):
//   [BE16 ?][BE16 numLeft]
//   numLeft × (BE32 x_um, BE32 y_um)   left edge of cone
//   [BE16 numRight]
//   numRight × (BE32 x_um, BE32 y_um)  right edge
//   [BE16 trailer]
// Coordinates are in micrometers in the satin's local frame. Both sides share Y
// values, so each Y level is a "rung" with width = right.x − left.x.
export interface SatinPayload {
  leftUm: { x: number; y: number }[];
  rightUm: { x: number; y: number }[];
}

export function parseSatinChunk(payload: Uint8Array): SatinPayload {
  if (payload.length < 4) throw new Error(`satin payload too short: ${payload.length} bytes`);
  let cursor = 2; // skip leading BE16
  const numLeft = readBE16(payload, cursor);
  cursor += 2;
  const leftUm = readUmPoints(payload, cursor, numLeft);
  cursor += numLeft * 8;

  if (cursor + 2 > payload.length) throw new Error('satin: missing right-side header');
  const numRight = readBE16(payload, cursor);
  cursor += 2;
  const rightUm = readUmPoints(payload, cursor, numRight);

  return { leftUm, rightUm };
}

function readUmPoints(payload: Uint8Array, offset: number, count: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = offset + i * 8;
    if (at + 8 > payload.length) throw new Error(`satin: ran off end at point ${i}`);
    points.push({ x: readBE32(payload, at), y: readBE32(payload, at + 4) });
  }
  return points;
}

/**
 * Place a satin's local µm coordinates into world raw-stitch units.
 * Anchor: the satin's top-LEFT corner (left[0]) sits at the chain position;
 * the chain advances to the bottom-RIGHT corner (right[last]).
 *
 * Both axes are converted via the X stitch scale (1/8 mm), even though the
 * design's Y axis is otherwise 1/12 mm. Empirically this is what makes
 * the multi-element reference's bbox match the on-machine 13 × 36 mm;
 * using the Y scale stretches Y by 12/8 = 1.5× and produces 42.96 mm.
 * So the satin's local frame is uniform-scale and gets rendered onto
 * the asymmetric stitch grid as if it were X-axis throughout.
 */
export function placeSatinPoints(
  decoded: SatinPayload,
  chainX: number,
  chainY: number,
): { leftPoints: AbsolutePoint[]; rightPoints: AbsolutePoint[] } {
  const anchor = decoded.leftUm[0] ?? { x: 0, y: 0 };
  const toWorld = (p: { x: number; y: number }): AbsolutePoint => ({
    x: chainX + umToRawX(p.x - anchor.x),
    y: chainY + umToRawX(p.y - anchor.y),
  });
  return { leftPoints: decoded.leftUm.map(toWorld), rightPoints: decoded.rightUm.map(toWorld) };
}

/**
 * Build simulated zigzag fill stitches across a satin cone. Delegates to the
 * shared satin geometry module so the binary parser, the creator's drop
 * generator, and the creator's editor renderer all agree on what a satin
 * looks like. Density is fixed at SATIN_STITCH_DENSITY_MM, expressed in raw
 * Y units (the cone's local frame uses the X stitch scale on both axes —
 * see placeSatinPoints — so density-in-raw is densityMm × Y_UNITS_PER_MM).
 */
const SATIN_STITCH_DENSITY_MM = 0.4;

export function generateSimulatedSatinStitches(
  leftPoints: AbsolutePoint[],
  rightPoints: AbsolutePoint[],
): SimulatedSatinStitch[] {
  const densityRaw = SATIN_STITCH_DENSITY_MM * Y_UNITS_PER_MM;
  return satinStitches({ leftPoints, rightPoints }, densityRaw);
}
