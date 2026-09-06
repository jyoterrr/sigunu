import { useEffect, useRef } from 'react';
import type { RemoteAudioEntry } from '../livekit/useLiveKit';

/**
 * Plays every subscribed remote audio track (Section 2 fix). Each track is attached to
 * a hidden <audio> element. Without this, published mic audio was never rendered.
 */
export function AudioRenderer({ tracks }: { tracks: RemoteAudioEntry[] }) {
  return (
    <div style={{ display: 'none' }} aria-hidden>
      {tracks.map((e) => (
        <AudioSink key={e.id} entry={e} />
      ))}
    </div>
  );
}

function AudioSink({ entry }: { entry: RemoteAudioEntry }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    entry.track.attach(el);
    el.play().catch(() => {
      /* autoplay blocked — the EnableAudio button calls room.startAudio() */
    });
    return () => {
      entry.track.detach(el);
    };
  }, [entry]);
  return <audio ref={ref} autoPlay />;
}

/** Shown when the browser blocks audio playback; a click unblocks it. */
export function EnableAudioBanner({ show, onEnable }: { show: boolean; onEnable: () => void }) {
  if (!show) return null;
  return (
    <button className="enable-audio" onClick={onEnable}>
      🔊 Tap to enable audio
    </button>
  );
}
