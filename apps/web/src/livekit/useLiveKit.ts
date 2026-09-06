import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  type Participant,
  type ParticipantTrackPermission,
} from 'livekit-client';
import type { AudioDirective } from '@sigunu/shared';
import { createRoom } from './room';

export interface UseLiveKit {
  room: Room | null;
  connected: boolean;
  participants: Participant[]; // remote + local
  cameraOn: boolean;
  toggleCamera: () => Promise<void>;
  /** Apply the authoritative audio directive from the server (team-only privacy). */
  applyAudioDirective: (d: AudioDirective) => Promise<void>;
}

/**
 * Manages the single LiveKit connection.
 *
 * Team-only audio (Section 5) is applied via publisher-side track subscription
 * permissions: teammates may subscribe to ALL of my tracks; everyone else may
 * subscribe ONLY to my video track sids — so my video stays visible to the whole
 * session while my audio reaches teammates alone. The quiz master is never a
 * teammate, so the SFU never forwards my team-only audio to them. We re-apply the
 * directive whenever a participant joins, since the "everyone else" set changed.
 */
export function useLiveKit(url: string | null, token: string | null): UseLiveKit {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const lastDirective = useRef<AudioDirective | null>(null);

  useEffect(() => {
    if (!url || !token) return;
    const r = createRoom();
    let cancelled = false;

    const refresh = () => setParticipants([r.localParticipant, ...Array.from(r.remoteParticipants.values())]);

    r.on(RoomEvent.Connected, () => {
      if (!cancelled) {
        setConnected(true);
        refresh();
      }
    })
      .on(RoomEvent.Disconnected, () => setConnected(false))
      .on(RoomEvent.ParticipantConnected, () => {
        refresh();
        // Re-apply team-only permissions: the "everyone else" set just changed.
        if (lastDirective.current) void applyDirective(r, lastDirective.current);
      })
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh);

    // autoSubscribe:false — tiles opt in via useAdaptiveSubscription.
    r.connect(url, token, { autoSubscribe: false })
      .then(() => setRoom(r))
      .catch((e) => console.error('LiveKit connect failed', e));

    return () => {
      cancelled = true;
      r.disconnect();
    };
  }, [url, token]);

  const toggleCamera = useCallback(async () => {
    if (!room) return;
    const next = !cameraOn;
    await room.localParticipant.setCameraEnabled(next);
    setCameraOn(next);
  }, [room, cameraOn]);

  const applyAudioDirective = useCallback(
    async (d: AudioDirective) => {
      if (!room) return;
      lastDirective.current = d;
      await applyDirective(room, d);
    },
    [room]
  );

  return { room, connected, participants, cameraOn, toggleCamera, applyAudioDirective };
}

async function applyDirective(room: Room, d: AudioDirective) {
  const local = room.localParticipant;
  // Publishing state: mic on only when open or team_only.
  await local.setMicrophoneEnabled(d.publishing);

  if (d.allowAll) {
    // open (or mute) => everyone may subscribe to everything of mine.
    local.setTrackSubscriptionPermissions(true, []);
    return;
  }

  // team_only => teammates get all my tracks; everyone else gets video only.
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
    // Non-teammates (incl. the quiz master): video only, never my audio.
    perParticipant.push({ participantIdentity: p.identity, allowedTrackSids: myVideoSids });
  }

  local.setTrackSubscriptionPermissions(false, perParticipant);
}
