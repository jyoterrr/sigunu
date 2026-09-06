import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { statSync } from 'node:fs';
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
