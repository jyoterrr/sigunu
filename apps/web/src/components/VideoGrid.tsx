import { useMemo } from 'react';
import type { Participant } from 'livekit-client';
import type { ParticipantView } from '@sigunu/shared';
import { VideoTile } from './VideoTile';

/**
 * Two views (Section 6 example):
 *  - "focus": show only the quiz master (large). Other participants' video is NOT
 *    mounted, so it is never subscribed — decode cost stays near zero.
 *  - "grid": show everyone; each tile subscribes only while on-screen.
 *
 * In the grid, `onInvite` (Round 2 §4) adds an "Invite to team" button on eligible
 * tiles — solo players other than yourself who haven't left.
 */
export function VideoGrid({
  participants,
  roster,
  localId,
  view,
  onInvite,
}: {
  participants: Participant[];
  roster: ParticipantView[];
  localId: string;
  view: 'focus' | 'grid';
  onInvite?: (participantId: string) => void;
}) {
  const byId = useMemo(() => {
    const m = new Map<string, ParticipantView>();
    for (const r of roster) m.set(r.id, r);
    return m;
  }, [roster]);

  const hostId = roster.find((r) => r.role === 'quizmaster')?.id;

  const shown = useMemo(() => {
    if (view === 'focus') return participants.filter((p) => p.identity === hostId);
    return participants;
  }, [participants, view, hostId]);

  return (
    <div className={`grid grid-${view}`}>
      {shown.map((p) => {
        const rv = byId.get(p.identity);
        const canInvite =
          !!onInvite &&
          view === 'grid' &&
          p.identity !== localId &&
          rv?.role === 'player' &&
          !rv?.teamId &&
          rv?.status !== 'left';
        return (
          <div key={p.identity} className="grid-cell">
            <VideoTile
              participant={p}
              isLocal={p.identity === localId}
              label={(rv?.displayName ?? p.name ?? 'Guest') + (rv?.status === 'left' ? ' (left)' : '')}
            />
            {canInvite && (
              <button className="invite-btn" onClick={() => onInvite!(p.identity)}>+ Invite to team</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
