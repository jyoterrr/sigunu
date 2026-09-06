import type { Leaderboard, LeaderboardEntry, ScoringConfig } from '@sigunu/shared';
import { prisma } from '../db/client.js';
import { scoreAnswer, effectiveScoring } from '../game/scoring.js';

/**
 * Recompute the full leaderboard for a session from all REVEALED questions.
 *
 * Subjects (Section 4): every team AND every solo player (a player with no team)
 * appear together on one ranked board, tagged team vs solo.
 *
 * Recompute-on-reveal is O(questions x answers) which is trivial at 100 players and
 * a normal quiz length; it avoids drift from incremental score bookkeeping. The
 * result is broadcast once to the whole Socket.IO room (single fan-out, no polling).
 */
export async function computeLeaderboard(sessionId: string): Promise<Leaderboard> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      defaultCorrectPoints: true,
      defaultWrongPenalty: true,
      unansweredPolicy: true,
    },
  });

  const sessionDefault: ScoringConfig = {
    correctPoints: session.defaultCorrectPoints,
    wrongPenalty: session.defaultWrongPenalty,
  };
  const unansweredPolicy = session.unansweredPolicy as 'zero' | 'penalty';

  const [teams, soloPlayers, revealedQuestions] = await Promise.all([
    prisma.team.findMany({ where: { sessionId }, select: { id: true, name: true } }),
    prisma.participant.findMany({
      // Exclude players who left the quiz — they should disappear from the board.
      where: { sessionId, role: 'player', teamId: null, status: { not: 'left' } },
      select: { id: true, displayName: true, status: true },
    }),
    prisma.question.findMany({
      where: { sessionId, revealed: true },
      select: {
        id: true,
        correctOptionId: true,
        correctPoints: true,
        wrongPenalty: true,
        hintCost: true,
      },
    }),
  ]);

  // Answers for revealed questions only, keyed by (questionId, lockKey).
  const answers = await prisma.lockedAnswer.findMany({
    where: { sessionId, questionId: { in: revealedQuestions.map((q) => q.id) } },
    select: { questionId: true, optionId: true, lockKey: true },
  });
  const answerByKey = new Map<string, string>(); // `${qid}|${lockKey}` -> optionId
  for (const a of answers) answerByKey.set(`${a.questionId}|${a.lockKey}`, a.optionId);

  // Initialise every subject at 0 so unanswered subjects still rank.
  const scores = new Map<string, LeaderboardEntry>();
  for (const t of teams) {
    scores.set(`team:${t.id}`, {
      key: `team:${t.id}`,
      kind: 'team',
      name: t.name,
      score: 0,
      rank: 0,
    });
  }
  for (const p of soloPlayers) {
    scores.set(`solo:${p.id}`, {
      key: `solo:${p.id}`,
      kind: 'solo',
      name: p.displayName,
      score: 0,
      rank: 0,
      left: p.status === 'left',
    });
  }

  for (const q of revealedQuestions) {
    const scoring = effectiveScoring(
      { correctPoints: q.correctPoints ?? undefined, wrongPenalty: q.wrongPenalty ?? undefined },
      sessionDefault
    );
    for (const entry of scores.values()) {
      const lockKey =
        entry.kind === 'team' ? `team:${entry.key.slice(5)}` : `solo:${entry.key.slice(5)}`;
      const lockedOptionId = answerByKey.get(`${q.id}|${lockKey}`) ?? null;
      entry.score += scoreAnswer({
        lockedOptionId,
        correctOptionId: q.correctOptionId,
        scoring,
        unansweredPolicy,
      });
    }
  }

  // Hint penalties (Round 2 §hint): each subject that revealed a revealed question's
  // hint loses that question's hintCost.
  const hintCostByQ = new Map(revealedQuestions.map((q) => [q.id, q.hintCost ?? 0]));
  const hintReveals = await prisma.hintReveal.findMany({
    where: { sessionId, questionId: { in: revealedQuestions.map((q) => q.id) } },
    select: { questionId: true, subjectKey: true },
  });
  for (const hr of hintReveals) {
    const entry = scores.get(hr.subjectKey);
    const cost = hintCostByQ.get(hr.questionId) ?? 0;
    if (entry && cost) entry.score -= cost;
  }

  // Apply manual score overrides (Addendum §2): sum active adjustments per subject,
  // on top of the automatic scoring. These may be positive or negative.
  const adjustments = await prisma.scoreAdjustment.findMany({
    where: { sessionId, active: true },
    select: { subjectKey: true, delta: true },
  });
  for (const adj of adjustments) {
    const entry = scores.get(adj.subjectKey);
    if (entry) entry.score += adj.delta;
  }

  const entries = [...scores.values()].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name)
  );
  // Standard competition ranking (1,2,2,4).
  let lastScore: number | null = null;
  let lastRank = 0;
  entries.forEach((e, i) => {
    if (e.score === lastScore) {
      e.rank = lastRank;
    } else {
      e.rank = i + 1;
      lastRank = e.rank;
      lastScore = e.score;
    }
  });

  return { entries, updatedAt: new Date().toISOString() };
}
