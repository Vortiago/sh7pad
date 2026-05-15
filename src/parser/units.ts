// Coordinate conventions for .sh7 files:
//   raw stitch units = the integer deltas the file stores.
//   X = 1/8 mm per unit, Y = 1/12 mm per unit (the axes have different scales).
//   um = micrometers (1/1000 mm). Used by satin chunks.

export const X_UNITS_PER_MM = 8;
export const Y_UNITS_PER_MM = 12;
const UM_PER_MM = 1000;

export function rawXtoMm(rawX: number): number {
  return rawX / X_UNITS_PER_MM;
}

export function rawYtoMm(rawY: number): number {
  return rawY / Y_UNITS_PER_MM;
}

export function umToRawX(xUm: number): number {
  return (xUm * X_UNITS_PER_MM) / UM_PER_MM;
}

export function rawToMmFixed(rawX: number, rawY: number, digits = 2): { x: string; y: string } {
  return { x: rawXtoMm(rawX).toFixed(digits), y: rawYtoMm(rawY).toFixed(digits) };
}
