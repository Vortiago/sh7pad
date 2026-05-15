import { readBE16, readBE32, readUtf16BE } from './bytes.js';

const MAGIC = [0x25, 0x73, 0x70, 0x78, 0x25] as const;

export interface Sh7Header {
  fileSize: number;
  fileSizeMinus12: number;
  producerString: string;
  outerChunkOffset: number;
}

export function parseHeader(buf: Uint8Array): Sh7Header {
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[i] !== MAGIC[i]) {
      throw new Error(`Bad %spx% magic at byte ${i}`);
    }
  }

  const fileSizeMinus12 = readBE32(buf, 0x08);
  const fileSize = fileSizeMinus12 + 12;

  const stringByteLength = readBE16(buf, 0x0c);
  const producerString = readUtf16BE(buf, 0x0e, stringByteLength);
  const outerChunkOffset = 0x0e + stringByteLength;

  return {
    fileSize,
    fileSizeMinus12,
    producerString,
    outerChunkOffset,
  };
}
