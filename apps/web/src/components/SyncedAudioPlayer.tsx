import { useEffect, useRef } from 'react';
import type { AudioControl, QuestionMedia } from '@sigunu/shared';
import { mediaSrc } from './QuestionMediaStage';

/**
 * Quiz-master-synchronized audio playback (Addendum §1). Renders a hidden <audio> per
 * audio clip and applies the host's latest play/pause command to all clients at once.
 * The host receives its own broadcast too, so it hears the clip alongside players.
 *
 * Sync: we seek to the host's reported position and play immediately on receipt. We do
 * NOT add "elapsed since server time" — client and server clocks aren't synchronized, so
 * that offset (clock skew) can be seconds off and pushes audio OUT of sync. Seeking to
 * the host's position on receipt keeps everyone within network jitter (~sub-second), and
 * we only re-seek when we're off by more than a small threshold so re-syncs don't stutter.
 */
const SYNC_THRESHOLD_SEC = 0.35;

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
      try {
        el.currentTime = control.positionSec;
      } catch {
        /* ignore */
      }
      return;
    }
    // action === 'play': align to the host's position, then play.
    if (Math.abs(el.currentTime - control.positionSec) > SYNC_THRESHOLD_SEC) {
      try {
        el.currentTime = control.positionSec;
      } catch {
        /* seeking may not be ready yet; play from current */
      }
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
