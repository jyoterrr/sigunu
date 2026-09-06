import type { LockedAnswer } from '@sigunu/shared';
import { prisma, PRISMA_UNIQUE_VIOLATION } from '../db/client.js';
import { Prisma } from '@prisma/client';

export class LockError extends Error {
  constructor(
    message: string,
    readonly code: 'not_open' | 'already_locked' | 'bad_option' | 'not_found'
  ) {
    super(message);
  }
}

/**
 * Compute the scoring subject key for a participant (Section 3/4):
 *   team member => "team:<teamId>"  (whole team shares one answer)
 *   solo player => "solo:<participantId>"
 */
export function lockKeyFor(teamId: string | null, participantId: string): string {
  return teamId ? `team:${teamId}` : `solo:${participantId}`;
}

/**
 * Attempt to lock an answer for the current question.
 *
 * Race-safety (Section 3): two teammates can call this within milliseconds. We do
 * NOT check-then-insert in app code (that races). Instead we rely on the unique
 * index (sessionId, questionId, lockKey): the FIRST insert wins; any concurrent
 * second insert for the same subject throws P2002, which we translate into a clean
 * "already locked" result that returns the winning answer. Enforced by the database,
 * not the client.
 */
export async function lockAnswer(params: {
  sessionId: string;
  participantId: string;
  questionId: string;
  optionId: string;
}): Promise<{ answer: LockedAnswer; wasFirst: boolean }> {
  const { sessionId, participantId, questionId, optionId } = params;

  const [session, participant, question] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { phase: true, currentQuestionId: true },
    }),
    prisma.participant.findUnique({
      where: { id: participantId },
      select: { id: true, teamId: true, sessionId: true },
    }),
    prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, sessionId: true, options: true },
    }),
  ]);

  if (!session || !participant || !question) throw new LockError('Not found', 'not_found');
  if (participant.sessionId !== sessionId || question.sessionId !== sessionId) {
    throw new LockError('Cross-session', 'not_found');
  }
  // Answers accepted only while the current question is open.
  if (session.phase !== 'question_open' || session.currentQuestionId !== questionId) {
    throw new LockError('This question is not open for answers.', 'not_open');
  }
  // Option must exist on the question (server-side validation; never trust the client).
  const options = question.options as { id: string; text: string }[];
  if (!options.some((o) => o.id === optionId)) {
    throw new LockError('Unknown option for this question.', 'bad_option');
  }

  const lockKey = lockKeyFor(participant.teamId, participant.id);

  try {
    const created = await prisma.lockedAnswer.create({
      data: {
        sessionId,
        questionId,
        optionId,
        lockedByParticipantId: participant.id,
        teamId: participant.teamId,
        lockKey,
      },
      select: {
        questionId: true,
        optionId: true,
        lockedByParticipantId: true,
        teamId: true,
        lockedAt: true,
      },
    });
    return { answer: toDto(created), wasFirst: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
      // Someone in this subject already locked. Return the winning answer.
      const existing = await prisma.lockedAnswer.findUniqueOrThrow({
        where: { sessionId_questionId_lockKey: { sessionId, questionId, lockKey } },
        select: {
          questionId: true,
          optionId: true,
          lockedByParticipantId: true,
          teamId: true,
          lockedAt: true,
        },
      });
      return { answer: toDto(existing), wasFirst: false };
    }
    throw err;
  }
}

function toDto(row: {
  questionId: string;
  optionId: string;
  lockedByParticipantId: string;
  teamId: string | null;
  lockedAt: Date;
}): LockedAnswer {
  return {
    questionId: row.questionId,
    optionId: row.optionId,
    lockedByParticipantId: row.lockedByParticipantId,
    teamId: row.teamId,
    lockedAt: row.lockedAt.toISOString(),
  };
}

/** The answer already locked for a participant's subject on a question, if any. */
export async function getLockedAnswer(
  sessionId: string,
  questionId: string,
  teamId: string | null,
  participantId: string
): Promise<LockedAnswer | null> {
  const lockKey = lockKeyFor(teamId, participantId);
  const row = await prisma.lockedAnswer.findUnique({
    where: { sessionId_questionId_lockKey: { sessionId, questionId, lockKey } },
    select: {
      questionId: true,
      optionId: true,
      lockedByParticipantId: true,
      teamId: true,
      lockedAt: true,
    },
  });
  return row ? toDto(row) : null;
}
