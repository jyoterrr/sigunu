import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';
import { env } from './env.js';
import { registerRoutes, UPLOADS_DIR } from './routes.js';
import { registerSocketHandlers } from './realtime/handlers.js';
import type { SigunuServer } from './realtime/io.js';

async function main() {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

  await app.register(cors, { origin: env.webOrigins, credentials: true });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } }); // videos can be large

  // Tolerate an empty JSON body (e.g. POST /api/sessions has no payload) instead of
  // 500-ing, which the default parser does for Content-Type: application/json + "".
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const s = (body as string).trim();
    if (!s) return done(null, {});
    try {
      done(null, JSON.parse(s));
    } catch (e) {
      done(e as Error);
    }
  });

  await registerRoutes(app);

  // Serve uploaded media (images/videos attached to questions).
  app.get('/uploads/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const safe = path.basename(name); // prevent traversal
    const full = path.join(UPLOADS_DIR, safe);
    try {
      await fs.access(full);
    } catch {
      return reply.code(404).send({ error: 'Not found.' });
    }
    const ext = path.extname(safe).toLowerCase();
    const mime =
      ext === '.mp4' ? 'video/mp4'
      : ext === '.webm' ? 'video/webm'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
      : ext === '.mp3' ? 'audio/mpeg'
      : ext === '.wav' ? 'audio/wav'
      : ext === '.ogg' ? 'audio/ogg'
      : ext === '.m4a' ? 'audio/mp4'
      : 'application/octet-stream';

    // Range support so audio/video can seek (needed for synced audio + video scrubbing).
    const size = statSync(full).size;
    const range = req.headers.range;
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', mime);

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size || end >= size) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }
      reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1);
      return reply.send(createReadStream(full, { start, end }));
    }

    reply.header('Content-Length', size);
    return reply.send(createReadStream(full));
  });

  // In production (single-service deploy), serve the built web app from this same
  // server so the whole app is one origin — no separate static host, no CORS.
  // WEB_DIST points at apps/web/dist; set by the Docker image / render.yaml.
  const webDist = process.env.WEB_DIST
    ? path.resolve(process.env.WEB_DIST)
    : path.resolve(process.cwd(), 'apps/web/dist');
  if (existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders: (res, filePath) => {
        // index.html must never be cached, or the browser keeps loading the old bundle
        // after a redeploy. Hashed assets (/assets/*) are content-addressed → cache hard.
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, must-revalidate');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
    // SPA fallback: any non-API GET returns index.html so client-side routing works.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/uploads') && !req.url.startsWith('/socket.io')) {
        return reply.header('Cache-Control', 'no-store, must-revalidate').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found.' });
    });
    app.log.info(`Serving web app from ${webDist}`);
  }

  await app.listen({ port: env.port, host: '0.0.0.0' });

  // Attach Socket.IO to Fastify's underlying HTTP server (shared port).
  const io: SigunuServer = new Server(app.server, {
    cors: { origin: env.webOrigins, credentials: true },
  });
  registerSocketHandlers(io);

  app.log.info(`Sigunu server + realtime listening on :${env.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
