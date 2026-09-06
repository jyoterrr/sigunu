import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma } from './db/client.js';
import {
  createSession,
  issueHostLiveKit,
  joinSession,
  JoinError,
} from './game/sessions.js';
import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  listQuestions,
  importQuestions,
  questionInputSchema,
} from './game/questions.js';
import { extractQuizFromPdf } from './ai/extract.js';
import { validateScoringConfig } from '@sigunu/shared';

export const UPLOADS_DIR = path.resolve(process.cwd(), 'apps/server/uploads');

/** Verify the caller holds the session's host token (Section: only host controls flow). */
async function requireHost(sessionId: string, hostToken: string | undefined): Promise<void> {
  if (!hostToken) throw new HttpError(401, 'Missing host token.');
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { hostToken: true },
  });
  if (!s || s.hostToken !== hostToken) throw new HttpError(403, 'Invalid host token.');
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function registerRoutes(app: FastifyInstance) {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  app.get('/api/health', async () => ({ ok: true }));

  // --- Session lifecycle ---
  app.post('/api/sessions', async () => createSession());

  app.post('/api/sessions/host-livekit', async (req) => {
    const body = z.object({ sessionId: z.string(), hostToken: z.string() }).parse(req.body);
    await requireHost(body.sessionId, body.hostToken);
    return issueHostLiveKit(body.sessionId);
  });

  app.post('/api/sessions/join', async (req, reply) => {
    const body = z
      .object({ joinCode: z.string(), displayName: z.string(), teamName: z.string().optional() })
      .parse(req.body);
    try {
      return await joinSession(body.joinCode, body.displayName, body.teamName);
    } catch (e) {
      if (e instanceof JoinError) return reply.code(e.code === 'team_taken' ? 409 : 400).send({ error: e.message });
      throw e;
    }
  });

  // --- Quiz config (Section 9 defaults + unanswered policy) ---
  app.put('/api/sessions/:id/config', async (req) => {
    const { id } = req.params as { id: string };
    await requireHost(id, hostTokenOf(req));
    const body = z
      .object({
        defaultCorrectPoints: z.number().int().positive(),
        defaultWrongPenalty: z.number().int().min(0),
        unansweredPolicy: z.enum(['zero', 'penalty']),
      })
      .parse(req.body);
    const err = validateScoringConfig({
      correctPoints: body.defaultCorrectPoints,
      wrongPenalty: body.defaultWrongPenalty,
    });
    if (err) throw new HttpError(400, err);
    await prisma.session.update({ where: { id }, data: body });
    return { ok: true };
  });

  // --- Quiz CRUD (manual builder + AI-import editor share this) ---
  app.get('/api/sessions/:id/questions', async (req) => {
    const { id } = req.params as { id: string };
    await requireHost(id, hostTokenOf(req));
    return { questions: await listQuestions(id) };
  });

  app.post('/api/sessions/:id/questions', async (req) => {
    const { id } = req.params as { id: string };
    await requireHost(id, hostTokenOf(req));
    const input = questionInputSchema.parse(req.body);
    return createQuestion(id, input);
  });

  app.put('/api/sessions/:id/questions/:qid', async (req) => {
    const { id, qid } = req.params as { id: string; qid: string };
    await requireHost(id, hostTokenOf(req));
    const input = questionInputSchema.parse(req.body);
    return updateQuestion(id, qid, input);
  });

  app.delete('/api/sessions/:id/questions/:qid', async (req) => {
    const { id, qid } = req.params as { id: string; qid: string };
    await requireHost(id, hostTokenOf(req));
    await deleteQuestion(id, qid);
    return { ok: true };
  });

  // --- Media upload for manual questions (multiple images/videos) ---
  app.post('/api/sessions/:id/media', async (req) => {
    const { id } = req.params as { id: string };
    await requireHost(id, hostTokenOf(req));
    const file = await (req as any).file();
    if (!file) throw new HttpError(400, 'No file uploaded.');
    const type = file.mimetype.startsWith('video/')
      ? 'video'
      : file.mimetype.startsWith('image/')
        ? 'image'
        : null;
    if (!type) throw new HttpError(400, 'Only image or video files are allowed.');

    const ext = path.extname(file.filename) || (type === 'video' ? '.mp4' : '.png');
    const name = `${id}-${nanoid(10)}${ext}`;
    const dest = path.join(UPLOADS_DIR, name);
    await fs.writeFile(dest, await file.toBuffer());
    return { id: nanoid(10), type, url: `/uploads/${name}` };
  });

  // --- AI PDF extraction (extraction only) ---
  app.post('/api/sessions/:id/extract-pdf', async (req) => {
    const { id } = req.params as { id: string };
    await requireHost(id, hostTokenOf(req));
    const file = await (req as any).file();
    if (!file || file.mimetype !== 'application/pdf') throw new HttpError(400, 'Upload a PDF file.');
    const buffer = await file.toBuffer();
    const result = await extractQuizFromPdf(buffer);
    // Insert as source=ai_pdf; the host reviews/edits before running.
    const imported = await importQuestions(id, result.questions);
    return { mode: result.mode, imported };
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.errors[0]?.message ?? 'Invalid input.' });
    req_log(reply, err);
    return reply.code(500).send({ error: 'Internal error.' });
  });
}

function hostTokenOf(req: { headers: Record<string, unknown> }): string | undefined {
  const h = req.headers['x-host-token'];
  return Array.isArray(h) ? h[0] : (h as string | undefined);
}

function req_log(reply: { log: { error: (e: unknown) => void } }, err: unknown) {
  reply.log.error(err);
}
