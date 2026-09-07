import { useEffect, useRef } from 'react';
import type { AudioControl, QuestionMedia } from '@sigunu/shared';

export const MEDIA_BASE = import.meta.env.VITE_API_URL || '';
export const mediaSrc = (url: string) => (url.startsWith('http') ? url : `${MEDIA_BASE}${url}`);

/**
 * How this stage's video behaves:
 *  - 'preview' (builder): native controls, local only, no sync.
 *  - 'synced'  (host + participants): NO native controls — the element only follows the
 *    host's play/pause control messages. The host drives it with explicit buttons that
 *    the host page provides (gated on device readiness); everyone, host included, follows
 *    the same broadcast so they stay together. No seeking (never skip buffered content).
 */
export type VideoMode = 'preview' | 'synced';

/**
 * Renders a question's visual media identically for the builder preview and every player
 * (Addendum §1). Images are positioned in a fixed 16:9 stage using normalized transforms,
 * so the collage looks the same on every screen. A single optional video renders below,
 * host-controlled and synced (Round 2). Audio is handled by the parent.
 */
export function QuestionMediaStage({
  media,
  className,
  videoMode = 'synced',
  videoControl = null,
}: {
  media: QuestionMedia[];
  className?: string;
  videoMode?: VideoMode;
  videoControl?: AudioControl | null;
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
      {video && <QuestionVideo media={video} mode={videoMode} control={videoControl} />}
    </div>
  );
}

function QuestionVideo({
  media,
  mode,
  control,
}: {
  media: QuestionMedia;
  mode: VideoMode;
  control: AudioControl | null;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  // Follow the host's play/pause — no seeking (never skip buffered content). Auto-starts
  // once the browser is unlocked; the host page drives it with its own buttons.
  useEffect(() => {
    if (mode !== 'synced') return;
    const el = ref.current;
    if (!el || !control || control.mediaId !== media.id) return;
    if (control.action === 'play') {
      el.play().catch(() => {
        /* still locked; a subsequent tap unlocks it via mediaAutoplay */
      });
    } else {
      el.pause();
    }
  }, [control, media.id, mode]);

  return (
    <div className="stage-video-wrap">
      <video
        ref={ref}
        className="stage-video-el"
        src={mediaSrc(media.url)}
        poster={media.posterUrl}
        playsInline
        controls={mode === 'preview'}
      />
    </div>
  );
}
