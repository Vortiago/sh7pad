// Glossary of stitch-creator vocabulary, used both by inline info
// popovers next to toolbar controls and by the full Glossary modal in
// the sidebar.
//
// Two "concept" entries (segment, stitch) frame the rest of the
// vocabulary. Segments are design-time recipes the encoder converts
// into needles and jumps on export; Straight and Satin are both
// segments. Stitches are individual machine actions; Needle and Jump
// are the two kinds. Satin is a segment in BOTH design and manual mode:
// the same thing, exported the same way, regardless of where it was
// placed. Manual mode just lets you mix raw needle/jump stitches
// alongside satin segments.

export type GlossaryCategory = 'concept' | 'design' | 'stitch' | 'density';

export type GlossaryId =
  | 'segment'
  | 'stitch'
  | 'straight-segment'
  | 'satin-segment'
  | 'needle-stitch'
  | 'jump-stitch'
  | 'density-compact'
  | 'density-uniform';

export interface GlossaryEntry {
  readonly id: GlossaryId;
  readonly category: GlossaryCategory;
  readonly term: string;
  readonly short: string;
}

export const CATEGORY_ORDER: readonly GlossaryCategory[] = ['concept', 'design', 'stitch', 'density'];

export const GLOSSARY: Readonly<Record<GlossaryId, GlossaryEntry>> = {
  segment: {
    id: 'segment',
    category: 'concept',
    term: 'Segment',
    short:
      'A design-time path you draw, like a straight line or a satin band. Not a stitch. The encoder converts each segment into a sequence of needle and jump stitches when you export the design.',
  },
  stitch: {
    id: 'stitch',
    category: 'concept',
    term: 'Stitch',
    short:
      'A single action the machine performs: either a needle stitch (needle goes down) or a jump stitch (needle and carriage travel together). Stitches are what actually ends up on the fabric.',
  },
  'straight-segment': {
    id: 'straight-segment',
    category: 'design',
    term: 'Straight (segment)',
    short:
      'Design segment. A simple line that is fast to author. On export, the encoder fills it with evenly-spaced needle stitches and inserts jumps where needed. Not a stitch on its own.',
  },
  'satin-segment': {
    id: 'satin-segment',
    category: 'design',
    term: 'Satin (segment)',
    short:
      'Segment. A satin band, used for thick lines. On export, the encoder fills it with the zig-zag pattern of needle stitches that produces a satin finish. The same in design and manual mode. Manual mode just lets you place a satin between raw needle and jump stitches.',
  },
  'needle-stitch': {
    id: 'needle-stitch',
    category: 'stitch',
    term: 'Needle stitch',
    short:
      'Stitch. A normal needle-down stitch. Moves only the needle; the carriage stays put. The basic building block. Most of your design is needle stitches.',
  },
  'jump-stitch': {
    id: 'jump-stitch',
    category: 'stitch',
    term: 'Jump stitch',
    short:
      'Stitch. Moves the needle and the carriage together. Used to travel between shapes or further than a single needle stitch can reach.',
  },
  'density-compact': {
    id: 'density-compact',
    category: 'density',
    term: 'Compact density',
    short:
      "The encoder coalesces needle drops that fall inside the foot's slot, producing fewer, longer stitches where the carriage doesn't need to move. Default.",
  },
  'density-uniform': {
    id: 'density-uniform',
    category: 'density',
    term: 'Uniform density',
    short:
      'The encoder lays down needle drops at a constant spacing along the path, regardless of slot geometry. More predictable visually; more stitches per cm.',
  },
};

export function getEntry(id: GlossaryId): GlossaryEntry {
  const entry = GLOSSARY[id];
  if (!entry) throw new Error(`Unknown glossary id: ${id}`);
  return entry;
}

export function entriesByCategory(): Record<GlossaryCategory, readonly GlossaryEntry[]> {
  const groups: Record<GlossaryCategory, GlossaryEntry[]> = {
    concept: [],
    design: [],
    stitch: [],
    density: [],
  };
  for (const cat of CATEGORY_ORDER) {
    for (const entry of Object.values(GLOSSARY)) {
      if (entry.category === cat) groups[cat].push(entry);
    }
  }
  return groups;
}
