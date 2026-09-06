import { useCallback, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
import { AudioRenderer, EnableAudioBanner } from '../components/AudioRenderer';
import { ChatPanel } from '../components/ChatPanel';
import { ConfirmDialog, InvitePrompt, NameTeamPrompt, Toast } from '../components/Modals';

export function Play() {
  const { sessionId = '' } = useParams();
  const nav = useNavigate();
  const c = creds.loadPlayer(sessionId);
  const [audioState, setAudioStateLocal] = useState<AudioState>('mute');
  const [gridOpen, setGridOpen] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

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
  const audios = useMemo(() => question?.media.filter((m) => m.kind === 'audio') ?? [], [question]);
  const hintText = question ? session.revealedHints[question.id] : undefined;

  const doLeaveQuiz = async () => {
    setConfirmLeave(false);
    try {
      await session.leaveQuiz();
    } catch {
      /* ignore */
    }
    lk.room?.disconnect();
    nav('/');
  };

  if (!c) {
    return <div className="home"><p>No credentials for this session. <Link to="/">Join again</Link>.</p></div>;
  }

  // Quiz ended → final screen (Round 2 §1).
  if (session.phase === 'ended') {
    const board = session.endedLeaderboard ?? session.leaderboard;
    return (
      <div className="ended-screen">
        <h1>Quiz ended</h1>
        <p className="muted">Thanks for playing! Final standings:</p>
        <div className="ended-board"><Leaderboard leaderboard={board} highlightKey={highlightKey} /></div>
        <Link className="primary btn-link" to="/">Back home</Link>
      </div>
    );
  }

  return (
    <div className="quiz-screen">
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
        <button className="grid-expand-btn" onClick={() => setGridOpen(true)} title="Show all participants">▦ All video</button>
        <button className="chip-btn" onClick={() => setShowChat((s) => !s)}>💬 Chat</button>
        {hasTeam && <button className="chip-btn" onClick={() => session.leaveTeam()}>Leave team</button>}
        <button className="chip-btn danger" onClick={() => setConfirmLeave(true)}>Leave</button>
        {!lk.connected && <span className="muted small">connecting…</span>}
      </header>

      {lk.mediaError && (
        <div className="media-error-banner">{lk.mediaError} <button onClick={lk.clearMediaError}>✕</button></div>
      )}
      <EnableAudioBanner show={lk.audioBlocked} onEnable={lk.startAudio} />

      <div className="quiz-body">
        <main className="quiz-main">
          {question ? (
            <>
              <div className="mq-question">
                <div className="mq-question-text">{question.text}</div>
                <QuestionMediaStage
                  media={question.media}
                  className="mq-media"
                  videoMode="participant"
                  videoControl={session.audioControl}
                />
                {audios.length > 0 && <div className="mq-audio-hint">🔊 audio round — the quiz master controls playback</div>}
                {question.hasHint && (
                  <div className="hint-box">
                    {hintText ? (
                      <p className="hint-text">💡 {hintText}</p>
                    ) : (
                      <button className="hint-btn" onClick={() => session.revealHint(question.id)}>
                        💡 Reveal hint{question.hintCost > 0 ? ` (−${question.hintCost} pts)` : ''}
                      </button>
                    )}
                  </div>
                )}
              </div>

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

        <aside className="quiz-right">
          <TeammatePanel
            teammates={teammates}
            participants={lk.participants}
            speakingIds={lk.speakingIds}
            speakerRecency={lk.speakerRecency}
          />
          {showChat ? (
            <ChatPanel messages={session.chat} selfId={c.participantId} onSend={session.sendChat} />
          ) : (
            <Leaderboard leaderboard={session.leaderboard} highlightKey={highlightKey} />
          )}
        </aside>
      </div>

      {/* Remote audio playback (Section 2 fix) + host-synced question audio */}
      <AudioRenderer tracks={lk.audioTracks} />
      <SyncedAudioPlayer audios={audios} control={session.audioControl} />

      {gridOpen && (
        <div className="grid-overlay">
          <div className="grid-overlay-bar">
            <span>All participants — click <b>Invite to team</b> on a solo player</span>
            <button onClick={() => setGridOpen(false)}>✕ Close</button>
          </div>
          <VideoGrid
            participants={lk.participants}
            roster={session.participants}
            localId={c.participantId}
            view="grid"
            onInvite={(pid) => session.invite(pid)}
          />
        </div>
      )}

      {/* Membership modals */}
      <InvitePrompt invite={session.incomingInvite} onRespond={session.respondInvite} />
      <NameTeamPrompt prompt={session.namePrompt} onSubmit={session.nameTeam} onCancel={() => session.clearToast()} error={session.error} />
      <Toast text={session.toast} onClose={session.clearToast} />
      <ConfirmDialog
        open={confirmLeave}
        title="Leave the quiz?"
        message="You'll be disconnected from the video call and marked as left."
        confirmLabel="Leave quiz"
        danger
        onConfirm={doLeaveQuiz}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
