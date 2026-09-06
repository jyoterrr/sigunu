import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@sigunu/shared';

export interface SocketData {
  sessionId: string;
  participantId: string;
  role: 'quizmaster' | 'player';
  teamId: string | null;
  isHost: boolean; // presented a valid host token
}

export type SigunuServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Socket.IO room name for a session. One broadcast fans out to all its members. */
export const roomFor = (sessionId: string) => `session:${sessionId}`;

/** Per-team sub-room, so a team answer-lock notifies only that team's members. */
export const teamRoomFor = (sessionId: string, teamId: string) => `team:${sessionId}:${teamId}`;
