import { AccessToken } from 'livekit-server-sdk';
import type { Role } from '@sigunu/shared';
import { env } from '../env.js';

export interface LiveKitIdentity {
  participantId: string;
  displayName: string;
  role: Role;
  teamId: string | null;
}

/**
 * Metadata travels with the participant on the LiveKit signal channel so other
 * clients (and our subscription manager) can reason about role/team without a
 * round-trip to our API.
 */
export function encodeMetadata(id: LiveKitIdentity): string {
  return JSON.stringify({ role: id.role, teamId: id.teamId, displayName: id.displayName });
}

/**
 * Mint a join token.
 *
 * Note: everyone gets canPublish + canSubscribe. We do NOT rely on the global
 * `canSubscribe` grant to enforce team-only audio privacy — that would be
 * all-or-nothing. Selective video subscription is subscriber-driven
 * (autoSubscribe=false on the client), and team-only audio privacy is enforced
 * by publisher-side track subscription permissions (see permissions.ts), which
 * the LiveKit SFU enforces regardless of what a subscriber's client requests.
 */
export async function mintJoinToken(roomName: string, id: LiveKitIdentity): Promise<string> {
  const at = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
    identity: id.participantId,
    name: id.displayName,
    metadata: encodeMetadata(id),
    // Sessions are long; refresh on reconnect if you extend this.
    ttl: '6h',
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}
