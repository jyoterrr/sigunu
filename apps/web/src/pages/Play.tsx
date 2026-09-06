import { useCallback, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { AudioState, AudioDirective } from '@sigunu/shared';
import { creds } from '../lib/creds';
import { useLiveKit } from '../livekit/useLiveKit';
import { useSession } from '../state/useSession';
import { VideoGrid } from '../components/VideoGrid';
import { VideoTile } from '../components/VideoTile';
import { Leaderboard } from '../components/Leaderboard';
import { AudioVideoControls } from '../components/AudioVideoControls';
import { QuestionMediaStage } from '../components/QuestionMediaStage';
import { AnswerOptions } from '../components/AnswerOptions';
import { TeammatePanel } from '../components/TeammatePanel';
import { SyncedAudioPlayer } from '../components/SyncedAudioPlayer';

export function Play() {
  const { sessionId = '' } = useParams();
  const c = creds.loadPlayer(sessionId);
  const [audioState, setAudioStateLocal] = useState<AudioState>('mute');
  const [gridOpen, setGridOpen] = useState(false);

  const lk = useLiveKit(c?.livekit.url ?? null, c?.livekit.token ?? null);

  const onAudioDirective = useCallback(
    (d: AudioDirective) => {
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

  const myTeamId = session.self?.teamId ?? null;
  const hasTeam = !!myTeamId;
  const highlightKey = useMemo(
    () => (myTeamId ? `team:${myTeamId}` : c ? `solo:${c.participantId}` : undefined),
    [myTeamId, c]
  );

  const teammates = useMemo(
    () =>
      session.participants.filter(
        (p) => p.role === 'player' && p.teamId && p.teamId === myTeamId && p.id !== c?.participantId
      ),
    [session.participants, myTeamId, c]
  );

  const hostId = session.participants.find((p) => p.role === 'quizmaster')?.id;
  const qmParticipant = lk.participants.find((p) => p.identity === hostId);

  const question = session.currentQuestion;
  const audios = useMemo(
    () => (question?.media.filter((m) => m.kind === 'audio') ?? []),
    [question]
  );

  if (!c) {
    return (
      <div className="home">
        <p>No credentials for this session. <Link to="/">Join again</Link>.</p>
      </div>
    );
  }

  return (
    <div className="quiz-screen">
      {/* Top bar: mic (3-state) + camera + expand-to-grid */}
      <header className="quiz-topbar">
        <span className="brand-sm">Sigunu</span>
        <span className="muted">{session.self?.displayName}{hasTeam ? ' · team' : ' · solo'}</span>
        <div className="topbar-spacer" />
        <AudioVideoControls
          role="player"
          hasTeam={hasTeam}
          audioState={audioState}
          cameraOn={lk.cameraOn}
          onAudio={session.setAudioState}
          onToggleCamera={lk.toggleCamera}
        />
        <button className="grid-expand-btn" onClick={() => setGridOpen(true)} title="Show all participants">
          ▦ All video
        </button>
        {!lk.connected && <span className="muted small">video off</span>}
        {session.error && <span className="q-error small">{session.error}</span>}
      </header>

      <div className="quiz-body">
        <main className="quiz-main">
          {question ? (
            <>
              {/* Center: question, Millionaire-style */}
              <div className="mq-question">
                <div className="mq-question-text">{question.text}</div>
                <QuestionMediaStage media={question.media} className="mq-media" />
                {audios.length > 0 && (
                  <div className="mq-audio-hint">🔊 audio round — the quiz master controls playback</div>
                )}
              </div>

              {/* Lower: quiz-master window (left) above the answer options */}
              <div className="mq-lower">
                <div className="qm-window">
                  {qmParticipant ? (
                    <VideoTile participant={qmParticipant} label="Quiz Master" />
                  ) : (
                    <div className="tile"><div className="tile-avatar">Q</div><span className="tile-label">Quiz Master</span></div>
                  )}
                </div>
                <AnswerOptions
                  question={question}
                  phase={session.phase}
                  lockedAnswer={session.lockedAnswer}
                  lastResult={session.lastResult}
                  onLock={(optionId) => session.lockAnswer(question.id, optionId)}
                />
              </div>
            </>
          ) : (
            <div className="mq-idle">Waiting for the quiz master to push a question…</div>
          )}
        </main>

        {/* Right: teammate speaker panel + leaderboard */}
        <aside className="quiz-right">
          <TeammatePanel
            teammates={teammates}
            participants={lk.participants}
            speakingIds={lk.speakingIds}
            speakerRecency={lk.speakerRecency}
          />
          <Leaderboard leaderboard={session.leaderboard} highlightKey={highlightKey} />
        </aside>
      </div>

      {/* Host-synced audio (hidden elements) */}
      <SyncedAudioPlayer audios={audios} control={session.audioControl} />

      {/* Expand-to-grid overlay: only while open are all visible tiles subscribed */}
      {gridOpen && (
        <div className="grid-overlay">
          <div className="grid-overlay-bar">
            <span>All participants</span>
            <button onClick={() => setGridOpen(false)}>✕ Close</button>
          </div>
          <VideoGrid
            participants={lk.participants}
            roster={session.participants}
            localId={c.participantId}
            view="grid"
          />
        </div>
      )}
    </div>
  );
}
