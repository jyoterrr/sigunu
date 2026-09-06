import type { ScoreAdjustment } from '@sigunu/shared';
import { prisma } from '../db/client.js';

/**
 * Manual score overrides (Addendum §2). Host-only (guarded at the socket/REST layer).
 * `delta` may be any integer — positive or negative — deliberately; the
 * "award positive / penalty non-negative" rule applies only to automatic scoring.
 */

export class AdjustmentError extends Error {
  constructor(message: string, readonly code: 'bad_subject' | 'bad_delta' | 'not_found') {
    super(message);
  }
}

/** Resolve a leaderboard subject key to a display name, validating it exists. */
async function resolveSubjectName(sessionId: string, subjectKey: string): Promise<string> {
  if (subjectKey.startsWith('team:')) {
    const team = await prisma.team.findFirst({
      where: { id: subjectKey.slice(5), sessionId },
      select: { name: true },
    });
    if (!team) throw new AdjustmentError('Unknown team.', 'bad_subject');
    return team.name;
  }
  if (subjectKey.startsWith('solo:')) {
    const p = await prisma.participant.findFirst({
      where: { id: subjectKey.slice(5), sessionId, teamId: null, role: 'player' },
      select: { displayName: true },
    });
    if (!p) throw new AdjustmentError('Unknown solo player.', 'bad_subject');
    return p.displayName;
  }
  throw new AdjustmentError('Subject must be a team or solo player.', 'bad_subject');
}

export async function applyAdjustment(params: {
  sessionId: string;
  subjectKey: string;
  delta: number;
  reason?: string;
}): Promise<ScoreAdjustment> {
  const { sessionId, subjectKey, delta, reason } = params;
  if (!Number.isInteger(delta) || delta === 0) {
    throw new AdjustmentError('Adjustment must be a non-zero whole number.', 'bad_delta');
  }
  const subjectName = await resolveSubjectName(sessionId, subjectKey);
  const row = await prisma.scoreAdjustment.create({
    data: { sessionId, subjectKey, subjectName, delta, reason: reason?.trim() || null },
  });
  return toDto(row);
}

/** Undo = mark inactive (kept in the audit log). */
export async function undoAdjustment(sessionId: string, adjustmentId: string): Promise<void> {
  const row = await prisma.scoreAdjustment.findFirst({ where: { id: adjustmentId, sessionId } });
  if (!row) throw new AdjustmentError('Adjustment not found.', 'not_found');
  await prisma.scoreAdjustment.update({ where: { id: adjustmentId }, data: { active: false } });
}

/** Full host-only audit log, newest first. */
export async function listAdjustments(sessionId: string): Promise<ScoreAdjustment[]> {
  const rows = await prisma.scoreAdjustment.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toDto);
}

function toDto(row: {
  id: string;
  subjectKey: string;
  subjectName: string;
  delta: number;
  reason: string | null;
  active: boolean;
  createdAt: Date;
}): ScoreAdjustment {
  return {
    id: row.id,
    subjectKey: row.subjectKey,
    subjectName: row.subjectName,
    delta: row.delta,
    reason: row.reason,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}
