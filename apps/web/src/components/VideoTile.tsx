import { useEffect, useReducer, useRef, useState } from 'react';
import { Track, RemoteTrackPublication, type Participant } from 'livekit-client';
import { useAdaptiveSubscription } from '../livekit/useAdaptiveSubscription';

const PARTICIPANT_EVENTS = [
  'trackPublished',
  'trackUnpublished',
  'trackSubscribed',
  'trackUnsubscribed',
  'trackMuted',
  'trackUnmuted',
  'localTrackPublished',
  'localTrackUnpublished',
] as const;

/**
 * One participant's video tile.
 *
 * It reads the participant's CURRENT camera publication fresh on every render and just
 * forces a re-render whenever a track event fires. Caching the publication in state was
 * unreliable for always-mounted tiles (the quiz-master window, teammate windows): LiveKit
 * mutates the same publication object in place, so a cached copy went stale and the tile
 * wouldn't update when a camera turned on/off/on. Reading live + re-rendering on events
 * keeps these persistent windows seamless.
 */
export function VideoTile({
  participant,
  label,
  isLocal,
}: {
  participant: Participant;
  label: string;
  isLocal?: boolean;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  // Re-render on any track change for this participant (local or remote).
  useEffect(() => {
    const rerender = () => bump();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter = participant as any;
    for (const e of PARTICIPANT_EVENTS) emitter.on(e, rerender);
    rerender();
    return () => {
      for (const e of PARTICIPANT_EVENTS) emitter.off(e, rerender);
    };
  }, [participant]);

  // Live read — never cached.
  const pub = participant.getTrackPublication(Track.Source.Camera);

  // Per-tile resolution (subscription itself is eager, in useLiveKit).
  useAdaptiveSubscription(!isLocal && pub instanceof RemoteTrackPublication ? pub : undefined, container);

  const track = pub?.track;
  const hasVideo =
    !!track && !pub.isMuted && (isLocal || (pub as RemoteTrackPublication).isSubscribed);

  // Attach/detach the video element as the track comes and goes.
  useEffect(() => {
    const el = videoRef.current;
    if (el && track && pub?.kind === Track.Kind.Video) {
      track.attach(el);
      return () => {
        track.detach(el);
      };
    }
  }, [track, pub, hasVideo]);

  // A camera exists but isn't playable yet → "connecting"; fall back to the avatar if it
  // can't establish, so it never spins forever.
  const wantsVideo = !hasVideo && !!pub && !pub.isMuted && !isLocal;
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!wantsVideo) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [wantsVideo, pub]);
  const connecting = wantsVideo && !timedOut;

  return (
    <div className="tile" ref={setContainer}>
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} />
      ) : connecting ? (
        <div className="tile-loading"><div className="spinner" /><span>connecting…</span></div>
      ) : (
        <div className="tile-avatar">{label.slice(0, 1).toUpperCase()}</div>
      )}
      <span className="tile-label">{label}{isLocal ? ' (you)' : ''}</span>
    </div>
  );
}
