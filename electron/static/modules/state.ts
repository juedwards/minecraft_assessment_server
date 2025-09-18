// Renderer-side state module

let _sessionId: string | null = null;
let _sessionStartTime: number | null = null;
let _totalEvents = 0;

export function setSessionInfo(sessionId: string | null, startTime?: string | number | Date | null) {
    _sessionId = sessionId;
    _sessionStartTime = startTime ? new Date(startTime as any).getTime() : null;
}

export function incrementEventCount() { _totalEvents = (_totalEvents || 0) + 1; }
export function resetEventCount() { _totalEvents = 0; }

export function getSessionId() { return _sessionId; }
export function getSessionStartTime() { return _sessionStartTime; }
export function getTotalEvents() { return _totalEvents; }

export function clearSession() { _sessionId = null; _sessionStartTime = null; _totalEvents = 0; }

export {};
