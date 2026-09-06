import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { validateScoringConfig, validateQuestionMedia } from '@sigunu/shared';
import type { QuizQuestion, PublicQuestion, QuestionMedia, QuizOption } from '@sigunu/shared';

const transformSchema = z.object({
  xPct: z.number(),
  yPct: z.number(),
  widthPct: z.number(),
  rotationDeg: z.number(),
  z: z.number(),
});

const mediaSchema = z.object({
  id: z.string().default(() => nanoid(10)),
  kind: z.enum(['image', 'video', 'audio']),
  url: z.string().min(1),
  posterUrl: z.string().optional(),
  caption: z.string().optional(),
  transform: transformSchema.optional(),
});

const optionSchema = z.object({
  id: z.string().default(() => nanoid(8)),
  text: z.string().min(1, 'Option text is required.'),
});

/** Shape accepted from the manual builder / AI-import editor. */
export const questionInputSchema = z
  .object({
    text: z.string().min(1, 'Question text is required.'),
    media: z.array(mediaSchema).default([]),
    options: z.array(optionSchema).min(2, 'A question needs at least two options.'),
    correctOptionId: z.string().nullable().default(null),
    correctPoints: z.number().int().positive().nullable().default(null),
    wrongPenalty: z.number().int().min(0).nullable().default(null),
    timeLimitSec: z.number().int().positive().nullable().default(null),
    hint: z.string().nullable().default(null),
    hintCost: z.number().int().min(0).default(0),
    source: z.enum(['manual', 'ai_pdf']).default('manual'),
  })
  .refine(
    (q) => q.correctOptionId == null || q.options.some((o) => o.id === q.correctOptionId),
    { message: 'correctOptionId must reference one of the options.', path: ['correctOptionId'] }
  )
  .refine(
    (q) =>
      q.correctPoints == null ||
      q.wrongPenalty == null ||
      validateScoringConfig({ correctPoints: q.correctPoints, wrongPenalty: q.wrongPenalty }) === null,
    { message: 'Invalid per-question scoring.', path: ['correctPoints'] }
  )
  .refine((q) => validateQuestionMedia(q.media as never) === null, {
    message: 'A question can have at most one video.',
    path: ['media'],
  });

export type QuestionInput = z.infer<typeof questionInputSchema>;

export async function createQuestion(sessionId: string, input: QuestionInput): Promise<QuizQuestion> {
  const max = await prisma.question.aggregate({
    where: { sessionId },
    _max: { order: true },
  });
  const order = (max._max.order ?? 0) + 1;
  const row = await prisma.question.create({
    data: {
      sessionId,
      order,
      text: input.text,
      media: JSON.stringify(input.media),
      options: JSON.stringify(input.options),
      correctOptionId: input.correctOptionId,
      correctPoints: input.correctPoints,
      wrongPenalty: input.wrongPenalty,
      timeLimitSec: input.timeLimitSec,
      hint: input.hint,
      hintCost: input.hintCost,
      source: input.source,
    },
  });
  return toQuizQuestion(row);
}

export async function updateQuestion(
  sessionId: string,
  questionId: string,
  input: QuestionInput
): Promise<QuizQuestion> {
  const row = await prisma.question.update({
    where: { id: questionId },
    data: {
      text: input.text,
      media: JSON.stringify(input.media),
      options: JSON.stringify(input.options),
      correctOptionId: input.correctOptionId,
      correctPoints: input.correctPoints,
      wrongPenalty: input.wrongPenalty,
      timeLimitSec: input.timeLimitSec,
      hint: input.hint,
      hintCost: input.hintCost,
    },
  });
  if (row.sessionId !== sessionId) throw new Error('Question not in this session.');
  return toQuizQuestion(row);
}

export async function deleteQuestion(sessionId: string, questionId: string): Promise<void> {
  await prisma.question.deleteMany({ where: { id: questionId, sessionId } });
}

export async function listQuestions(sessionId: string): Promise<QuizQuestion[]> {
  const rows = await prisma.question.findMany({
    where: { sessionId },
    orderBy: { order: 'asc' },
  });
  return rows.map(toQuizQuestion);
}

/** Bulk-insert AI-extracted questions (source=ai_pdf); host reviews/edits after. */
export async function importQuestions(
  sessionId: string,
  inputs: QuestionInput[]
): Promise<QuizQuestion[]> {
  const created: QuizQuestion[] = [];
  for (const input of inputs) {
    created.push(await createQuestion(sessionId, { ...input, source: 'ai_pdf' }));
  }
  return created;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toQuizQuestion(row: any): QuizQuestion {
  return {
    id: row.id,
    order: row.order,
    text: row.text,
    media: parseJson<QuestionMedia[]>(row.media, []),
    options: parseJson<QuizOption[]>(row.options, []),
    correctOptionId: row.correctOptionId,
    scoring:
      row.correctPoints != null && row.wrongPenalty != null
        ? { correctPoints: row.correctPoints, wrongPenalty: row.wrongPenalty }
        : null,
    timeLimitSec: row.timeLimitSec,
    hint: row.hint ?? null,
    hintCost: row.hintCost ?? 0,
  };
}

/** Strip the correct answer AND the hint text for player-facing payloads. */
export function toPublicQuestion(q: QuizQuestion): PublicQuestion {
  const { correctOptionId, hint, ...rest } = q;
  void correctOptionId;
  return { ...rest, hasHint: !!hint };
}
