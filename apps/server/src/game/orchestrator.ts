import type { QuestionResult, SessionPhase } from '@sigunu/shared';
import { prisma } from '../db/client.js';
import { computeLeaderboard } from '../leaderboard/leaderboard.js';
import { toQuizQuestion, toPublicQuestion } from './questions.js';
import { roomFor, type SigunuServer } from '../realtime/io.js';

/**
 * The host-driven quiz flow. Every state change is persisted then broadcast ONCE to
 * the session's Socket.IO room (fan-out to up to 100 clients in a single emit — no
 * per-client writes, no polling).
 */
export class Orchestrator {
  constructor(private io: SigunuServer) {}

  private async setPhase(sessionId: string, phase: SessionPhase) {
    await prisma.session.update({ where: { id: sessionId }, data: { phase } });
    this.io.to(roomFor(sessionId)).emit('session:phase', { phase });
  }

  /** Push a question to all players (correct answer withheld). Opens it for answers. */
  async pushQuestion(sessionId: string, questionId: string) {
    const row = await prisma.question.findFirstOrThrow({ where: { id: questionId, sessionId } });
    await prisma.session.update({
      where: { id: sessionId },
      data: { currentQuestionId: questionId, phase: 'question_open' },
    });
    const q = toQuizQuestion(row);
    this.io.to(roomFor(sessionId)).emit('session:phase', { phase: 'question_open' });
    this.io.to(roomFor(sessionId)).emit('question:pushed', toPublicQuestion(q));
    return q;
  }

  /** Stop accepting answers without revealing the key yet. */
  async lockQuestion(sessionId: string, questionId: string) {
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { currentQuestionId: true },
    });
    if (session.currentQuestionId !== questionId) throw new Error('Not the current question.');
    await this.setPhase(sessionId, 'question_locked');
  }

  /**
   * Reveal the correct answer, mark the question revealed (so it counts), recompute
   * the leaderboard, and broadcast both the result and the fresh board.
   */
  async reveal(sessionId: string, questionId: string): Promise<QuestionResult> {
    const q = await prisma.question.findFirstOrThrow({ where: { id: questionId, sessionId } });

    // Snapshot the board BEFORE this question counted, to compute per-question deltas.
    const before = await computeLeaderboard(sessionId);

    await prisma.question.update({
      where: { id: questionId },
      data: { revealed: true, revealedAt: new Date() },
    });
    await this.setPhase(sessionId, 'revealed');

    const after = await computeLeaderboard(sessionId);
    const beforeByKey = new Map(before.entries.map((e) => [e.key, e.score]));
    const deltas = after.entries.map((e) => ({
      key: e.key,
      delta: e.score - (beforeByKey.get(e.key) ?? 0),
    }));

    const result: QuestionResult = {
      questionId,
      correctOptionId: q.correctOptionId,
      deltas,
      leaderboard: after,
    };
    this.io.to(roomFor(sessionId)).emit('question:revealed', result);
    this.io.to(roomFor(sessionId)).emit('leaderboard:update', after);
    return result;
  }

  /** Clear the current question and return to a between-questions lobby state. */
  async next(sessionId: string) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { currentQuestionId: null, phase: 'lobby' },
    });
    this.io.to(roomFor(sessionId)).emit('session:phase', { phase: 'lobby' });
  }

  async end(sessionId: string) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { phase: 'ended', endedAt: new Date() },
    });
    this.io.to(roomFor(sessionId)).emit('session:phase', { phase: 'ended' });
    const board = await computeLeaderboard(sessionId);
    this.io.to(roomFor(sessionId)).emit('leaderboard:update', board);
  }

  async broadcastLeaderboard(sessionId: string) {
    const board = await computeLeaderboard(sessionId);
    this.io.to(roomFor(sessionId)).emit('leaderboard:update', board);
  }
}
