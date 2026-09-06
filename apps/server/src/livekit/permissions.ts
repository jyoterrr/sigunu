import { RoomServiceClient } from 'livekit-server-sdk';
import type { AudioState } from '@sigunu/shared';
import { env } from '../env.js';
import { prisma } from '../db/client.js';

/**
 * Team-only audio privacy (Section 5) — HARD requirement, no exceptions.
 *
 * Enforcement model:
 *  - The SERVER is the single source of truth for team membership (Postgres).
 *  - When a player selects `team_only`, the server computes the allowed-subscriber
 *    identity list = that player's CURRENT teammates only, and instructs their
 *    client to apply LiveKit track subscription permissions restricted to that
 *    list. The LiveKit SFU then refuses to forward that audio track to any other
 *    identity — including the quiz master — regardless of what a subscriber's
 *    client asks for. There is deliberately NO listen-in / spectate / override.
 *  - The quiz master's identity is NEVER placed in any team's allowed list, so it
 *    can never receive team-only audio.
 *  - `open` => allow all subscribers. `mute` => publish nothing (client stops the
 *    audio track).
 *
 * Why publisher-side permissions rather than a second room: it keeps every
 * participant on ONE LiveKit connection, avoiding ~2x billable participant-minutes
 * at the 100-participant scale (see README audio decision).
 */

export const roomService = new RoomServiceClient(
  env.livekit.url,
  env.livekit.apiKey,
  env.livekit.apiSecret
);

export interface AudioPermissionDirective {
  /** Applied by the publishing client via localParticipant.setTrackSubscriptionPermissions. */
  allowAll: boolean;
  /** LiveKit identities (participant ids) allowed to subscribe when allowAll=false. */
  allowedIdentities: string[];
  /** true => the client should publish/unmute mic; false => stop publishing audio. */
  publishing: boolean;
}

/**
 * Compute the authoritative subscription directive for a participant's new audio state.
 * Server-side and never trusts the client for team membership.
 */
export async function computeAudioDirective(
  participantId: string,
  state: AudioState
): Promise<AudioPermissionDirective> {
  if (state === 'mute') {
    return { allowAll: false, allowedIdentities: [], publishing: false };
  }
  if (state === 'open') {
    return { allowAll: true, allowedIdentities: [], publishing: true };
  }

  // team_only: only current teammates (excluding self is fine — self isn't a subscriber).
  const me = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { teamId: true },
  });
  if (!me?.teamId) {
    // Solo players have no team_only state; treat as mute to be safe.
    return { allowAll: false, allowedIdentities: [], publishing: false };
  }

  const teammates = await prisma.participant.findMany({
    where: { teamId: me.teamId },
    select: { id: true },
  });

  return {
    allowAll: false,
    allowedIdentities: teammates.map((t) => t.id).filter((id) => id !== participantId),
    publishing: true,
  };
}

/**
 * When team membership changes (a teammate joins/leaves) while someone is in
 * team_only, their allowed list is stale. Callers re-run computeAudioDirective for
 * each affected team_only member and push the fresh directive over Socket.IO.
 */
export async function teamOnlyMembersOfTeam(teamId: string): Promise<string[]> {
  const rows = await prisma.participant.findMany({
    where: { teamId, audioState: 'team_only' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
