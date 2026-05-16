// Shared sub-chunk shape — produced by the geometry-wrapper walker and
// consumed by the stitch-records and satin-payload checks.

export interface SubChunk {
  kind: 'stitch' | 'satin';
  off: number;
  len: number;
  payload: Uint8Array;
  preHeader: Uint8Array; // 20 bytes immediately before
}
