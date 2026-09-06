import { useCallback, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { AudioState } from '@sigunu/shared';
import { creds } from '../lib/creds';
import { useLiveKit } from '../livekit/useLiveKit';
import { useSession } from '../state/useSession';
import { VideoGrid } from '../components/VideoGrid';
import { QuestionPanel } from '../components/QuestionPanel';
import { Leaderboard } from '../components/Leaderboard';
import { AudioVideoControls } from '../components/AudioVideoControls';

export function Play() {
  const { sessionId = '' } = useParams();
  const c = creds.loadPlayer(sessionId);
  const [view, setView] = useState<'focus' | 'grid'>('focus');
  const [audioState, setAudioStateLocal] = useState<AudioState>('mute');

  const lk = useLiveKit(c?.livekit.url ?? null, c?.livekit.token ?? null);

  const onAudioDirective = useCallback(
    (d: import('@sigunu/shared').AudioDirective) => {
      void lk.applyAudioDirective(d);
      setAudioStateLocal(d.state);
    },
    [lk]
  );

  const session = useSession({
    sessionId,
    participantId: c?.participantId ?? '',
    token: c?.token ?? '',
    onAudioDirective,
  });

  const hasTeam = !!session.self?.teamId;
  const highlightKey = useMemo(
    () =>
      session.self?.teamId
        ? `team:${session.self.teamId}`
        : c
          ? `solo:${c.participantId}`
          : undefined,
    [session.self, c]
  );

  if (!c) {
    return (
      <div className="home">
        <p>No credentials for this session. <Link to="/">Join again</Link>.</p>
      </div>
    );
  }

  return (
    <div className="stage">
      <header className="topbar">
        <span className="brand-sm">Sigunu</span>
        <span className="muted">{session.self?.displayName}{hasTeam ? ` · team` : ' · solo'}</span>
        <div className="view-toggle">
          <button className={view === 'focus' ? 'active' : ''} onClick={() => setView('focus')}>Focus</button>
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>Grid</button>
        </div>
        {!lk.connected && <span className="muted">connecting video…</span>}
        {session.error && <span className="q-error">{session.error}</span>}
      </header>

      <main className="stage-main">
        <section className="stage-video">
          <VideoGrid
            participants={lk.participants}
            roster={session.participants}
            localId={c.participantId}
            view={view}
          />
          <AudioVideoControls
            role="player"
            hasTeam={hasTeam}
            audioState={audioState}
            cameraOn={lk.cameraOn}
            onAudio={session.setAudioState}
            onToggleCamera={lk.toggleCamera}
          />
        </section>

        <section className="stage-center">
          <QuestionPanel
            question={session.currentQuestion}
            phase={session.phase}
            lockedAnswer={session.lockedAnswer}
            lastResult={session.lastResult}
            onLock={(optionId) => session.lockAnswer(session.currentQuestion!.id, optionId)}
          />
        </section>

        <Leaderboard leaderboard={session.leaderboard} highlightKey={highlightKey} />
      </main>
    </div>
  );
}
