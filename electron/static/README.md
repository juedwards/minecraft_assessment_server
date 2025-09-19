# Static viewer build notes

This directory holds TypeScript source for the static Electron viewer. We bundle the `static/modules` entry into a single ESM bundle for the renderer.

How to build (developer):
- Run the top-level `npm run build` from the `electron` folder. That runs `npm run build:static` (esbuild) and then compiles the electron main code.

Bundle output:
- `static/dist/bundle.js` — the bundled ES module loaded by `index.html`.

Rules:
- Do NOT commit built artifacts from `static/dist/`.
- After we validate the bundle, we will remove the legacy checked-in `.js` files. Keep a branch/PR so CI can validate the runtime before the final deletion.

Planned removal helper
- `scripts/prepare-remove-static-js.js` — a helper that will move legacy JS files into `_legacy_js_backup/` when run with `--doit`.
