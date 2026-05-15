# .sh7 file format: declarative Kaitai Struct description.
#
# Companion to FORMAT.md (the authoritative reference). This file
# encodes the same byte layout in Kaitai Struct so it can be consumed
# by the kaitai-struct-compiler to generate parsers in any of its
# supported target languages.
#
# Constants and offsets cited here originate in:
#   - src/format/chunkTags.ts        (chunk tag bytes)
#   - src/format/chunkSchema.ts      (per-slot field offsets)
#   - src/format/recordCodec.ts      (stitch record byte shapes)
#   - src/creator/sh7BinaryExportConstants.ts (templates)
#
# When this schema disagrees with src/parser/parseFile.ts, the
# hand-written TypeScript parser is canonical and this file should
# be fixed.

meta:
  id: sh7
  title: .sh7 decorative-stitch design file
  file-extension: sh7
  endian: be

seq:
  - id: header
    type: file_header
  - id: outer
    type: outer_chunk

enums:
  # Outer chunk parser-dispatch enum. (verified) firmware rejects
  # unexpected NN. See OUTER_PREFIX_SINGLETON / OUTER_PREFIX_MULTI in
  # src/format/chunkTags.ts.
  chunk_class:
    1: singleton_parser
    5: multi_parser

  # Inner class byte used inside 0x06 and 0x05 chunks. Maps to
  # 'singleton'/'multi' in src/format/chunkSchema.ts (classToNByte).
  # NB: outer.nn ∈ {1, 5} while inner.nn ∈ {1, 3}.
  inner_class:
    1: singleton
    3: multi

