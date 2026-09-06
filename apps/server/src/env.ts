import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load the repo-root .env (this file lives at apps/server/src/env.ts). The server
// runs from apps/server, so the root .env would otherwise not be picked up. Also
// try the current working directory. Both are best-effort — missing files are fine.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const candidate of [path.resolve(here, '../../../.env'), path.resolve(process.cwd(), '.env')]) {
  try {
    process.loadEnvFile(candidate);
  } catch {
    /* no .env at this location — ignore */
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  port: Number(optional('PORT', '4000')),
  webOrigins: optional('WEB_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),

  // LiveKit is OPTIONAL: without keys the server still boots and the full quiz flow
  // (join, teams, questions, locking, leaderboard over Socket.IO) works — only
  // video/audio is disabled. Add keys to enable LiveKit.
  livekit: {
    url: optional('LIVEKIT_URL', ''),
    apiKey: optional('LIVEKIT_API_KEY', ''),
    apiSecret: optional('LIVEKIT_API_SECRET', ''),
  },
  get livekitEnabled(): boolean {
    return Boolean(this.livekit.url && this.livekit.apiKey && this.livekit.apiSecret);
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: optional('ANTHROPIC_MODEL', 'claude-opus-4-8'),
  },

  redisUrl: process.env.REDIS_URL,
};

export type Env = typeof env;
