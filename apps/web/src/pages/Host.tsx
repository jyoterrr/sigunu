import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { AudioState, AudioDirective, QuizQuestion } from '@sigunu/shared';
import { api } from '../lib/api';
import { creds } from '../lib/creds';
import { useLiveKit } from '../livekit/useLiveKit';
import { useSession } from '../state/useSession';
import { VideoGrid } from '../components/VideoGrid';
import { Leaderboard } from '../components/Leaderboard';
import { AudioVideoControls } from '../components/AudioVideoControls';
import { ScoreOverridePanel } from '../components/ScoreOverridePanel';
import { SyncedAudioPlayer } from '../components/SyncedAudioPlayer';
import { SharePanel } from '../components/SharePanel';
import { ChatPanel } from '../components/ChatPanel';
import { AudioRenderer, EnableAudioBanner } from '../components/AudioRenderer';
import { QuestionMediaStage } from '../components/QuestionMediaStage';

export function Host() {
  const { sessionId = '' } = useParams();
  const hc = creds.loadHost(sessionId);
  const [lkCreds, setLkCreds] = useState<{ url: string; token: string; participantId: string } | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [audioState, setAudioStateLocal] = useState<AudioState>('mute');
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [mediaOverride, setMediaOverride] = useState(false);

  // Get the host's LiveKit token + participant, and load the quiz.
  useEffect(() => {
    if (!hc) return;
    (async () => {
      try {
        const lk = await api.hostLiveKit(sessionId, hc.hostToken);
        setLkCreds({ url: lk.livekit.url, token: lk.livekit.token, participantId: lk.participantId });
        const q = await api.listQuestions(sessionId, hc.hostToken);
        setQuestions(q.questions);
      } catch (e) {
        setBootErr(e instanceof Error ? e.message : 'Failed to start hosting.');
      }
    })();
  }, [sessionId]);

  const lk = useLiveKit(lkCreds?.url ?? null, lkCreds?.token ?? null);
  const onAudioDirective = useCallback(
    (d: AudioDirective) => {
      void lk.applyAudioDirective(d);
      setAudioStateLocal(d.state);
    },
    [lk]
  );

  const session = useSession({
    sessionId,
    participantId: lkCreds?.participantId ?? '',
    token: hc?.hostToken ?? '', // host token grants control
    onAudioDirective,
  });

  if (!hc) {
    return <div className="home"><p>No host token. <Link to="/">Go back</Link>.</p></div>;
  }

  const current = session.currentQuestion;
  const currentFull = questions.find((q) => q.id === current?.id) ?? null;

  // Media playback is gated on a majority of devices acknowledging they're ready (or the
  // host's manual override). Readiness is auto-reported by each device (no button there).
  const rc = session.mediaReady && session.mediaReady.questionId === current?.id ? session.mediaReady : null;
  const majorityReady = !rc || rc.total === 0 ? true : rc.ready >= Math.ceil(rc.total / 2);
  const canPlayMedia = mediaOverride || majorityReady;
  const playMedia = (mediaId: string) => session.host.audioControl(currentFull!.id, mediaId, 'play', 0);
  const pauseMedia = (mediaId: string) => session.host.audioControl(currentFull!.id, mediaId, 'pause', 0);

  return (
    <div className="stage">
      <header className="topbar">
        <span className="brand-sm">Sigunu · Host</span>
        {hc.joinCode && <span className="code-pill">Join code: <b>{hc.joinCode}</b></span>}
        <Link className="btn-link" to={`/host/${sessionId}/build`}>Edit quiz</Link>
        {bootErr && <span className="q-error">{bootErr}</span>}
        {session.error && <span className="q-error">{session.error}</span>}
      </header>

      {lk.mediaError && (
        <div className="media-error-banner">{lk.mediaError} <button onClick={lk.clearMediaError}>✕</button></div>
      )}
      <EnableAudioBanner show={lk.audioBlocked} onEnable={lk.startAudio} />

      <main className="stage-main">
        <section className="stage-video">
          <VideoGrid participants={lk.participants} roster={session.participants} localId={lkCreds?.participantId ?? ''} view="grid" />
          <AudioVideoControls
            role="quizmaster"
            hasTeam={false}
            audioState={audioState}
            cameraOn={lk.cameraOn}
            onAudio={session.setAudioState}
            onToggleCamera={lk.toggleCamera}
          />
          <ChatPanel messages={session.chat} selfId={lkCreds?.participantId ?? ''} onSend={session.sendChat} />
        </section>

        <section className="stage-center">
          <div className="panel host-flow">
            {/* Share panel (Round 2 §1): join code + link for players */}
            <SharePanel joinCode={session.joinCode || hc.joinCode} />
            <div className="host-lifecycle">
              {!session.started ? (
                <button className="primary" onClick={() => session.host.start()}>▶ Start quiz</button>
              ) : (
                <span className="muted small">Quiz is live.</span>
              )}
            </div>
            <div className="host-phase">Phase: <b>{session.phase}</b></div>
            <div className="host-actions">
              {current && session.phase === 'question_open' && (
                <button onClick={() => session.host.lockQuestion(current.id)}>Close answers</button>
              )}
              {current && (session.phase === 'question_open' || session.phase === 'question_locked') && (
                <button className="primary" onClick={() => session.host.reveal(current.id)}>Reveal answer</button>
              )}
              {session.phase === 'revealed' && <button onClick={() => session.host.next()}>Next</button>}
              <button className="danger" onClick={() => session.host.end()}>End quiz</button>
            </div>

            {currentFull && (
              <div className="host-current">
                <div className="q-text">{currentFull.text}</div>
                {/* Host sees the media; the video follows the host's own play/pause below. */}
                <QuestionMediaStage
                  media={currentFull.media}
                  className="host-media"
                  videoMode="synced"
                  videoControl={session.audioControl}
                />
                <ul>
                  {currentFull.options.map((o) => (
                    <li key={o.id} className={currentFull.correctOptionId === o.id ? 'correct' : ''}>
                      {o.text}{currentFull.correctOptionId === o.id && ' ✓ (correct)'}
                    </li>
                  ))}
                </ul>

                {/* Synchronized media playback, gated on device readiness (Round 2). */}
                {currentFull.media.some((m) => m.kind === 'audio' || m.kind === 'video') && (
                  <div className="host-media-controls">
                    <div className="media-ready">
                      <b>{rc ? rc.ready : 0} / {rc ? rc.total : 0}</b> participant device(s) ready
                      {rc && rc.total > 0 && !majorityReady && !mediaOverride && (
                        <span className="muted small"> — Play unlocks at {Math.ceil(rc.total / 2)}</span>
                      )}
                    </div>
                    {currentFull.media.filter((m) => m.kind === 'audio').map((a) => (
                      <div key={a.id} className="host-audio-row">
                        <span>🔊 {a.caption ?? 'audio'}</span>
                        <button className="primary" disabled={!canPlayMedia} onClick={() => playMedia(a.id)}>▶ Play</button>
                        <button onClick={() => pauseMedia(a.id)}>⏸ Pause</button>
                      </div>
                    ))}
                    {currentFull.media.filter((m) => m.kind === 'video').map((v) => (
                      <div key={v.id} className="host-audio-row">
                        <span>🎬 video</span>
                        <button className="primary" disabled={!canPlayMedia} onClick={() => playMedia(v.id)}>▶ Play</button>
                        <button onClick={() => pauseMedia(v.id)}>⏸ Pause</button>
                      </div>
                    ))}
                    <label className="checkbox small">
                      <input type="checkbox" checked={mediaOverride} onChange={(e) => setMediaOverride(e.target.checked)} />
                      Play without waiting for a majority (override)
                    </label>
                  </div>
                )}
              </div>
            )}
            {/* Host hears players' live audio + the synced question audio */}
            <AudioRenderer tracks={lk.audioTracks} />
            <SyncedAudioPlayer
              audios={currentFull?.media.filter((m) => m.kind === 'audio') ?? []}
              control={session.audioControl}
            />

            <h4>Questions</h4>
            {questions.length === 0 ? (
              <p className="muted">No questions yet. <Link to={`/host/${sessionId}/build`}>Build the quiz</Link>.</p>
            ) : (
              <ol className="host-qlist">
                {questions.map((q) => (
                  <li key={q.id}>
                    <span>{q.text}</span>
                    <button
                      disabled={session.phase === 'question_open'}
                      onClick={() => session.host.pushQuestion(q.id)}
                    >
                      Push
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <ScoreOverridePanel
            sessionId={sessionId}
            hostToken={hc.hostToken}
            leaderboard={session.leaderboard}
            onAdjust={session.host.adjustScore}
            onUndo={session.host.undoAdjustment}
          />
        </section>

        <Leaderboard leaderboard={session.leaderboard} />
      </main>
    </div>
  );
}
