import { useEffect, useRef } from 'react';
import type { AudioControl, QuestionMedia } from '@sigunu/shared';
import { mediaSrc } from './QuestionMediaStage';

/**
 * Quiz-master-synchronized audio playback (Addendum §1). Renders a hidden <audio> per
 * audio clip and applies the host's latest play/pause command to all clients at once.
 * Playback position is corrected for network delay using the server timestamp so
 * everyone stays roughly in sync. The host receives its own broadcast too, so it hears
 * the clip alongside players.
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
      el.currentTime = control.positionSec;
      return;
    }
    // action === 'play': correct for the delay since the host issued the command.
    const driftSec = Math.max(0, (Date.now() - control.atServerTime) / 1000);
    try {
      el.currentTime = control.positionSec + driftSec;
    } catch {
      /* seeking may not be ready yet; play from current */
    }
    void el.play().catch(() => {
      /* browser blocked autoplay; the viewer can still hit play if we expose a control */
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
            if (el) refs.current.set(a.id, el);
            else refs.current.delete(a.id);
          }}
        />
      ))}
    </>
  );
}
