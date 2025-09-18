UI (React + Vite)

Development
1. cd ui
2. npm install
3. npm run dev

The Vite dev server will open on localhost:5173 by default.

Notes
- The UI code currently reuses a small subset of the original static modules under ui/src/lib. Keep migrating additional modules incrementally.
- When running inside Electron, WS_CONFIG is set in the main static config or the desktop preload to point to the local backend.
