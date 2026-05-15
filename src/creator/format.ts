// Display formatting shared across UI modules and the binary import.
// formatX is the canonical "centered X coord with sign prefix" format
// used in rulers, the stitch list, the transport readout, and labels.

export function formatX(x: number): string {
  if (Math.abs(x) < 0.05) return '0.0';
  return (x > 0 ? '+' : '') + x.toFixed(1);
}
