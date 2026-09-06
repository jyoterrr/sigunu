import { useState } from 'react';
import type { AudioState, Role } from '@sigunu/shared';
import { allowedAudioStates } from '@sigunu/shared';

const LABEL: Record<AudioState, string> = {
  team_only: 'Team only',
  open: 'Open to all',
  mute: 'Mute',
};

/**
 * Audio state switch (three states, mutually exclusive — Section 5) plus a camera
 * toggle (video is only on/off; there is no team-only video). Solo players and the
 * quiz master only ever see Open / Mute.
 */
export function AudioVideoControls({
  role,
  hasTeam,
  audioState,
  cameraOn,
  onAudio,
  onToggleCamera,
}: {
  role: Role;
  hasTeam: boolean;
  audioState: AudioState;
  cameraOn: boolean;
  onAudio: (s: AudioState) => Promise<void>;
  onToggleCamera: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const states = allowedAudioStates(role, hasTeam);

  const set = async (s: AudioState) => {
    setBusy(true);
    try {
      await onAudio(s);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel controls">
      <div className="control-group">
        <span className="control-label">Audio</span>
        <div className="seg">
          {states.map((s) => (
            <button
              key={s}
              className={s === audioState ? 'active' : ''}
              disabled={busy}
              onClick={() => set(s)}
              title={s === 'team_only' ? 'Only your teammates can hear you' : LABEL[s]}
            >
              {LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="control-group">
        <span className="control-label">Camera</span>
        <button className={cameraOn ? 'active' : ''} onClick={onToggleCamera}>
          {cameraOn ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}
