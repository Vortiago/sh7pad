# Changelog

All notable changes to sh7pad. Dates are YYYY-MM-DD in UTC.

## [Unreleased]

## [0.1.0] (2026-05-15)

Initial public release.

### Highlights

- Browser-based viewer, creator, and editor for `.sh7` decorative-stitch
  files. Everything runs client-side; no server, no upload.
- Two authoring modes: **design** (place points, connect with straight
  or satin segments) and **manual** (drop individual needle and jump
  stitches by hand).
- Preview mode with simulated zigzag fill, transport playback, and
  configurable thread / needle / fabric colour.
- Imports both `.sh7` (binary, machine-format) and `.sh7c.json`
  (project wrapper for sharing in-progress designs).
- Exports `.sh7` files the machine accepts; the producer-string region
  defaults to `sh7pad` (verified firmware-decorative).
- Reverse-engineered format reference in [FORMAT.md](FORMAT.md), plus
  a cross-format comparison against VP3 / SHV / HUS / VIP in
  [`docs/research/cross-format-comparison.md`](docs/research/cross-format-comparison.md).

### Test surface

- 882 vitest unit + integration specs, 9 Playwright e2e specs.
- Lighthouse a11y and best-practices gates on every push (a11y ≥ 0.95,
  best-practices ≥ 0.9).

[Unreleased]: https://github.com/Vortiago/sh7pad/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Vortiago/sh7pad/releases/tag/v0.1.0
