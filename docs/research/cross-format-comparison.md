# Cross-format comparison

How `.sh7` relates to the other Husqvarna / Pfaff / Viking embroidery
formats produced by the same VSM library family.

## Family overview

| Format | Magic | Use | Source documentation |
|--------|-------|-----|-----|
| `.sh7` (SPx) | `%spx%` | Decorative seam stitch (this format) | This repo |
| `.vp3` (VP3) | `%vsm%` | Modern multi-colour embroidery | KDE Liberty wiki, pyembroidery |
| `.shv` (SHV) | text header (no magic bytes) | Designer I "Menu Designer" embroidery | KDE Liberty wiki |
| `.hus` (HUS) | binary | Older embroidery format (compressed) | pyembroidery |
| `.vip` (VIP) | binary | Older embroidery format | KDE Liberty wiki |

Family resemblance: VP3 and `.sh7` use 5-byte `%xxx%` magic markers;
both have producer strings of similar shape ("Produced with VSM_SD
library" vs "Produced by     Software Ltd"); both nest tagged chunks
with BE32 length fields.

## VP3 (the closest neighbour)

Reader source: <https://github.com/EmbroidePy/pyembroidery/blob/main/pyembroidery/Vp3Reader.py>

Writer source: <https://github.com/EmbroidePy/pyembroidery/blob/main/pyembroidery/Vp3Writer.py>

KDE Liberty docs: <https://community.kde.org/Projects/Liberty/File_Formats/Viking_Pfaff>

### Chunk model

VP3 nests chunks with 3-byte tags `0 N 0` followed by a BE32
length-to-end:

| Tag | Meaning |
|-----|---------|
| `0 2 0` | Embroidery summary packet |
| `0 3 0` | Hoop-centred packet |
| `0 5 0` | Thread packet |
| `0 1 0` | Stitch-run packet |

Structurally identical to `.sh7`'s `[tag][n][version][BE32 length]`
chunks. The middle byte of VP3's tag is always `0`, so VP3 has no
class-byte dispatch; `.sh7` reuses the second byte of the chunk header
to select between singleton and multi-element parsers.

### Hoop-centred packet (`0 3 0`)

Per the KDE Liberty wiki, the payload is:

```
+0   centre-x BE32 µm
+4   centre-y BE32 µm
+8   3 unknown bytes
+11  hoop-left BE32 µm
+15  hoop-right BE32 µm
+19  hoop-bottom BE32 µm
+23  hoop-top BE32 µm
+27  hoop-width BE32 µm
+31  hoop-height BE32 µm
+35  settings string
... 100, 100, 4096, 0, 0, 4096       (constants)
... 'x', 'x', 'P', 'P', 1, 0          (signature "xxPP\x01\x00")
... producer string
... thread-count BE16
```

Structurally analogous to the unmapped bytes in `.sh7`'s 0x06 chunks:
a sequence of BE32 µm dimensions followed by a fixed constants block
followed by a fixed signature.

The `.sh7` 0x06 chunks have a "head sequence" of BE32 round numbers
starting at payload `+0x2C` (one observed value set is `30000, 50000`
for the multi-element sample) followed by constants
`(1000000, 1000, 2000, 5000)` followed by a `0x02000000` BE32 that
appears in the same position across every observed sample. By analogy
with VP3, the head sequence likely encodes hoop or bbox dimensions
and the trailing constant set is fixed scaling/limits constants.
This mapping is not field-by-field verified for `.sh7`.

### Stitch encoding

VP3 stitch records (from the pyembroidery reader):

| First byte | Meaning |
|------------|---------|
| Anything other than `0x80` | Two-byte short stitch `[dx, dy]` |
| `0x80 0x01` | 16-bit absolute move (dxLow, dxHi, dy) |
| `0x80 0x02` | End of 16-bit move (no-op) |
| `0x80 0x03` | Trim |
| `0x80 0x0A` (and `0xF6`) | Block delimiter |

`.sh7` shares the `0x80` long-jump prefix convention but uses a
simpler single record shape: `80 23 [dxLow] [dy] [dxHi] 80 03`
(7 bytes). No trim, end, or absolute-move escape codes have been
observed in `.sh7`.

### Coordinate scale

VP3 stores positions in units of 1/100 mm (so design dimensions are
multiplied by 100 to get integer values). VP3's reader applies the
same scale on both axes.

`.sh7` uses an asymmetric grid: X is 1/8 mm per raw unit, Y is 1/12
mm per raw unit. The 12/8 = 1.5 ratio is encoded explicitly in every
0x06 chunk as the `val[2] / val[1]` pair (Y_µm × 1.5 / Y_µm). Satin
chunks use a uniform local-frame scale that maps both axes through
the X stitch grid; this is unique to `.sh7` and appears to bridge
the asymmetric design grid back into satin-chunk-local coordinates.

## SHV (Designer I)

KDE Liberty docs: <https://community.kde.org/Projects/Liberty/File_Formats/Husqvarna_Viking_SHV>

Reader source: <https://github.com/EmbroidePy/pyembroidery/blob/main/pyembroidery/ShvReader.py>

SHV is the Designer I "Menu Designer" embroidery format. Its file
structure is unrelated to `.sh7`'s nested chunks; it has a flat
header and stitch list rather than chunk envelopes. The interesting
overlap is the stitch encoding:

| First byte | Meaning |
|------------|---------|
| Anything other than `0x80` | Two-byte short stitch `[dx, dy]` |
| `0x80 0x01` | Start 16-bit jump (dxLow dxHi dy_low dy_hi) |
| `0x80 0x02` | End 16-bit jump |
| `0x80 0x03` | Deleted / null stitch |
| `0x80 0xA0` | Start 8-bit jump |
| `0x80 0x00` | End 8-bit jump |

The `0x80` prefix convention is shared with `.sh7` and VP3. SHV's
specific command codes do not all appear in `.sh7`.

## HUS

Reader source: <https://github.com/EmbroidePy/pyembroidery/blob/main/pyembroidery/HusReader.py>

HUS is little-endian (unusual within the family) and uses a flat
header with separate command/X/Y compressed streams. No structural
overlap with `.sh7`.

## Field-level comparison summary

| `.sh7` feature | VP3 counterpart | SHV counterpart |
|----------------|-----------------|-----------------|
| Magic `%spx%` | Magic `%vsm%` | text "Embroidery..." header |
| Producer string | Producer string | software notice string |
| Outer container chunk (`0x07`) | Embroidery-summary chunk (`0 2 0`) | none (flat file) |
| 0x06 per-slot metadata | Hoop-centred packet (`0 3 0`) | flat header fields |
| 0x05 per-slot record | Thread packet (`0 5 0`) | colour-table row |
| 02 01 01 stitch chunk | Stitch-run packet (`0 1 0`) | flat stitch list |
| 02 03 01 satin chunk | none (VP3 has no satin equivalent) | none |
| `0x80` long-jump prefix | `0x80 NN` command escapes | `0x80 NN` command escapes |
| Asymmetric 1/8 × 1/12 mm grid | Uniform 1/100 mm | Uniform 1/10 mm |
| Class byte `n` discriminating singleton vs multi | none (VP3 has fixed structure) | none |
