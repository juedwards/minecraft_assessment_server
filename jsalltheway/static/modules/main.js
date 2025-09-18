// main.js — single module entry point that bootstraps the scene and then loads the legacy app module
import './bootstrap.js';
// Ensure electron websocket shim is imported so window.websocket is available
import './electron_ws_shim.js';
// Import the app as a module so it executes after bootstrap
import '../app.js';
