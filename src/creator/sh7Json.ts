// Project-export JSON wrapper. NOT the on-disk .sh7 binary format —
// the parser at src/parser/parseFile.ts reads that. This is a small JSON
// envelope so users can save/share Creator projects between machines.
//
// Distinct file extension `.sh7c.json` keeps this from being mistaken for
// real binary .sh7 files (which the binary import path handles).
//
// Wire format note: the in-memory `BgImage` carries a native `Blob` (so
// IDB stores it efficiently), but JSON can't hold a Blob — the wire
// format therefore stores a base64 dataUrl string. exportProjectJson is
// async because Blob → dataUrl needs `arrayBuffer()`.

import { migrateProject, newProject } from './project.js';
import type { FootId } from './foot.js';
import type {
  BgImage,
  Hoop,
  ManualStitchInput,
  Point,
  Project,
  ProjectMode,
  Segment,
} from './types.js';

export const SH7C_MAGIC = 'SH7C';
export const SH7C_VERSION = 1;
export const SH7C_FILE_EXT = '.sh7c.json';

/** Wire-format BgImage: same fields as in-memory `BgImage` but the image
 *  bytes are encoded as a base64 dataUrl string (JSON-safe). */
interface WireBgImage {
  dataUrl: string;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  locked?: boolean;
}

interface SH7CPayload {
  magic: typeof SH7C_MAGIC;
  version: number;
  name?: string;
  hoop?: Hoop;
  suggestedFoot?: FootId;
  threadTension?: number;
  mode?: ProjectMode;
  points?: Point[];
  segments?: Segment[];
  manualStitches?: ManualStitchInput[];
  bg?: WireBgImage | null;
  exported?: string;
}

export async function exportProjectJson(project: Project): Promise<string> {
  const wireBg: WireBgImage | null = project.bg
    ? {
        dataUrl: await blobToDataUrl(project.bg.blob),
        x: project.bg.x,
        y: project.bg.y,
        scale: project.bg.scale,
        rotate: project.bg.rotate,
        opacity: project.bg.opacity,
        ...(project.bg.locked ? { locked: true } : {}),
      }
    : null;
  const payload: SH7CPayload = {
    magic: SH7C_MAGIC,
    version: SH7C_VERSION,
    name: project.name,
    hoop: project.hoop,
    suggestedFoot: project.suggestedFoot,
    threadTension: project.threadTension,
    mode: project.mode,
    points: project.points,
    segments: project.segments,
    manualStitches: project.manualStitches,
    bg: wireBg,
    exported: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function importProjectJson(text: string, fallbackName = 'Imported'): Project {
  const parsed = JSON.parse(text) as Partial<SH7CPayload>;
  if (parsed?.magic !== SH7C_MAGIC) {
    throw new Error('Not an SH7C file (missing magic)');
  }
  // Mode and foot are creation-only on the project (lockProjectInvariants
  // rejects in-place changes), so they have to be set via newProject.
  const fresh = newProject(parsed.name ?? fallbackName, {
    mode: parsed.mode === 'manual' ? 'manual' : 'design',
    ...(parsed.suggestedFoot ? { suggestedFoot: parsed.suggestedFoot } : {}),
  });
  const bg: BgImage | null = parsed.bg
    ? {
        blob: dataUrlToBlob(parsed.bg.dataUrl),
        x: parsed.bg.x,
        y: parsed.bg.y,
        scale: parsed.bg.scale,
        rotate: parsed.bg.rotate,
        opacity: parsed.bg.opacity,
        ...(parsed.bg.locked ? { locked: true } : {}),
      }
    : null;
  const merged: Project = {
    ...fresh,
    ...(parsed.hoop ? { hoop: parsed.hoop } : {}),
    ...(typeof parsed.threadTension === 'number'
      ? { threadTension: parsed.threadTension }
      : {}),
    points: parsed.points ?? fresh.points,
    segments: parsed.segments ?? fresh.segments,
    manualStitches: parsed.manualStitches ?? fresh.manualStitches,
    bg,
  };
  return migrateProject(merged);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const view = new Uint8Array(buf);
  // chunk to avoid stack overflow from String.fromCharCode(...view) on
  // large images.
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < view.length; i += chunkSize) {
    bin += String.fromCharCode(...view.subarray(i, i + chunkSize));
  }
  const base64 = btoa(bin);
  return `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return new Blob([], { type: 'application/octet-stream' });
  const meta = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /^data:([^;]+)/.exec(meta);
  const mime = mimeMatch?.[1] ?? 'application/octet-stream';
  const isBase64 = /;base64$/i.test(meta) || meta.includes(';base64');
  if (!isBase64) {
    return new Blob([decodeURIComponent(body)], { type: mime });
  }
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
