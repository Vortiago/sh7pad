// Tag and prefix bytes for the .sh7 chunk envelope.
//
// One source of truth for the byte shapes that mark chunk and outer
// envelope boundaries. Encoder writes them, parser matches them,
// validator checks them. See [FORMAT.md](../../FORMAT.md) §"Chunk
// envelope" and §"Top-level layout".

/** First three bytes of every `02 01 01` stitch chunk header. */
export const STITCH_TAG = [0x02, 0x01, 0x01] as const;

/** First three bytes of every `02 03 01` satin chunk header. */
export const SATIN_TAG = [0x02, 0x03, 0x01] as const;

/** Single-byte tag of the outer chunk (`07 NN 01 [BE32 len]`). */
const OUTER_CHUNK_TAG = 0x07;

/** Single-byte tag of every `06 NN 02` per-slot metadata chunk. */
export const O6_CHUNK_TAG = 0x06;

/** Single-byte tag of every `05 NN 02` per-slot record chunk. */
export const O5_CHUNK_TAG = 0x05;

/** Outer NN that selects the singleton parser. */
const OUTER_NN_SINGLETON = 0x01;

/** Outer NN that selects the multi-element / satin parser. */
const OUTER_NN_MULTI = 0x05;

/** Outer-chunk prefix for singleton (NN=1) designs. */
export const OUTER_PREFIX_SINGLETON = new Uint8Array([
  OUTER_CHUNK_TAG,
  OUTER_NN_SINGLETON,
  0x01,
]);

/** Outer-chunk prefix for multi-element (NN=5, satin-bearing) designs. */
export const OUTER_PREFIX_MULTI = new Uint8Array([
  OUTER_CHUNK_TAG,
  OUTER_NN_MULTI,
  0x01,
]);

/** First three bytes of every stitch-chunk envelope. Same bytes as STITCH_TAG. */
export const STITCH_CHUNK_PREFIX = new Uint8Array(STITCH_TAG);

/** First three bytes of every satin-chunk envelope. Same bytes as SATIN_TAG. */
export const SATIN_CHUNK_PREFIX = new Uint8Array(SATIN_TAG);

/** Geometry wrapper for singleton (`01 03 01 01 [BE32 len]`). */
export const GEOMETRY_WRAPPER_PREFIX_SINGLETON = new Uint8Array([0x01, 0x03, 0x01, 0x01]);

/** Geometry wrapper for multi-element (`01 03 03 01 [BE32 len]`). */
export const GEOMETRY_WRAPPER_PREFIX_MULTI = new Uint8Array([0x01, 0x03, 0x03, 0x01]);

/** The single 0x09 byte that separates the metadata chunk from the 0x06 block,
 *  and the 0x06 block from the 0x05 block. */
export const COUNT_BYTE_9 = 0x09;
