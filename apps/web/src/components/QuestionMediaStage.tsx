import { useEffect, useRef, useState } from 'react';
import type { AudioControl, QuestionMedia } from '@sigunu/shared';

export const MEDIA_BASE = import.meta.env.VITE_API_URL || '';
export const mediaSrc = (url: string) => (url.startsWith('http') ? url : `${MEDIA_BASE}${url}`);

const SYNC_THRESHOLD_SEC = 0.4;

/**
 * How this stage's video behaves:
 *  - 'preview'     (builder): native controls, local only, no sync.
 *  - 'host'        : native controls; the host's play/pause/seek broadcast to everyone
 *                    (via `onControl`) so participants follow. Host drives, doesn't follow.
 *  - 'participant' : NO controls — participants can't play/pause; the element just follows
 *                    the host's synchronized control messages.
 */
export type VideoMode = 'preview' | 'host' | 'participant';

/**
 * Renders a question's visual media identically for the builder preview and every player
 * (Addendum §1). Images are positioned in a fixed 16:9 stage using normalized transforms,
 * so the collage looks the same on every screen. A single optional video renders below,
 * host-controlled and synced (Round 2). Audio is handled by the parent.
 */
export function QuestionMediaStage({
  media,
  className,
  videoMode = 'participant',
  videoControl = null,
  onVideoControl,
}: {
  media: QuestionMedia[];
  className?: string;
  videoMode?: VideoMode;
  videoControl?: AudioControl | null;
  onVideoControl?: (mediaId: string, action: 'play' | 'pause', positionSec: number) => void;
}) {
  const images = media.filter((m) => m.kind === 'image');
  const video = media.find((m) => m.kind === 'video');

  if (images.length === 0 && !video) return null;

  return (
    <div className={className}>
      {images.length > 0 && (
        <div className="media-stage">
          {[...images]
            .sort((a, b) => (a.transform?.z ?? 0) - (b.transform?.z ?? 0))
            .map((m) => {
              const t = m.transform;
              return (
                <img
                  key={m.id}
                  src={mediaSrc(m.url)}
                  alt={m.caption ?? ''}
                  className="stage-img"
                  style={{
                    left: `${t?.xPct ?? 25}%`,
                    top: `${t?.yPct ?? 25}%`,
                    width: `${t?.widthPct ?? 50}%`,
                    transform: `rotate(${t?.rotationDeg ?? 0}deg)`,
                    zIndex: t?.z ?? 0,
                  }}
                />
              );
            })}
        </div>
      )}
      {video && (
        <QuestionVideo
          media={video}
          mode={videoMode}
          control={videoControl}
          onControl={onVideoControl}
        />
      )}
    </div>
  );
}

function QuestionVideo({
  media,
  mode,
  control,
  onControl,
}: {
  media: QuestionMedia;
  mode: VideoMode;
  control: AudioControl | null;
  onControl?: (mediaId: string, action: 'play' | 'pause', positionSec: number) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);

  // Participants follow the host's synchronized control messages.
  useEffect(() => {
    if (mode !== 'participant') return;
    const el = ref.current;
    if (!el || !control || control.mediaId !== media.id) return;
    if (Math.abs(el.currentTime - control.positionSec) > SYNC_THRESHOLD_SEC) {
      try {
        el.currentTime = control.positionSec;
      } catch {
        /* ignore */
      }
    }
    if (control.action === 'play') {
      el.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
    } else {
      el.pause();
      setNeedsTap(false);
    }
  }, [control, media.id, mode]);

  // Host broadcasts its play/pause/seek so participants stay in sync.
  const emit = () => {
    if (mode !== 'host' || !onControl) return;
    const el = ref.current;
    if (!el) return;
    onControl(media.id, el.paused ? 'pause' : 'play', el.currentTime);
  };
  useEffect(() => {
    if (mode !== 'host' || !onControl) return;
    const iv = setInterval(() => {
      const el = ref.current;
      if (el && !el.paused) emit();
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, onControl, media.id]);

  const controllable = mode === 'preview' || mode === 'host';

  return (
    <div className="stage-video-wrap">
      <video
        ref={ref}
        className="stage-video-el"
        src={mediaSrc(media.url)}
        poster={media.posterUrl}
        playsInline
        controls={controllable}
        onPlay={mode === 'host' ? emit : undefined}
        onPause={mode === 'host' ? emit : undefined}
        onSeeked={mode === 'host' ? emit : undefined}
      />
      {needsTap && (
        <button
          className="video-tap-play"
          onClick={() => ref.current?.play().then(() => setNeedsTap(false)).catch(() => {})}
        >
          ▶ Tap to play (synced)
        </button>
      )}
    </div>
  );
}
