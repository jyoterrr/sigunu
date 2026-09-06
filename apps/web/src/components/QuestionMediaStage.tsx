import type { QuestionMedia } from '@sigunu/shared';

export const MEDIA_BASE = import.meta.env.VITE_API_URL || '';
export const mediaSrc = (url: string) => (url.startsWith('http') ? url : `${MEDIA_BASE}${url}`);

/**
 * Renders a question's visual media identically for the builder preview and every
 * player (Addendum §1). Images are positioned in a fixed 16:9 stage using normalized
 * transforms (xPct/yPct/widthPct/rotationDeg/z), so the collage looks the same on
 * every screen. A single optional video renders below the collage. Audio is handled
 * by the parent (host-synced playback / builder preview), not here.
 */
export function QuestionMediaStage({ media, className }: { media: QuestionMedia[]; className?: string }) {
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
        <video className="stage-video-el" src={mediaSrc(video.url)} poster={video.posterUrl} controls playsInline />
      )}
    </div>
  );
}
