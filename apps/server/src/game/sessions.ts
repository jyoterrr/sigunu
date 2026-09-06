import { customAlphabet } from 'nanoid';
import { Prisma } from '@prisma/client';
import { prisma, PRISMA_UNIQUE_VIOLATION } from '../db/client.js';
import { mintJoinToken } from '../livekit/tokens.js';
import { env } from '../env.js';
import type {
  CreateSessionResponse,
  JoinSessionResponse,
  ParticipantView,
  TeamView,
  Role,
} from '@sigunu/shared';

// Human-friendly, unambiguous join codes (no 0/O/1/I/L).
const joinCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6);
const secret = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 40);

export class JoinError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'ended' | 'team_taken' | 'bad_name') {
    super(message);
  }
}

export async function createSession(): Promise<CreateSessionResponse> {
  const code = joinCode();
  const session = await prisma.session.create({
    data: {
      joinCode: code,
      hostToken: secret(),
      roomName: `sigunu-${code}`,
      phase: 'lobby',
    },
    select: { id: true, joinCode: true, hostToken: true, roomName: true },
  });

  return { sessionId: session.id, joinCode: session.joinCode, hostToken: session.hostToken };
}

/** Mint a LiveKit token + create the quiz-master participant (Open/Mute audio only). */
export async function issueHostLiveKit(sessionId: string) {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: { roomName: true },
  });
  let host = await prisma.participant.findFirst({
    where: { sessionId, role: 'quizmaster' },
    select: { id: true, displayName: true, authToken: true },
  });
  if (!host) {
    host = await prisma.participant.create({
      data: {
        sessionId,
        displayName: 'Quiz Master',
        role: 'quizmaster',
        audioState: 'mute',
        authToken: secret(),
      },
      select: { id: true, displayName: true, authToken: true },
    });
  }
  const token = await mintJoinToken(session.roomName, {
    participantId: host.id,
    displayName: host.displayName,
    role: 'quizmaster',
    teamId: null,
  });
  return {
    participantId: host.id,
    authToken: host.authToken,
    livekit: { url: env.livekit.url, token, roomName: session.roomName },
  };
}

/**
 * Join a session by code. Team handling (Section 3/4):
 *  - no teamName => solo player.
 *  - teamName given => join the existing team of that name, or create it. Team names
 *    are unique per session; a create race is caught by the DB unique index and we
 *    retry as a join (so two people creating the same name concurrently converge on
 *    one team rather than erroring spuriously).
 */
export async function joinSession(
  joinCodeInput: string,
  displayName: string,
  teamName?: string
): Promise<JoinSessionResponse> {
  const name = displayName.trim();
  if (!name) throw new JoinError('Display name is required.', 'bad_name');

  const session = await prisma.session.findUnique({
    where: { joinCode: joinCodeInput.trim().toUpperCase() },
    select: { id: true, roomName: true, endedAt: true },
  });
  if (!session) throw new JoinError('No session found for that code.', 'not_found');
  if (session.endedAt) throw new JoinError('This session has ended.', 'ended');

  let teamId: string | null = null;
  const wantedTeam = teamName?.trim();
  if (wantedTeam) {
    teamId = await joinOrCreateTeam(session.id, wantedTeam);
  }

  const participant = await prisma.participant.create({
    data: {
      sessionId: session.id,
      displayName: name,
      role: 'player',
      teamId,
      audioState: 'mute',
      authToken: secret(),
    },
    select: { id: true, displayName: true, teamId: true, authToken: true },
  });

  const livekitToken = await mintJoinToken(session.roomName, {
    participantId: participant.id,
    displayName: participant.displayName,
    role: 'player',
    teamId: participant.teamId,
  });

  return {
    sessionId: session.id,
    participantId: participant.id,
    token: participant.authToken,
    livekit: { url: env.livekit.url, token: livekitToken, roomName: session.roomName },
  };
}

async function joinOrCreateTeam(sessionId: string, name: string): Promise<string> {
  const existing = await prisma.team.findUnique({
    where: { sessionId_name: { sessionId, name } },
    select: { id: true },
  });
  if (existing) return existing.id;
  try {
    const created = await prisma.team.create({
      data: { sessionId, name },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
      // Lost a create race — the team now exists; join it.
      const t = await prisma.team.findUniqueOrThrow({
        where: { sessionId_name: { sessionId, name } },
        select: { id: true },
      });
      return t.id;
    }
    throw err;
  }
}

/** Snapshot of participants + teams for broadcast. */
export async function rosterOf(
  sessionId: string
): Promise<{ participants: ParticipantView[]; teams: TeamView[] }> {
  const [participants, teams] = await Promise.all([
    prisma.participant.findMany({
      where: { sessionId },
      select: { id: true, displayName: true, role: true, teamId: true, connected: true, status: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.team.findMany({
      where: { sessionId },
      select: { id: true, name: true, members: { select: { id: true } } },
    }),
  ]);
  return {
    participants: participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: p.role as Role,
      teamId: p.teamId,
      connected: p.connected,
      status: p.status as 'active' | 'left',
    })),
    teams: teams.map((t) => ({ id: t.id, name: t.name, memberIds: t.members.map((m) => m.id) })),
  };
}
