# sh7pad

Browser-based viewer, creator, and editor for `.sh7` decorative-stitch
files. Runs entirely client-side; no upload, no server.

> Hobby project, not affiliated with Husqvarna Viking. The `.sh7`
> format here has been reverse-engineered from sample files and
> trial-and-error on my own sewing machine. Results may therefore
> vary. Test on scrap fabric before committing to your real project.

Live at: <https://vortiago.github.io/sh7pad/>

## What this is

- A `.sh7` parser that decodes the on-disk binary into a structured design.
- A creator UI for placing stitches, satin cones, and jumps; exports
  back to `.sh7`.
- A preview pane that simulates the stitched result.

Format notes live in [FORMAT.md](FORMAT.md).

## Develop locally

```sh
npm ci
npm run dev          # vite dev server
npm test             # vitest unit + integration suite
npm run build        # production build (writes to dist/)
npm run test:e2e     # playwright e2e (first run: `npx playwright install chromium`)
```

Requires Node 24+.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome; bug reports
welcome.

## License

MIT. See [LICENSE](LICENSE).
