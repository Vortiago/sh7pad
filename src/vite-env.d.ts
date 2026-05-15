// Type declarations for Vite's static-asset imports used in this project.
//
// `?raw` returns the file contents as a string at build time (no runtime
// fetch). Used by Creator UI components that load co-located `.html`
// template files alongside their `.ts` (see src/ui/creator/dom.ts —
// `tplFrom` / `cloneTpl` / `slot` / `action`).

declare module '*.html?raw' {
  const value: string;
  export default value;
}
