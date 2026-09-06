import { useEffect } from 'react';
import { RemoteTrackPublication, VideoQuality } from 'livekit-client';

/**
 * Adaptive per-tile resolution (Section 7).
 *
 * Subscription itself is handled eagerly in useLiveKit (video is subscribed the moment
 * it's published, so it appears instantly and never re-buffers when views change). This
 * hook's job is only to request an appropriate simulcast layer for THIS tile's size:
 * a thumbnail asks for a low layer, a large/pinned tile asks for a high one. It never
 * unsubscribes, so a track shown in more than one tile (e.g. the quiz master in the main
 * view and in the grid) is never dropped by one tile unmounting.
 */
export function useAdaptiveSubscription(
  publication: RemoteTrackPublication | undefined,
  container: HTMLElement | null
) {
  useEffect(() => {
    if (!publication || !container) return;

    const applyQuality = () => {
      const w = container.clientWidth;
      const quality = w < 260 ? VideoQuality.LOW : w < 620 ? VideoQuality.MEDIUM : VideoQuality.HIGH;
      try {
        publication.setVideoQuality(quality);
        publication.setVideoDimensions({ width: container.clientWidth, height: container.clientHeight });
      } catch {
        /* not subscribable yet — the eager subscribe will attach it shortly */
      }
    };
    applyQuality();

    const ro = new ResizeObserver(applyQuality);
    ro.observe(container);
    return () => ro.disconnect();
  }, [publication, container]);
}
