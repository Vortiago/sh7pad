// Project → bytes pipeline. Drives the per-chunk encoders in sh7Codec.ts
// to turn a Project into a complete .sh7 file. The byte primitives
// themselves (encodeShortStitch, encodeChunk, encode06Block, etc.) live
// in sh7Codec.ts — import from there directly when writing tests or
// probes that build chunks by hand.

import { validate } from '../parser/validateSh7Bytes.js';
import {
  COUNT_BYTE_9,
  GEOMETRY_WRAPPER_PREFIX_MULTI,
  OUTER_PREFIX_MULTI,
  OUTER_PREFIX_SINGLETON,
  SATIN_CHUNK_PREFIX,
  STITCH_CHUNK_PREFIX,
} from '../format/chunkTags.js';
import { auditDesignBounds, auditPerRecordEnvelope } from './designEnvelope.js';
import { projectDraft } from './designSource.js';
import { sequenceFromProject } from './pipeline/encodeDesign.js';
import type {
  DesignBlockDraft,
  StitchInput,
} from './pipeline/multiBlockEmit.js';
import type { Project } from './types.js';
import {
  concat,
  coneEdgesToSatinPayload,
  encode05Chunk,
  encode05ChunkMulti,
  encode06Block,
  encode06BlockMulti,
  encodeChunk,
  encodeGeometryWrapper,
  encodeHeader,
  encodeInterstitial,
  encodeMetadataTable,
  encodeMultiPreamble,
  encodePerElementHeader,
  encodeSatinPayload,
  encodeStitches,
  headerByteLengthFor,
  SH7PAD_PRODUCER_STRING,
} from './sh7Codec.js';

/**
 * Fields every chunk-class draft carries: the 0x06 fields that are emitted
 * the same way regardless of class. Each class extends this with the
 * geometry-shape fields it needs.
 */
interface DesignDraftCommon {
  footByte: number;
  tensionByte: number;
  xUm: number;
  yUm: number;
  /**
   * Override for the BE16 at +0x1D ("val[0]") of every 0x06 chunk. Semantics
   * unknown but firmware-read. Defaults to X_µm. The singleton reference design round-trip
   * sets this to 6000 explicitly because the singleton template's value (6000) doesn't equal
   * its X dimension (7000).
   */
  o6Val0Um?: number;
  /**
   * UTF-16BE producer string embedded at file offset 0x0E. Firmware-decorative
   * (verified on machine 2026-05-15: both content and BE16 length are ignored
   * as long as the length is self-consistent with the rest of the file).
   * Defaults to {@link SH7PAD_PRODUCER_STRING}; pass any other string to
   * reproduce a legacy byte sequence.
   */
  producerString?: string;
}

/**
 * Singleton draft — selects the NN=1 / `01 03 01 01` wrapper and one
 * stitch chunk. Used for designs without any satin block. `xElem` is the
 * geometry wrapper's trailing BE32 (firmware-tolerant of any value for
 * singletons; the V1 encoder emits 0).
 */
export interface SingletonDesignDraft extends DesignDraftCommon {
  kind: 'singleton';
  xElem: number;
  stitches: StitchInput[];
}

/**
 * Multi-element draft — selects the NN=5 / `01 03 03 01` wrapper and a
 * block list interleaving element-stitch chunks with satin chunks. Used
 * for designs that contain at least one satin segment. Per-block xElem /
 * yPos are computed inside the walker; the draft does not carry a
 * design-wide xElem.
 */
export interface MultiBlockDesignDraft extends DesignDraftCommon {
  kind: 'multi';
  blocks: DesignBlockDraft[];
}

/** Discriminated union over the two chunk-class drafts. Pick via {@link projectToDesignDraft}. */
export type DesignDraft = SingletonDesignDraft | MultiBlockDesignDraft;

// Outer-chunk and stitch / satin envelope prefixes live in
// ../format/chunkTags.ts. Aliases below keep nearby code readable.
const STITCH_PREFIX = STITCH_CHUNK_PREFIX;
const SATIN_PREFIX = SATIN_CHUNK_PREFIX;

