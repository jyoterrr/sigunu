import { Room, VideoPresets } from 'livekit-client';

/**
 * Build the LiveKit Room for a session.
 *
 * - autoSubscribe: false  => a client NEVER subscribes to all tracks by default,
 *   even briefly on load (Section 6 hard rule). Video tiles opt in via the
 *   IntersectionObserver-driven manager in useAdaptiveSubscription.
 * - adaptiveStream: true  => LiveKit also auto-manages decode/quality by the on-screen
 *   size and visibility of attached <video> elements (Section 7 backstop).
 * - dynacast: true        => publisher pauses simulcast layers nobody subscribes to.
 */
export function createRoom(): Room {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
    },
  });
}

export const AUTO_SUBSCRIBE = false;
