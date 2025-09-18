// state.js
// Lightweight in-memory state used to share session info between modules without using globals.
let _sessionId = null;
let _sessionStartTime = null;
let _totalEvents = 0;

export function setSessionInfo(sessionId, startTime) {
    _sessionId = sessionId;
    _sessionStartTime = startTime ? new Date(startTime).getTime() : null;
}

export function incrementEventCount() {
    _totalEvents = (_totalEvents || 0) + 1;
}

export function resetEventCount() {
    _totalEvents = 0;
}

export function getSessionId() { return _sessionId; }
export function getSessionStartTime() { return _sessionStartTime; }
export function getTotalEvents() { return _totalEvents; }

export function clearSession() { _sessionId = null; _sessionStartTime = null; _totalEvents = 0; }
