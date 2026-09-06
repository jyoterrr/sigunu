import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
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
      : 'application/octet-stream';
    reply.header('Content-Type', mime);
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
