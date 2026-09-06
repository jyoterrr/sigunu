/** Lightweight per-session credential storage (no accounts — Section: auth). */
export interface PlayerCreds {
  sessionId: string;
  participantId: string;
  token: string;
  livekit: { url: string; token: string; roomName: string };
  displayName: string;
  teamId: string | null;
}

export interface HostCreds {
  sessionId: string;
  hostToken: string;
  joinCode: string;
}

const key = (kind: string, id: string) => `sigunu:${kind}:${id}`;

export const creds = {
  saveHost: (c: HostCreds) => sessionStorage.setItem(key('host', c.sessionId), JSON.stringify(c)),
  loadHost: (sessionId: string): HostCreds | null => {
    const raw = sessionStorage.getItem(key('host', sessionId));
    return raw ? (JSON.parse(raw) as HostCreds) : null;
  },
  savePlayer: (c: PlayerCreds) => sessionStorage.setItem(key('play', c.sessionId), JSON.stringify(c)),
  loadPlayer: (sessionId: string): PlayerCreds | null => {
    const raw = sessionStorage.getItem(key('play', sessionId));
    return raw ? (JSON.parse(raw) as PlayerCreds) : null;
  },
};
