import { Room, VideoPresets } from 'livekit-client';

/**
 * Build the LiveKit Room for a session.
 *
 * - autoSubscribe: false  => a client NEVER subscribes to all tracks by default,
 *   even briefly on load (Section 6 hard rule). Video tiles opt in via the
 *   reference-counted, IntersectionObserver-driven manager in useAdaptiveSubscription,
 *   which also sets per-tile quality (Section 7).
 * - adaptiveStream: false => we manage subscription/quality ourselves. LiveKit's
 *   adaptiveStream would independently pause/resume tracks by element visibility,
 *   which fought our manual control and made already-visible video re-buffer.
 * - dynacast: true        => publisher pauses simulcast layers nobody subscribes to.
 */
export function createRoom(): Room {
  return new Room({
    adaptiveStream: false,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
    },
  });
}

export const AUTO_SUBSCRIBE = false;
