import { Prisma } from '@prisma/client';
import { prisma, PRISMA_UNIQUE_VIOLATION } from '../db/client.js';

/**
 * Team membership transitions with point carry-over (Round 2 §4/§5).
 *
 * Confirmed rule: a player carries the points from questions THEY personally locked.
 * Scores aren't stored per player — they're recomputed from LockedAnswer rows keyed by
 * `lockKey` (`team:<id>`/`solo:<id>`), and each row records `lockedByParticipantId`. So
 * a switch re-keys the moving player's own answers to their new subject. No migration.
 */

export class MembershipError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'busy' | 'name_taken' | 'invalid') {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

/**
 * Move a player's own locked answers from one subject key to another. If the target
 * subject already answered a given question (unique key clash), the moving row is
 * dropped so we never double-count or violate the constraint.
 */
async function rekeyAnswers(
  tx: Tx,
  sessionId: string,
  fromLockKey: string,
  toLockKey: string,
  toTeamId: string | null,
  byParticipantId?: string
) {
  const rows = await tx.lockedAnswer.findMany({
    where: {
      sessionId,
      lockKey: fromLockKey,
      ...(byParticipantId ? { lockedByParticipantId: byParticipantId } : {}),
    },
    select: { id: true, questionId: true },
  });
  for (const r of rows) {
    const clash = await tx.lockedAnswer.findUnique({
      where: { sessionId_questionId_lockKey: { sessionId, questionId: r.questionId, lockKey: toLockKey } },
      select: { id: true },
    });
    if (clash) {
      await tx.lockedAnswer.delete({ where: { id: r.id } });
    } else {
      await tx.lockedAnswer.update({ where: { id: r.id }, data: { lockKey: toLockKey, teamId: toTeamId } });
    }
  }
}

/** Leave the current team → become solo, carrying your own locked answers (§5). */
export async function leaveTeam(participantId: string): Promise<{ sessionId: string } | null> {
  const p = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { sessionId: true, teamId: true },
  });
  if (!p) throw new MembershipError('Participant not found.', 'not_found');
  if (!p.teamId) return null; // already solo
  const { sessionId, teamId } = p;
  await prisma.$transaction(async (tx) => {
    await rekeyAnswers(tx, sessionId, `team:${teamId}`, `solo:${participantId}`, null, participantId);
    await tx.participant.update({ where: { id: participantId }, data: { teamId: null } });
  });
  return { sessionId };
}

/** A solo invitee joins the requester's existing team, carrying their solo points (§4). */
export async function joinExistingTeam(inviteeId: string, teamId: string): Promise<{ sessionId: string }> {
  const [invitee, team] = await Promise.all([
    prisma.participant.findUnique({ where: { id: inviteeId }, select: { sessionId: true, teamId: true } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { sessionId: true } }),
  ]);
  if (!invitee || !team) throw new MembershipError('Not found.', 'not_found');
  if (invitee.teamId) throw new MembershipError('Player is already on a team.', 'busy');
  if (invitee.sessionId !== team.sessionId) throw new MembershipError('Cross-session.', 'invalid');
  const sessionId = invitee.sessionId;
  await prisma.$transaction(async (tx) => {
    // All solo:invitee answers are the invitee's own — move them all.
    await rekeyAnswers(tx, sessionId, `solo:${inviteeId}`, `team:${teamId}`, teamId);
    await tx.participant.update({ where: { id: inviteeId }, data: { teamId } });
  });
  return { sessionId };
}

/** Two solo players form a new team; the requester names it (§4). Both carry points. */
export async function createTeamAndJoin(
  sessionId: string,
  name: string,
  requesterId: string,
  inviteeId: string
): Promise<{ teamId: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new MembershipError('Team name is required.', 'invalid');

  const [req, inv] = await Promise.all([
    prisma.participant.findUnique({ where: { id: requesterId }, select: { sessionId: true, teamId: true } }),
    prisma.participant.findUnique({ where: { id: inviteeId }, select: { sessionId: true, teamId: true } }),
  ]);
  if (!req || !inv) throw new MembershipError('Not found.', 'not_found');
  if (req.teamId || inv.teamId) throw new MembershipError('One of you is already on a team.', 'busy');
  if (req.sessionId !== sessionId || inv.sessionId !== sessionId) {
    throw new MembershipError('Cross-session.', 'invalid');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { sessionId, name: trimmed }, select: { id: true } });
      // Requester first so on a clash the requester's answer is the one kept.
      await rekeyAnswers(tx, sessionId, `solo:${requesterId}`, `team:${team.id}`, team.id);
      await rekeyAnswers(tx, sessionId, `solo:${inviteeId}`, `team:${team.id}`, team.id);
      await tx.participant.updateMany({
        where: { id: { in: [requesterId, inviteeId] } },
        data: { teamId: team.id },
      });
      return { teamId: team.id };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
      throw new MembershipError('That team name is already taken — pick another.', 'name_taken');
    }
    throw err;
  }
}
