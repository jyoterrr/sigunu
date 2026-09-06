import 'node:process';

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

  livekit: {
    url: required('LIVEKIT_URL'),
    apiKey: required('LIVEKIT_API_KEY'),
    apiSecret: required('LIVEKIT_API_SECRET'),
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: optional('ANTHROPIC_MODEL', 'claude-opus-4-8'),
  },

  redisUrl: process.env.REDIS_URL,
};

export type Env = typeof env;
