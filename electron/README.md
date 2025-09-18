This folder contains an Electron wrapper for the project's `static/` viewer.

Quick start:

1. cd electron
2. npm install
3. npm start

Notes:
- The `electron/static/` folder now contains the app's static assets; no postinstall copy step is required.
- If you modify files under the project root `static/`, you will need to update `electron/static/` manually or merge changes as appropriate.
- For packaging, run `npm run dist` (this requires devDependencies to be installed).

Deprecated:
- The `electron/scripts/copy_static.js` script used to copy the top-level `static/` folder on install; that workflow is deprecated because the static files are now committed under `electron/static/`.

TypeScript migration notes:

- Development with TypeScript without a full build:
  - Run `npm run start:dev` to launch Electron using `ts-node` for the main process (`main.dev.js` uses `ts-node/register/transpile-only`). The renderer still uses the static JS assets in `static/`.
  - Alternatively, use `npm run start:hot` to run a watch build (`tsc -w`) and restart Electron on changes.

- Building for production:
  - Run `npm run build` to compile TypeScript into `dist/` (the packaged app uses `dist/main.js` and `dist/preload.js`).
  - Run `npm run dist` to create distributable artifacts via `electron-builder` (ensure devDependencies are installed).

- Type checking:
  - Run `npm run typecheck` to run `tsc --noEmit` against the project.

- Notes about the preload script:
  - The preload script is authored in TypeScript as `preload.ts` and compiled to `dist/preload.js`. The Electron builder configuration now includes `dist/preload.js` so the preload file is available in packaged builds.

- Dev dependencies and typings:
  - Added `@types/ws` and `@types/uuid` as dev dependencies to improve type checking for WebSocket and UUID usage in the server modules.

If you encounter type errors during `npm run typecheck`, fix the server modules first (they were migrated incrementally) or run the app in `start:dev` mode while iterating on type fixes.

Generated/legacy JS files

- Some JavaScript files in this folder (for example `server/*.js`, `preload.js`, and `main.js`) are generated or legacy copies of the TypeScript sources. Prefer editing the `.ts` sources and use `npm run build` to produce compiled artifacts in `dist/`.
- The compiled `dist/` folder is what will be packaged by `electron-builder`. Root-level `.js` copies are kept for historical compatibility and convenience during incremental migration; they are annotated with a comment at the top pointing to the TypeScript source.

Cleanup guidance

- To remove the legacy `.js` files from the repository, delete the corresponding files once you are confident the `.ts` sources are complete and all consumers run the compiled `dist/` output.
- If you need a quick list of duplicated `.js` artifacts, run a shell find/grep in the `electron/` folder to locate `.js` files that mirror `.ts` sources.