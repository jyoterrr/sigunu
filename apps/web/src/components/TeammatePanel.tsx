import { useMemo } from 'react';
import type { Participant } from 'livekit-client';
import type { ParticipantView } from '@sigunu/shared';
import { VideoTile } from './VideoTile';

/**
 * Right-side teammate panel (Addendum §3): up to 2 windows showing the player's own
 * teammates — the 2 MOST-RECENTLY-ACTIVE speakers on the team-only channel. Recency
 * comes from LiveKit active-speaker events; whoever has gone longest without speaking
 * is evicted first. A teammate with camera on shows live video; camera off shows an
 * avatar that glows while they're speaking. Hidden entirely for solo players.
 */
export function TeammatePanel({
  teammates,
  participants,
  speakingIds,
  speakerRecency,
}: {
  teammates: ParticipantView[]; // my team, excluding me
  participants: Participant[];
  speakingIds: Set<string>;
  speakerRecency: string[];
}) {
  const byId = useMemo(() => {
    const m = new Map<string, Participant>();
    for (const p of participants) m.set(p.identity, p);
    return m;
  }, [participants]);

  // Order teammates: most-recently-active speakers first, then the rest; take 2.
  const shown = useMemo(() => {
    const rank = (id: string) => {
      const i = speakerRecency.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...teammates].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, 2);
  }, [teammates, speakerRecency]);

  if (teammates.length === 0) return null; // solo players have no teammates

  return (
    <div className="teammate-panel">
      <div className="control-label">Team</div>
      {shown.map((t) => {
        const p = byId.get(t.id);
        const speaking = speakingIds.has(t.id);
        return (
          <div key={t.id} className={`teammate-window ${speaking ? 'speaking' : ''}`}>
            {p ? (
              <VideoTile participant={p} label={t.displayName} />
            ) : (
              <div className="tile">
                <div className="tile-avatar">{t.displayName.slice(0, 1).toUpperCase()}</div>
                <span className="tile-label">{t.displayName}</span>
              </div>
            )}
            {speaking && <span className="speaking-dot" title="speaking">🎙</span>}
          </div>
        );
      })}
    </div>
  );
}