types:
  # File header at offsets 0x00–0x45. Encoded by encodeHeader() in
  # src/creator/sh7BinaryExport.ts.
  file_header:
    seq:
      - id: magic
        contents: '%spx%'
      - id: version
        size: 3
        # (observed) always 0x01 0x02 0x01 across observed sample files.
      - id: file_size_minus_12
        type: u4
        # (verified) BE32 of (total file length − 12).
      - id: producer_string_len
        type: u2
        # (observed) firmware-decorative; sh7pad emits 12 bytes ('sh7pad' as UTF-16BE), legacy vendor files emit 56 bytes.
      - id: producer_string
        type: str
        size: producer_string_len
        encoding: UTF-16BE
        # (observed) firmware-decorative (verified): both content and length are ignored by the machine.

  # Outer chunk header (7 B) followed by the parsed body. Starts
  # immediately after the variable-length file header (= 0x0E +
  # producer_string_len). The body covers metadata table + 0x06
  # block + 0x05 block + geometry wrapper.
  outer_chunk:
    seq:
      - id: tag
        contents: [0x07]
      - id: nn
        type: u1
        enum: chunk_class
      - id: version
        contents: [0x01]
      - id: payload_length
        type: u4
      - id: body
        type: outer_body
        size: payload_length

  outer_body:
    seq:
      - id: metadata_table
        type: metadata_table
      - id: o6_sentinel
        contents: [0x09]
      - id: o6_chunks
        type: o6_chunk
        repeat: expr
        repeat-expr: 9
      - id: o5_sentinel
        contents: [0x09]
      - id: o5_chunks
        type: o5_chunk
        repeat: expr
        repeat-expr: 9
      - id: geometry_wrapper
        type: geometry_wrapper

  # Design-independent metadata table: 8-byte header + 148-byte
  # payload. METADATA_TABLE_CHUNK in
  # src/creator/sh7BinaryExportConstants.ts is the verbatim template.
  metadata_table:
    seq:
      - id: header_tag
        contents: [0x01, 0x08, 0x01, 0x01]
      - id: length
        type: u4
      - id: payload
        size: length

  # One of nine per-slot metadata chunks. 7-byte header `06 NN 02 [BE32
  # length]` + payload (111 B singleton / 106 B multi). Field offsets
  # within the payload come from O6_CHUNK_OFFSETS in
  # src/format/chunkSchema.ts (payload-relative = chunk-relative − 7).
  o6_chunk:
    seq:
      - id: tag
        contents: [0x06]
      - id: nn
        type: u1
        enum: inner_class
      - id: version
        contents: [0x02]
      - id: payload_length
        type: u4
      - id: payload
        size: payload_length
        type:
          switch-on: nn
          cases:
            'inner_class::singleton': o6_payload_singleton
            'inner_class::multi': o6_payload_multi

  # Payload-relative offsets for singleton 0x06 chunks. Stride 111 B.
  # Source: O6_CHUNK_OFFSETS.singleton in src/format/chunkSchema.ts.
  o6_payload_singleton:
    instances:
      foot:
        pos: 0x05
        type: u1
      tension:
        pos: 0x0f
        type: u1
      val0_be16:
        pos: 0x1d
        type: u2
      val1_be16:
        pos: 0x21
        type: u2
      val2_be16:
        pos: 0x25
        type: u2
      val0_be32:
        pos: 0x28
        type: u4
      x_um_a:
        pos: 0x50
        type: u4
      x_um_b:
        pos: 0x54
        type: u4
      slot_pattern:
        pos: 0x6d
        type: u1

  # Payload-relative offsets for multi 0x06 chunks. Stride 106 B.
  # Source: O6_CHUNK_OFFSETS.multi in src/format/chunkSchema.ts.
  o6_payload_multi:
    instances:
      foot:
        pos: 0x05
        type: u1
      tension:
        pos: 0x0f
        type: u1
      val0_be16:
        pos: 0x1d
        type: u2
      val1_be16:
        pos: 0x21
        type: u2
      val2_be16:
        pos: 0x25
        type: u2
      val0_be32:
        pos: 0x28
        type: u4
      x_um_a:
        pos: 0x48
        type: u4
      x_um_b:
        pos: 0x4c
        type: u4
      slot_pattern:
        pos: 0x68
        type: u1

  # One of nine per-slot record chunks. 7-byte header `05 NN 02 [BE32
  # length]` + payload (32 B singleton / 33 B multi). Field offsets
  # from O5_PAYLOAD_OFFSETS in src/format/chunkSchema.ts.
  o5_chunk:
    seq:
      - id: tag
        contents: [0x05]
      - id: nn
        type: u1
        enum: inner_class
      - id: version
        contents: [0x02]
      - id: payload_length
        type: u4
      - id: payload
        size: payload_length
        type:
          switch-on: nn
          cases:
            'inner_class::singleton': o5_payload_singleton
            'inner_class::multi': o5_payload_multi

  # Singleton 0x05 payload (32 B).
  o5_payload_singleton:
    instances:
      x_elem:
        pos: 0x04
        type: u4
      tension:
        pos: 0x10
        type: u1
      y_um:
        pos: 0x11
        type: u4
      x_um:
        pos: 0x15
        type: u4
      slot_pattern:
        pos: 0x1e
        type: u1

  # Multi 0x05 payload (33 B). Marker byte at +0x1e is always 0x02.
  o5_payload_multi:
    instances:
      tension:
        pos: 0x10
        type: u1
      y_um:
        pos: 0x11
        type: u4
      x_um:
        pos: 0x15
        type: u4
      marker:
        pos: 0x1e
        type: u1
      slot_pattern:
        pos: 0x1f
        type: u1

  # Geometry wrapper. 8-byte header `01 03 N 01 [BE32 len]` where N is
  # the inner class byte (1 singleton / 3 multi); body shape switches
  # on N. GEOMETRY_WRAPPER_PREFIX_SINGLETON / _MULTI in
  # src/format/chunkTags.ts.
  geometry_wrapper:
    seq:
      - id: prefix
        contents: [0x01, 0x03]
      - id: inner_n
        type: u1
        enum: inner_class
      - id: version
        contents: [0x01]
      - id: payload_length
        type: u4
      - id: body
        size: payload_length
        type:
          switch-on: inner_n
          cases:
            'inner_class::singleton': geometry_body_singleton
            'inner_class::multi': geometry_body_multi

  # Singleton geometry body: 16-byte preamble (3 BE32 fixed params +
  # BE32 xElem) followed by the stitch chunk. Layout owned by
  # encodeGeometryWrapper() in src/creator/sh7Codec.ts.
  geometry_body_singleton:
    seq:
      - id: preamble
        size: 16
      - id: stitch_chunk
        type: stitch_chunk

  # Multi-element geometry body: 6-byte preamble (BE32 designXOffsetUm
  # + BE16 sub-chunk count) followed by per-block headers + chunks +
  # interstitials. The inner sub-chunk parsing is left as raw bytes
  # here; the hand-written parser in src/parser/parseFile.ts walks
  # them structurally.
  geometry_body_multi:
    seq:
      - id: preamble
        size: 6
      - id: sub_data
        size-eos: true

  # Stitch chunk envelope `02 01 01 [BE32 len]` + records.
  stitch_chunk:
    seq:
      - id: tag
        contents: [0x02, 0x01, 0x01]
      - id: length
        type: u4
      - id: records
        size: length
        type: stitch_records

  stitch_records:
    seq:
      - id: records
        type: stitch_record
        repeat: eos

  # head byte == 0x80 → long-jump (7 B total); otherwise short (head is
  # the signed int8 dx and body has the dy byte). See recordCodec.ts.
  stitch_record:
    seq:
      - id: head
        type: u1
      - id: body
        type:
          switch-on: head
          cases:
            0x80: long_jump_tail
            _: short_tail

  short_tail:
    seq:
      - id: dy
        type: s1

  long_jump_tail:
    seq:
      - id: marker2
        contents: [0x23]
      - id: dx_low
        type: s1
      - id: dy
        type: s1
      - id: dx_hi
        type: s1
      - id: suffix
        contents: [0x80, 0x03]

  # Satin chunk envelope `02 03 01 [BE32 len]` + payload. Wired up as
  # a standalone type; multi-element geometry bodies are byte-searched
  # for 02 03 01 markers and each occurrence is parsed via this type.
  # Encoding owned by encodeSatinPayload() in src/creator/sh7Codec.ts:
  #   [BE16 0x0001][BE16 numLeft][numLeft × (BE32 x_um, BE32 y_um)]
  #   [BE16 numRight][numRight × (BE32 x_um, BE32 y_um)][BE16 0x0000]
  satin_chunk:
    seq:
      - id: tag
        contents: [0x02, 0x03, 0x01]
      - id: length
        type: u4
      - id: payload
        size: length
        type: satin_payload

  satin_payload:
    seq:
      - id: head_marker
        contents: [0x00, 0x01]
      - id: num_left
        type: u2
      - id: left_points
        type: satin_point
        repeat: expr
        repeat-expr: num_left
      - id: num_right
        type: u2
      - id: right_points
        type: satin_point
        repeat: expr
        repeat-expr: num_right
      - id: tail_marker
        contents: [0x00, 0x00]

  satin_point:
    seq:
      - id: x_um
        type: u4
      - id: y_um
        type: u4
