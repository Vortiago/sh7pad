# Security policy

## Scope

sh7pad is a static client-side web app. There is no server, no
authentication, no data leaves your browser. The trust boundary is:

- the static files served from GitHub Pages,
- the `.sh7` / `.sh7c.json` files **you** open in the app,
- the project state stored in your browser's IndexedDB.

A "vulnerability" in this codebase therefore means something like:

- a crafted `.sh7` or `.sh7c.json` file that triggers a crash, infinite
  loop, or unbounded memory growth when imported,
- an XSS or code-injection vector through the import paths,
- a way to exfiltrate IndexedDB content cross-origin.

Bugs in the encoder that produce files which load incorrectly on the
machine are **format bugs**, not security issues. Please file those
as regular issues.

## Reporting

Open a GitHub issue at
<https://github.com/Vortiago/sh7pad/issues>. There is no private
disclosure process. If a report would be unsafe to publish openly
(e.g. it includes a crash payload that affects the broader format
family), open a minimal stub issue and request a private channel in
the body.

## Supported versions

Only `main` is supported. The hosted Pages build is what users see;
tagged versions are reference points, not separate release lines.
