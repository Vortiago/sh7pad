// Producer-string behavior. Verified on machine 2026-05-15 that both the
// content and BE16 length of the producer-string region (file offset 0x0C)
// are firmware-decorative — the firmware reads the BE16 length to skip the
// region but ignores everything inside. sh7pad therefore defaults to
// emitting 'sh7pad' and accepts any custom string via the draft's optional
// `producerString` field.

import { describe, it, expect } from 'vitest';
import {
  encodeHeader,
  headerByteLengthFor,
  SH7PAD_PRODUCER_STRING,
} from '../../creator/sh7Codec.js';
import {
  exportProjectBinary,
  projectToDesignDraft,
  serializeDesignDraft,
} from '../../creator/sh7BinaryExport.js';
import { newProject } from '../../creator/project.js';
import { parseFile } from '../../parser/parseFile.js';
import type { Point, Project, Segment } from '../../creator/types.js';

function tinyDesignProject(): Project {
  const base = newProject('Tiny');
  const p0: Point = { id: 'pt_0', x: 0, y: 0 };
  const p1: Point = { id: 'pt_1', x: 1, y: 2 };
  const segments: Segment[] = [{ id: 's_0', from: p0.id, to: p1.id, type: 'straight' }];
  return { ...base, points: [p0, p1], segments };
}

describe('headerByteLengthFor', () => {
  it("returns 26 for 'sh7pad' (14 fixed bytes + 6 chars × 2 UTF-16BE bytes)", () => {
    expect(headerByteLengthFor('sh7pad')).toBe(26);
  });
});

describe("exportProjectBinary defaults to 'sh7pad'", () => {
  it("writes BE16 producer-length = 12 and UTF-16BE 'sh7pad' starting at offset 0x0E", () => {
    const bytes = exportProjectBinary(tinyDesignProject());
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint16(0x0c)).toBe(12);
    const decoded = new TextDecoder('utf-16be').decode(bytes.subarray(0x0e, 0x0e + 12));
    expect(decoded).toBe(SH7PAD_PRODUCER_STRING);
  });

  it("round-trips through parseFile: parsed producerString equals 'sh7pad'", () => {
    const bytes = exportProjectBinary(tinyDesignProject());
    const parsed = parseFile(bytes);
    expect(parsed.producerString).toBe(SH7PAD_PRODUCER_STRING);
  });
});

describe('serializeDesignDraft honours an explicit producerString override', () => {
  it('emits the override string and writes its UTF-16BE byte length at 0x0C', () => {
    const longString = 'Produced by sh7pad reference encoder';
    const draft = projectToDesignDraft(tinyDesignProject());
    const customDraft = { ...draft, producerString: longString };
    const bytes = serializeDesignDraft(customDraft);
    const parsed = parseFile(bytes);
    expect(parsed.producerString).toBe(longString);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint16(0x0c)).toBe(longString.length * 2);
  });

  it('accepts a short custom string and adjusts the header length accordingly', () => {
    const draft = projectToDesignDraft(tinyDesignProject());
    const customDraft = { ...draft, producerString: 'hello' };
    const bytes = serializeDesignDraft(customDraft);
    const parsed = parseFile(bytes);
    expect(parsed.producerString).toBe('hello');
  });
});

describe('encodeHeader', () => {
  it("emits a 26-byte header for 'sh7pad' with magic, version, fileSize-12, BE16 producer-length=12, and the UTF-16BE producer string", () => {
    const header = encodeHeader(1000, SH7PAD_PRODUCER_STRING);
    expect(header).toHaveLength(26);
    // Magic '%spx%'
    expect(Array.from(header.subarray(0, 5))).toEqual([0x25, 0x73, 0x70, 0x78, 0x25]);
    // Version triple
    expect(Array.from(header.subarray(5, 8))).toEqual([0x01, 0x02, 0x01]);
    // BE32 fileSize - 12 at offset 0x08
    expect(new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0x08)).toBe(988);
    // BE16 producer-string byte length at offset 0x0C — 6 chars × 2 = 12
    expect(new DataView(header.buffer, header.byteOffset, header.byteLength).getUint16(0x0c)).toBe(12);
    // UTF-16BE 'sh7pad' starts at 0x0E
    const decoded = new TextDecoder('utf-16be').decode(header.subarray(0x0e, 0x0e + 12));
    expect(decoded).toBe('sh7pad');
  });

  it('respects a longer producer string and sizes the buffer accordingly', () => {
    const longString = 'Produced by the sh7pad reference encoder';
    const header = encodeHeader(2000, longString);
    expect(header).toHaveLength(14 + longString.length * 2);
    expect(new DataView(header.buffer, header.byteOffset, header.byteLength).getUint16(0x0c)).toBe(longString.length * 2);
    const decoded = new TextDecoder('utf-16be').decode(header.subarray(0x0e, 0x0e + longString.length * 2));
    expect(decoded).toBe(longString);
  });
});
