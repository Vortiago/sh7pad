export function readBE32(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) {
    throw new Error(`readBE32 out of bounds at ${offset}`);
  }
  const b0 = buf[offset]!;
  const b1 = buf[offset + 1]!;
  const b2 = buf[offset + 2]!;
  const b3 = buf[offset + 3]!;
  return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
}

export function readBE16(buf: Uint8Array, offset: number): number {
  if (offset + 2 > buf.length) {
    throw new Error(`readBE16 out of bounds at ${offset}`);
  }
  return (buf[offset]! << 8) | buf[offset + 1]!;
}

export function readSI8(buf: Uint8Array, offset: number): number {
  if (offset >= buf.length) {
    throw new Error(`readSI8 out of bounds at ${offset}`);
  }
  const b = buf[offset]!;
  return b >= 0x80 ? b - 0x100 : b;
}

export function readUtf16BE(buf: Uint8Array, offset: number, byteLength: number): string {
  if (byteLength % 2 !== 0) {
    throw new Error(`UTF-16BE byte length must be even, got ${byteLength}`);
  }
  if (offset + byteLength > buf.length) {
    throw new Error(`readUtf16BE out of bounds at ${offset}+${byteLength}`);
  }
  const codes: number[] = [];
  for (let i = 0; i < byteLength; i += 2) {
    codes.push(readBE16(buf, offset + i));
  }
  return String.fromCharCode(...codes);
}

export function writeBE32(buf: Uint8Array, offset: number, value: number): void {
  // .sh7 BE32 fields are unsigned across the format (lengths, dimensions in
  // µm, X_elem, satin local coords, etc.). Catch negative writes here — the
  // firmware reads BE32 as unsigned, so a -1500 µm satin coord (encoded as
  // 0xFFFFFA24) reads as ~4 billion µm and crashes the stitch generator.
  if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`BE32 out of range: ${value}`);
  }
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

export function writeBE16(buf: Uint8Array, offset: number, value: number): void {
  if (value < 0 || value > 0xffff) {
    throw new Error(`BE16 out of range: ${value}`);
  }
  buf[offset] = (value >>> 8) & 0xff;
  buf[offset + 1] = value & 0xff;
}

export function toUnsignedI8(v: number): number {
  return v < 0 ? v + 0x100 : v;
}

export function writeUtf16BE(buf: Uint8Array, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buf[offset + i * 2] = (code >>> 8) & 0xff;
    buf[offset + i * 2 + 1] = code & 0xff;
  }
}
