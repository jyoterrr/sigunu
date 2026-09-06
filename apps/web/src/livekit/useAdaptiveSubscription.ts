import { useEffect } from 'react';
import { RemoteTrackPublication, VideoQuality } from 'livekit-client';

/**
 * Selective subscription + adaptive per-tile resolution (Sections 6 & 7), handled
 * generically for any tile regardless of layout.
 *
 * While the tile's container is intersecting the viewport we subscribe to its video
 * track; when it scrolls out (or the tab/view changes and the element unmounts) we
 * unsubscribe so no off-screen video is decoded. The requested simulcast quality is
 * chosen from the tile's measured pixel size: thumbnail => LOW, medium => MEDIUM,
 * large/pinned => HIGH.
 */
export function useAdaptiveSubscription(
  publication: RemoteTrackPublication | undefined,
  container: HTMLElement | null
) {
  useEffect(() => {
    if (!publication || !container) return;

    const applyQuality = () => {
      const w = container.clientWidth;
      const quality = w < 240 ? VideoQuality.LOW : w < 560 ? VideoQuality.MEDIUM : VideoQuality.HIGH;
      // Only meaningful once subscribed; safe to call regardless.
      publication.setVideoQuality(quality);
      publication.setVideoDimensions({ width: container.clientWidth, height: container.clientHeight });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const visible = e.isIntersecting && e.intersectionRatio > 0;
          publication.setSubscribed(visible);
          if (visible) applyQuality();
        }
      },
      { threshold: [0, 0.01] }
    );
    io.observe(container);

    const ro = new ResizeObserver(() => applyQuality());
    ro.observe(container);

    return () => {
      io.disconnect();
      ro.disconnect();
      // Leaving the tile: release the subscription so off-screen video isn't decoded.
      publication.setSubscribed(false);
    };
  }, [publication, container]);
}
