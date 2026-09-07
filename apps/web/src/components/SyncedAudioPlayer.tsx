import { useEffect, useRef } from 'react';
import type { AudioControl, QuestionMedia } from '@sigunu/shared';
import { mediaSrc } from './QuestionMediaStage';

/**
 * Quiz-master-synchronized audio playback (Addendum §1). Renders a hidden <audio> per
 * audio clip and applies the host's play/pause command to all clients. The host receives
 * its own broadcast too, so it hears the clip alongside players.
 *
 * Priority is completeness over exact host-sync (per request): we DON'T seek to the
 * host's position. Host "play" just plays; host "pause" just pauses. So a participant
 * whose audio buffered still hears the whole clip (slightly behind) rather than skipping
 * ahead to match the host. Because everyone starts on the same broadcast, participants
 * stay roughly in sync with each other. Playback needs the browser unlocked first — see
 * mediaAutoplay (unlocked on the participant's taps).
 */
export function SyncedAudioPlayer({
  audios,
  control,
}: {
  audios: QuestionMedia[];
  control: AudioControl | null;
}) {
  const refs = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    if (!control) return;
    const el = refs.current.get(control.mediaId);
    if (!el) return;

    // Pause every other clip first (only one plays at a time).
    for (const [id, other] of refs.current) if (id !== control.mediaId) other.pause();

    if (control.action === 'pause') {
      el.pause();
      return;
    }
    // action === 'play': just play (no seek — never skip buffered content).
    void el.play().catch(() => {
      /* still locked; a subsequent tap unlocks it via mediaAutoplay */
    });
  }, [control]);

  return (
    <>
      {audios.map((a) => (
        <audio
          key={a.id}
          src={mediaSrc(a.url)}
          preload="auto"
          ref={(el) => {
            if (el) {
              refs.current.set(a.id, el);
              // Force eager buffering — mobile browsers otherwise lazy-load audio, which
              // delays readiness and makes the host's first Play have to load-then-play.
              try {
                el.load();
              } catch {
                /* ignore */
              }
            } else {
              refs.current.delete(a.id);
            }
          }}
        />
      ))}
    </>
  );
}
