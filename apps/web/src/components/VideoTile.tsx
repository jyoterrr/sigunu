import { useEffect, useRef, useState } from 'react';
import {
  Track,
  RemoteTrackPublication,
  type Participant,
  type TrackPublication,
} from 'livekit-client';
import { useAdaptiveSubscription } from '../livekit/useAdaptiveSubscription';

/**
 * One participant's video tile. For remote participants the camera track is
 * subscribed/unsubscribed and quality-adjusted by useAdaptiveSubscription based on
 * this tile's visibility and size. Off-camera participants render an avatar.
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
  const [pub, setPub] = useState<TrackPublication | undefined>(
    participant.getTrackPublication(Track.Source.Camera)
  );

  // Track when this participant's camera publication appears/updates.
  useEffect(() => {
    const update = () => setPub(participant.getTrackPublication(Track.Source.Camera));
    update();
    participant.on('trackPublished', update);
    participant.on('trackUnpublished', update);
    participant.on('trackSubscribed', update);
    participant.on('trackUnsubscribed', update);
    participant.on('trackMuted', update);
    participant.on('trackUnmuted', update);
    return () => {
      participant.off('trackPublished', update);
      participant.off('trackUnpublished', update);
      participant.off('trackSubscribed', update);
      participant.off('trackUnsubscribed', update);
      participant.off('trackMuted', update);
      participant.off('trackUnmuted', update);
    };
  }, [participant]);

  // Selective subscription + adaptive quality (remote only; local isn't subscribed).
  useAdaptiveSubscription(
    !isLocal && pub instanceof RemoteTrackPublication ? pub : undefined,
    container
  );

  // Attach the video track to the element whenever it becomes available.
  useEffect(() => {
    const el = videoRef.current;
    const track = pub?.track;
    if (el && track && (pub?.kind === Track.Kind.Video)) {
      track.attach(el);
      return () => {
        track.detach(el);
      };
    }
  }, [pub, pub?.track]);

  const hasVideo = !!pub?.track && !pub.isMuted && (isLocal || (pub as RemoteTrackPublication).isSubscribed);
  // A camera track exists and isn't muted, but isn't playable yet → it's connecting
  // (Section 3: show a spinner instead of a blank tile so it reads as loading).
  const connecting = !hasVideo && !!pub && !pub.isMuted && !isLocal;

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
