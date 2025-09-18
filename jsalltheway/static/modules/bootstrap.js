// bootstrap.js — small bootstrapping module for incremental migration
// This file is loaded as a module before the legacy app.js. It imports the new ESM utilities
// and attaches them on `window.utils` so the non-module legacy code can gradually consume them.

import * as sceneModule from './scene.js';
import * as utils from './utils.js';
import * as chunks from './chunks.js';
import * as players from './players.js';
import * as electron_ws_shim from './electron_ws_shim.js';
import * as ui from './ui.js';
import * as events from './events.js';

// Create the central scene before other modules run
const created = sceneModule.createScene();
window.scene = created.scene;
window.camera = created.camera;
window.controls = created.controls;
window.renderer = created.renderer;
window.groundMesh = created.groundMesh;
window.gridHelper = created.gridHelper;
window.axesHelper = created.axesHelper;

window.utils = window.utils || {};
Object.assign(window.utils, utils);

window.chunks = window.chunks || {};
Object.assign(window.chunks, chunks);

window.players = window.players || {};
Object.assign(window.players, players);

window.websocket = window.websocket || {};
Object.assign(window.websocket, electron_ws_shim);

window.ui = window.ui || {};
Object.assign(window.ui, ui);

window.events = window.events || {};
Object.assign(window.events, events);

// Provide short legacy aliases so websocket and existing code can call them immediately
window.addEventToLog = window.addEventToLog || window.events.addEventToLog;
window.updateEventLog = window.updateEventLog || window.events.updateEventLog;
window.addBlockEvent = window.addBlockEvent || window.events.addBlockEvent;
window.clearBlocks = window.clearBlocks || window.events.clearBlocks;

window.showSaveIndicator = window.showSaveIndicator || window.ui.showSaveIndicator;
window.updateSessionInfo = window.updateSessionInfo || window.ui.updateSessionInfo;
window.displayAnalysisResults = window.displayAnalysisResults || window.ui.displayAnalysisResults;

console.info('bootstrap: scene, utils, chunks, players, websocket shim, ui, and events attached to window');

// Optionally expose other module stubs in future (scene, players, etc.)