export function serializeDesignDraft(draft: DesignDraft): Uint8Array {
  return draft.kind === 'singleton'
    ? serializeSingletonDraft(draft)
    : serializeMultiBlockDraft(draft);
}

function serializeSingletonDraft(draft: SingletonDesignDraft): Uint8Array {
  // Singleton wrapper: one stitch chunk inside the 16-byte geometry wrapper
  // (BE32 125, 125, 1000, xElem) and the NN=1 / `01 03 01 01` outer.
  const o6Block = encode06Block({
    footByte: draft.footByte,
    tensionByte: draft.tensionByte,
    xUm: draft.xUm,
    yUm: draft.yUm,
    val0Um: draft.o6Val0Um,
  });
  const o5Block = encode05Block({
    tensionByte: draft.tensionByte,
    xUm: draft.xUm,
    yUm: draft.yUm,
    xElem: draft.xElem,
  });
  const stitchChunk = encodeChunk(STITCH_PREFIX, encodeStitches(draft.stitches));
  const geometryWrapper = encodeGeometryWrapper({ xElem: draft.xElem, stitchChunk });
  return finalizeFile(
    OUTER_PREFIX_SINGLETON,
    o6Block,
    o5Block,
    geometryWrapper,
    draft.producerString ?? SH7PAD_PRODUCER_STRING,
  );
}

function serializeMultiBlockDraft(draft: MultiBlockDesignDraft): Uint8Array {
  // Multi-element files MUST use n=3 0x06 / 0x05 chunks; mixing classes
  // makes the machine display "Not supported SDC" and can crash the
  // firmware on repeated mismatches.
  const o6Block = encode06BlockMulti({
    footByte: draft.footByte,
    tensionByte: draft.tensionByte,
    xUm: draft.xUm,
    yUm: draft.yUm,
    val0Um: draft.o6Val0Um,
  });
  const o5Block = encode05BlockMulti({
    tensionByte: draft.tensionByte,
    xUm: draft.xUm,
    yUm: draft.yUm,
  });
  const geometryWrapper = encodeMultiBlockGeometryWrapper(draft.blocks);
  return finalizeFile(
    OUTER_PREFIX_MULTI,
    o6Block,
    o5Block,
    geometryWrapper,
    draft.producerString ?? SH7PAD_PRODUCER_STRING,
  );
}

// NN is a parser-dispatch enum: NN=1 selects the singleton parser, NN=5
// selects the multi-element with satin parser. It is NOT a count of
// elements or satins; probing confirmed that patching a multi-element
// file's NN from 5 to a single-stitch value makes the machine reject it
// with "Multiple number of StitchData".
function finalizeFile(
  outerPrefix: Uint8Array,
  o6Block: Uint8Array,
  o5Block: Uint8Array,
  geometryWrapper: Uint8Array,
  producerString: string,
): Uint8Array {
  const outerPayload = concat([
    encodeMetadataTable(),
    new Uint8Array([COUNT_BYTE_9]),
    o6Block,
    new Uint8Array([COUNT_BYTE_9]),
    o5Block,
    geometryWrapper,
  ]);
  const outerChunk = encodeChunk(outerPrefix, outerPayload);
  const headerLen = headerByteLengthFor(producerString);
  const header = encodeHeader(headerLen + outerChunk.length, producerString);
  return concat([header, outerChunk]);
}

/**
 * `xElem` for the synthetic closing element-stitch chunk emitted when
 * the user's last block is a satin. The chunk carries a single `(0, 0)`
 * no-op short stitch, and the multi-element template's shape uses `0`
 * here, so the encoder emits `0` for this slot too.
 */
const SYNTHETIC_CLOSING_X_ELEM = 0;

