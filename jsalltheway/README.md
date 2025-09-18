JS-All-The-Way Electron app

This folder contains a minimal Electron app that runs a Node WebSocket server on port 19131 (default) and forwards client messages into the renderer via IPC. The renderer can send messages back to specific clients or broadcast.

Quick dev run (Windows):
1. cd jsalltheway
2. npm install
3. npm run start

Notes
- This is a scaffold: heavy server-side processing (chunk decoding, AI, numpy/cupy work) is not ported here — porting those parts to Node/TS requires significant work or replacement libraries.
- Use this for rapid UI-first prototyping and for the case where the Minecraft client can speak the same websocket protocol directly to Electron.
