import { useEffect, useRef } from 'react';
import { RemoteTrackPublication, VideoQuality } from 'livekit-client';

/**
 * Selective subscription + adaptive per-tile resolution (Sections 6 & 7), made
 * consistent (Round 2 fix).
 *
 * The same participant can be shown by more than one tile at once (e.g. the quiz
 * master appears in the main view AND in the expand-to-grid overlay). If each tile
 * toggled setSubscribed independently, one tile unmounting would unsubscribe a track
 * another tile still needs — making already-visible video flip back to "connecting".
 *
 * So we REFERENCE-COUNT subscriptions per track sid: a track is subscribed while at
 * least one visible tile wants it, and only unsubscribed when the last one goes away.
 * This keeps the quiz master's video steady when opening/closing the grid, and video
 * appears as soon as the first tile wants it.
 */

const refCounts = new Map<string, number>();

function acquire(pub: RemoteTrackPublication) {
  const sid = pub.trackSid;
  if (!sid) return;
  const n = (refCounts.get(sid) ?? 0) + 1;
  refCounts.set(sid, n);
  if (n === 1 && !pub.isSubscribed) pub.setSubscribed(true);
}

function release(pub: RemoteTrackPublication) {
  const sid = pub.trackSid;
  if (!sid) return;
  const n = Math.max(0, (refCounts.get(sid) ?? 0) - 1);
  if (n === 0) {
    refCounts.delete(sid);
    if (pub.isSubscribed) pub.setSubscribed(false);
  } else {
    refCounts.set(sid, n);
  }
}

export function useAdaptiveSubscription(
  publication: RemoteTrackPublication | undefined,
  container: HTMLElement | null
) {
  const held = useRef(false);

  useEffect(() => {
    if (!publication || !container) return;

    const applyQuality = () => {
      const w = container.clientWidth;
      const quality = w < 240 ? VideoQuality.LOW : w < 560 ? VideoQuality.MEDIUM : VideoQuality.HIGH;
      publication.setVideoQuality(quality);
      publication.setVideoDimensions({ width: container.clientWidth, height: container.clientHeight });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const visible = e.isIntersecting && e.intersectionRatio > 0;
          if (visible && !held.current) {
            held.current = true;
            acquire(publication);
            applyQuality();
          } else if (!visible && held.current) {
            held.current = false;
            release(publication);
          }
        }
      },
      { threshold: [0, 0.01] }
    );
    io.observe(container);

    const ro = new ResizeObserver(() => {
      if (held.current) applyQuality();
    });
    ro.observe(container);

    return () => {
      io.disconnect();
      ro.disconnect();
      if (held.current) {
        held.current = false;
        release(publication);
      }
    };
  }, [publication, container]);
}