function encodeMultiBlockGeometryWrapper(blocks: DesignBlockDraft[]): Uint8Array {
  // Build sub-chunks first so we can write the correct count into the
  // preamble's BE16. Layout: preamble + for-each block (per-element header
  // before each element chunk; satin chunks emitted standalone, preceded by
  // a 20-byte interstitial when they follow an element). When the user's
  // last block is a satin, append a synthetic closing element-stitch chunk
  // (encoder convention; matches the multi-element template's shape).
  const subParts: Uint8Array[] = [];
  let subChunkCount = 0;
  let prevKind: 'element' | 'satin' | null = null;
  for (const block of blocks) {
    if (block.kind === 'element') {
      subParts.push(encodePerElementHeader(block.xElem ?? 0, block.yPos ?? 0));
      subParts.push(encodeChunk(STITCH_PREFIX, encodeStitches(block.stitches)));
      subChunkCount++;
    } else {
      if (prevKind === 'element') {
        subParts.push(encodeInterstitial(block.interstitial ?? [0, 0]));
      }
      subParts.push(
        encodeChunk(SATIN_PREFIX, encodeSatinPayload(coneEdgesToSatinPayload(block.edges))),
      );
      subChunkCount++;
    }
    prevKind = block.kind;
  }
  if (prevKind === 'satin') {
    subParts.push(encodePerElementHeader(SYNTHETIC_CLOSING_X_ELEM, 0));
    subParts.push(encodeChunk(STITCH_PREFIX, encodeStitches([{ kind: 'short', dxRaw: 0, dyRaw: 0 }])));
    subChunkCount++;
  }
  const preamble = encodeMultiPreamble(subChunkCount);
  return encodeChunk(GEOMETRY_WRAPPER_PREFIX_MULTI, concat([preamble, ...subParts]));
}

interface O5BlockInput {
  tensionByte: number;
  xUm: number;
  yUm: number;
  xElem: number;
}

function encode05Block(input: O5BlockInput): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let slot = 0; slot < 9; slot++) {
    chunks.push(
      encode05Chunk({
        slotIndex: slot,
        tensionByte: input.tensionByte,
        xUm: input.xUm,
        yUm: input.yUm,
        xElem: input.xElem,
      }),
    );
  }
  return concat(chunks);
}

interface O5MultiBlockInput {
  tensionByte: number;
  xUm: number;
  yUm: number;
}

function encode05BlockMulti(input: O5MultiBlockInput): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let slot = 0; slot < 9; slot++) {
    chunks.push(encode05ChunkMulti({ slotIndex: slot, ...input }));
  }
  return concat(chunks);
}

/** Build a {@link DesignDraft} from a {@link Project}. Picks the right
 *  chunk class (singleton vs multi-block) and the right authoring-source
 *  adapter inside `designSource.ts`. */
export function projectToDesignDraft(project: Project): DesignDraft {
  return projectDraft(project);
}

export interface ExportOptions {
  /**
   * If `true` (default), refuse to emit when the project falls outside the
   * verified encoder envelope (Y > 43.6 mm, X wider than the active foot's
   * carriage reach, or empty project). Disable for intentional probe files
   * that step outside the envelope.
   */
  enforceEnvelope?: boolean;
  /**
   * If `true` (default), run the byte-level validator on the encoder output
   * and throw if any FAIL-level rule trips. Disable to dump probes intended
   * to fail validation for diagnostic purposes.
   */
  validateOutput?: boolean;
}

export function exportProjectBinary(project: Project, options: ExportOptions = {}): Uint8Array {
  const enforceEnvelope = options.enforceEnvelope ?? true;
  const validateOutput = options.validateOutput ?? true;

  if (enforceEnvelope) {
    const envelopeErrors = [
      ...auditDesignBounds(project),
      ...auditPerRecordEnvelope(sequenceFromProject(project)),
    ];
    if (envelopeErrors.length > 0) {
      throw new Error(
        'sh7BinaryExport: project falls outside the verified encoder envelope.\n' +
          envelopeErrors.map((e) => `  - ${e}`).join('\n') +
          '\nSet { enforceEnvelope: false } to bypass.',
      );
    }
  }

  const bytes = serializeDesignDraft(projectToDesignDraft(project));

  if (validateOutput) {
    const fails = validate(bytes).filter((r) => r.severity === 'FAIL');
    if (fails.length > 0) {
      throw new Error(
        'sh7BinaryExport: encoder output failed validator.\n' +
          fails.map((f) => `  - ${f.rule}: ${f.detail}`).join('\n') +
          '\nFix the encoder bug or set { validateOutput: false } to bypass.',
      );
    }
  }

  return bytes;
}
