// Defaults + dropdown choices for the realistic Preview.
// Sizes are physical values: needles in NM (NM/100 = mm shaft), threads in mm.

import type { FootId } from '../../../creator/foot.js';

export const NEEDLE_SIZES_NM = [60, 70, 75, 80, 90, 100, 110] as const;
export type NeedleSizeNm = (typeof NEEDLE_SIZES_NM)[number];

export interface ThreadOption {
  label: string;
  mm: number;
}

export const THREAD_OPTIONS: readonly ThreadOption[] = [
  { label: '80wt (Tex 18) — 0.15 mm', mm: 0.15 },
  { label: '60wt (Tex 27) — 0.18 mm', mm: 0.18 },
  { label: '50wt (Tex 30) — 0.20 mm', mm: 0.20 },
  { label: '40wt (Tex 35) — 0.22 mm', mm: 0.22 },
  { label: '30wt (Tex 50) — 0.30 mm', mm: 0.30 },
  { label: '20wt (Tex 80) — 0.40 mm', mm: 0.40 },
];

export const DEFAULT_NEEDLE_NM: NeedleSizeNm = 80;
export const DEFAULT_THREAD_MM = 0.22;

// Default colors for the realistic preview. Thread default mirrors the app's
// accent (--thread). Bg default is a warm muslin/calico tone so the canvas
// reads as cloth even before the user picks a fabric color.
export const DEFAULT_THREAD_COLOR = '#3a5dbe';
export const DEFAULT_BG_COLOR = '#e8dfc7';

// Stylized presser-foot widths in mm, measured on the reference machine.
// Other feet fall back to 16 mm — extend this map as more are measured.
export const FOOT_WIDTH_MM_FALLBACK = 16;
export function footWidthMmForFoot(id: FootId): number {
  switch (id) {
    case 'S': return 20;
    case 'B': return 16;
    default:  return FOOT_WIDTH_MM_FALLBACK;
  }
}
