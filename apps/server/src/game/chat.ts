import { nanoid } from 'nanoid';
import type { ChatMessage, Role } from '@sigunu/shared';

/**
 * Global chat (Round 2 §chat) — one shared channel per session, visible to everyone
 * (players + host). Ephemeral: kept in memory (capped ring buffer) so late joiners see
 * recent context; not persisted to the DB.
 */
const buffers = new Map<string, ChatMessage[]>();
const MAX = 100;

export function addChat(
  sessionId: string,
  from: { participantId: string; name: string; role: Role },
  text: string
): ChatMessage {
  const msg: ChatMessage = {
    id: nanoid(10),
    participantId: from.participantId,
    name: from.name,
    role: from.role,
    text: text.slice(0, 500),
    at: new Date().toISOString(),
  };
  const buf = buffers.get(sessionId) ?? [];
  buf.push(msg);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  buffers.set(sessionId, buf);
  return msg;
}

export function recentChat(sessionId: string): ChatMessage[] {
  return buffers.get(sessionId) ?? [];
}
