import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteAudioTrack,
  type ParticipantTrackPermission,
} from 'livekit-client';
import type { AudioDirective } from '@sigunu/shared';
import { createRoom } from './room';

export interface RemoteAudioEntry {
  id: string; // track sid
  track: RemoteAudioTrack;
}

export interface UseLiveKit {
  room: Room | null;
  connected: boolean;
  participants: Participant[];
  cameraOn: boolean;
  micOn: boolean;
  toggleCamera: () => Promise<void>;
  applyAudioDirective: (d: AudioDirective) => Promise<void>;
  speakingIds: Set<string>;
  speakerRecency: string[];
  /** Remote audio tracks to render/play (Section 2 fix — audio was never subscribed). */
  audioTracks: RemoteAudioEntry[];
  /** True when the browser is blocking audio playback until a user gesture. */
  audioBlocked: boolean;
  /** Call from a click to unblock audio playback. */
  startAudio: () => Promise<void>;
  /** Last media error (mic/camera permission or track failure), surfaced to the UI. */
  mediaError: string | null;
  clearMediaError: () => void;
}

/**
 * Manages the single LiveKit connection.
 *
 * AUDIO (Section 2): the room connects with autoSubscribe:false so that *video* is
 * subscribed selectively per visible tile. Audio must NOT be selective — we subscribe
 * to every remote audio track and play it. Team-only privacy is still enforced
 * publisher-side (setTrackSubscriptionPermissions), so the SFU simply won't forward a
 * team-only track to a non-teammate even though we ask to subscribe.
 */
export function useLiveKit(url: string | null, token: string | null): UseLiveKit {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [speakerRecency, setSpeakerRecency] = useState<string[]>([]);
  const [audioTracks, setAudioTracks] = useState<RemoteAudioEntry[]>([]);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const recencyRef = useRef<Map<string, number>>(new Map());
  const lastDirective = useRef<AudioDirective | null>(null);

  useEffect(() => {
    if (!url || !token) return;
    const r = createRoom();
    let cancelled = false;

    const refresh = () =>
      setParticipants([r.localParticipant, ...Array.from(r.remoteParticipants.values())]);

    // Eagerly subscribe to ALL of a participant's tracks — audio AND video — so media
    // is already flowing by the time a tile renders (seamless: video appears the moment
    // someone turns on their camera, no per-tile "connecting" delay). Video has no
    // privacy restriction; team-only AUDIO privacy is still enforced publisher-side, so
    // the SFU simply won't forward a restricted audio track to a non-teammate.
    const subscribeAll = (p: RemoteParticipant) => {
      for (const pub of p.trackPublications.values()) {
        try {
          pub.setSubscribed(true);
        } catch {
          /* forbidden (team-only) — SFU refuses; safe to ignore */
        }
      }
    };

    r.on(RoomEvent.Connected, () => {
      if (cancelled) return;
      setConnected(true);
      setAudioBlocked(!r.canPlaybackAudio);
      for (const p of r.remoteParticipants.values()) subscribeAll(p);
      refresh();
    })
      .on(RoomEvent.Disconnected, () => setConnected(false))
      .on(RoomEvent.ParticipantConnected, (p) => {
        subscribeAll(p);
        refresh();
        if (lastDirective.current) void applyDirective(r, lastDirective.current);
      })
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackPublished, (pub) => {
        // Any new track (camera turned on, mic on) — subscribe immediately.
        try {
          pub.setSubscribed(true);
        } catch {
          /* ignore */
        }
        refresh();
      })
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          setAudioTracks((prev) =>
            prev.some((e) => e.id === pub.trackSid)
              ? prev
              : [...prev, { id: pub.trackSid, track: track as RemoteAudioTrack }]
          );
        } else if (track.kind === Track.Kind.Video) {
          // Default eagerly-subscribed video to a low layer to bound bandwidth; a
          // visible tile requests a higher layer for its size via useAdaptiveSubscription.
          try {
            pub.setVideoQuality(VideoQuality.LOW);
          } catch {
            /* ignore */
          }
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (_track, pub) => {
        setAudioTracks((prev) => prev.filter((e) => e.id !== pub.trackSid));
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!r.canPlaybackAudio))
      .on(RoomEvent.MediaDevicesError, (e: Error) =>
        setMediaError(`Microphone/camera error: ${e.message}`)
      )
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const now = Date.now();
        const ids = new Set(speakers.map((s) => s.identity));
        setSpeakingIds(ids);
        for (const id of ids) recencyRef.current.set(id, now);
        setSpeakerRecency(
          [...recencyRef.current.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
        );
      });

    r.connect(url, token, { autoSubscribe: false })
      .then(() => {
        if (cancelled) return;
        setRoom(r);
        // Dev-only handle for debugging/testing (e.g. publishing a synthetic track).
        if (import.meta.env.DEV) (window as unknown as { __sigunuRoom?: Room }).__sigunuRoom = r;
      })
      .catch((e) => {
        // Ignore aborts from an intentional unmount (e.g. React StrictMode double-mount).
        if (cancelled) return;
        console.error('LiveKit connect failed', e);
        setMediaError('Could not connect to the video/audio server.');
      });

    return () => {
      cancelled = true;
      r.disconnect();
    };
  }, [url, token]);

  const toggleCamera = useCallback(async () => {
    if (!room) return;
    const next = !cameraOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCameraOn(next);
    } catch (e) {
      setMediaError(`Camera could not start — check the browser's camera permission. (${(e as Error).message})`);
    }
  }, [room, cameraOn]);

  const applyAudioDirective = useCallback(
    async (d: AudioDirective) => {
      if (!room) return;
      lastDirective.current = d;
      try {
        await applyDirective(room, d);
        setMicOn(d.publishing);
      } catch (e) {
        setMediaError(`Microphone could not start — check the browser's mic permission. (${(e as Error).message})`);
      }
    },
    [room]
  );

  const startAudio = useCallback(async () => {
    if (!room) return;
    try {
      await room.startAudio();
      setAudioBlocked(!room.canPlaybackAudio);
    } catch {
      /* still blocked */
    }
  }, [room]);

  const clearMediaError = useCallback(() => setMediaError(null), []);

  return {
    room,
    connected,
    participants,
    cameraOn,
    micOn,
    toggleCamera,
    applyAudioDirective,
    speakingIds,
    speakerRecency,
    audioTracks,
    audioBlocked,
    startAudio,
    mediaError,
    clearMediaError,
  };
}

async function applyDirective(room: Room, d: AudioDirective) {
  const local = room.localParticipant;
  // Publishing state: mic on only when open or team_only. This triggers the browser
  // mic-permission prompt the first time; failures propagate to the caller for surfacing.
  await local.setMicrophoneEnabled(d.publishing);

  if (d.allowAll) {
    local.setTrackSubscriptionPermissions(true, []);
    return;
  }

  const myVideoSids = Array.from(local.videoTrackPublications.values())
    .map((p) => p.trackSid)
    .filter(Boolean);
  const teammateSet = new Set(d.allowedIdentities);
  const perParticipant: ParticipantTrackPermission[] = [];
  for (const identity of teammateSet) {
    perParticipant.push({ participantIdentity: identity, allowAll: true });
  }
  for (const p of room.remoteParticipants.values()) {
    if (teammateSet.has(p.identity)) continue;
    perParticipant.push({ participantIdentity: p.identity, allowedTrackSids: myVideoSids });
  }
  local.setTrackSubscriptionPermissions(false, perParticipant);
}
