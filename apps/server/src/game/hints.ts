import { prisma } from '../db/client.js';
import { lockKeyFor } from './locking.js';

export class HintError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'no_hint' | 'not_open') {
    super(message);
  }
}

/**
 * Reveal a question's hint for the caller's subject (Round 2 §hint). Charges the
 * subject the question's hintCost (applied in the leaderboard). Team-scoped: one
 * teammate revealing charges the whole team and teammates all see it. Idempotent —
 * revealing again returns the text without double-charging (unique reveal per subject).
 */
export async function revealHint(
  sessionId: string,
  participantId: string,
  questionId: string
): Promise<{ hint: string; subjectKey: string; teamId: string | null }> {
  const [session, participant, question] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, select: { currentQuestionId: true } }),
    prisma.participant.findUnique({ where: { id: participantId }, select: { teamId: true, sessionId: true } }),
    prisma.question.findUnique({ where: { id: questionId }, select: { sessionId: true, hint: true } }),
  ]);
  if (!session || !participant || !question) throw new HintError('Not found.', 'not_found');
  if (participant.sessionId !== sessionId || question.sessionId !== sessionId) {
    throw new HintError('Cross-session.', 'not_found');
  }
  if (!question.hint) throw new HintError('This question has no hint.', 'no_hint');
  if (session.currentQuestionId !== questionId) {
    throw new HintError('The hint is only available while the question is live.', 'not_open');
  }

  const subjectKey = lockKeyFor(participant.teamId, participantId);
  // Record the reveal once per subject (charge applied in the leaderboard).
  await prisma.hintReveal.upsert({
    where: { sessionId_questionId_subjectKey: { sessionId, questionId, subjectKey } },
    create: { sessionId, questionId, subjectKey },
    update: {},
  });

  return { hint: question.hint, subjectKey, teamId: participant.teamId };
}
