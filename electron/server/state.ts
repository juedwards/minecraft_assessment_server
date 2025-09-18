import type { WebSocket } from 'ws';

// Shared in-memory state between Minecraft and Web socket handlers
interface SessionEvent {
  timestamp: string;
  event_type: string;
  data?: any;
}

interface State {
  minecraftConnections: Set<WebSocket>;
  webClients: Set<WebSocket>;
  activePlayers: Set<string>;
  playerPositions: Record<string, any>;
  sessionId: string | null;
  sessionStartTime: Date | string | null;
  sessionFile: string | null;
  sessionEvents: SessionEvent[];
  eventBuffer: SessionEvent[];
  lastSaveTime: number | null;
  latest_assessment_results?: any;
}

const state: State = {
  minecraftConnections: new Set<WebSocket>(),
  webClients: new Set<WebSocket>(),
  activePlayers: new Set<string>(),
  playerPositions: {},
  sessionId: null,
  sessionStartTime: null,
  sessionFile: null,
  sessionEvents: [],
  eventBuffer: [],
  lastSaveTime: null,
};

export default state;
