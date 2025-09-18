import * as sceneModule from './scene';
import * as utils from './utils';
import * as chunks from './chunks';
import * as players from './players';
import * as websocket from './websocket.js';
import * as ui from './ui';
import * as events from './events';

// Create the central scene before other modules run
const created = sceneModule.createScene();
(window as any).scene = created.scene;
(window as any).camera = created.camera;
(window as any).controls = created.controls;
(window as any).renderer = created.renderer;
(window as any).groundMesh = created.groundMesh;
(window as any).gridHelper = created.gridHelper;
(window as any).axesHelper = created.axesHelper;

(window as any).utils = (window as any).utils || {};
Object.assign((window as any).utils, utils);

(window as any).chunks = (window as any).chunks || {};
Object.assign((window as any).chunks, chunks);

(window as any).players = (window as any).players || {};
Object.assign((window as any).players, players);

(window as any).websocket = (window as any).websocket || {};
Object.assign((window as any).websocket, websocket);

(window as any).ui = (window as any).ui || {};
Object.assign((window as any).ui, ui);

(window as any).events = (window as any).events || {};
Object.assign((window as any).events, events);

// Provide short legacy aliases so websocket and existing code can call them immediately
(window as any).addEventToLog = (window as any).addEventToLog || (window as any).events.addEventToLog;
(window as any).updateEventLog = (window as any).updateEventLog || (window as any).events.updateEventLog;
(window as any).addBlockEvent = (window as any).addBlockEvent || (window as any).events.addBlockEvent;
(window as any).clearBlocks = (window as any).clearBlocks || (window as any).events.clearBlocks;

(window as any).showSaveIndicator = (window as any).showSaveIndicator || (window as any).ui.showSaveIndicator;
(window as any).updateSessionInfo = (window as any).updateSessionInfo || (window as any).ui.updateSessionInfo;
(window as any).displayAnalysisResults = (window as any).displayAnalysisResults || (window as any).ui.displayAnalysisResults;

console.info('bootstrap: scene, utils, chunks, players, websocket, ui, and events attached to window');

export {};
