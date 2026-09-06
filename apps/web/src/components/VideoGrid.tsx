import { useMemo } from 'react';
import type { Participant } from 'livekit-client';
import type { ParticipantView } from '@sigunu/shared';
import { VideoTile } from './VideoTile';

/**
 * Two views (Section 6 example):
 *  - "focus": show only the quiz master (large). Other participants' video is NOT
 *    mounted, so it is never subscribed — decode cost stays near zero.
 *  - "grid": show everyone; each tile subscribes only while on-screen.
 */
export function VideoGrid({
  participants,
  roster,
  localId,
  view,
}: {
  participants: Participant[];
  roster: ParticipantView[];
  localId: string;
  view: 'focus' | 'grid';
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.id, r.displayName);
    return m;
  }, [roster]);

  const hostId = roster.find((r) => r.role === 'quizmaster')?.id;

  const shown = useMemo(() => {
    if (view === 'focus') return participants.filter((p) => p.identity === hostId);
    return participants;
  }, [participants, view, hostId]);

  return (
    <div className={`grid grid-${view}`}>
      {shown.map((p) => (
        <VideoTile
          key={p.identity}
          participant={p}
          isLocal={p.identity === localId}
          label={nameById.get(p.identity) ?? p.name ?? 'Guest'}
        />
      ))}
    </div>
  );
}
