import { useState } from 'react';
import type { LockedAnswer, PublicQuestion, QuestionResult, SessionPhase } from '@sigunu/shared';

const MEDIA_BASE = import.meta.env.VITE_API_URL || '';

function Media({ url, type, caption }: { url: string; type: 'image' | 'video'; caption?: string }) {
  const src = url.startsWith('http') ? url : `${MEDIA_BASE}${url}`;
  return (
    <figure className="q-media">
      {type === 'image' ? (
        <img src={src} alt={caption ?? ''} />
      ) : (
        <video src={src} controls playsInline />
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/**
 * The live question overlay for players. Shows the question + any media, lets the
 * player lock one option, then shows locked/revealed state. Server enforces locking;
 * this UI just reflects it (a teammate's lock disables the buttons here too).
 */
export function QuestionPanel({
  question,
  phase,
  lockedAnswer,
  lastResult,
  onLock,
}: {
  question: PublicQuestion | null;
  phase: SessionPhase;
  lockedAnswer: LockedAnswer | null;
  lastResult: QuestionResult | null;
  onLock: (optionId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!question) {
    return <div className="panel q-idle">Waiting for the quiz master to push a question…</div>;
  }

  const locked = !!lockedAnswer;
  const revealed = phase === 'revealed' && lastResult?.questionId === question.id;
  const canAnswer = phase === 'question_open' && !locked;

  const lock = async (optionId: string) => {
    setErr(null);
    setBusy(true);
    try {
      await onLock(optionId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not lock answer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel q-panel">
      <div className="q-text">{question.text}</div>
      {question.media.length > 0 && (
        <div className="q-media-row">
          {question.media.map((m) => (
            <Media key={m.id} url={m.url} type={m.type} caption={m.caption} />
          ))}
        </div>
      )}

      <div className="q-options">
        {question.options.map((o) => {
          const chosen = lockedAnswer?.optionId === o.id;
          const isCorrect = revealed && lastResult?.correctOptionId === o.id;
          const isWrongChoice = revealed && chosen && !isCorrect;
          return (
            <button
              key={o.id}
              className={[
                'q-option',
                chosen ? 'chosen' : '',
                isCorrect ? 'correct' : '',
                isWrongChoice ? 'wrong' : '',
              ].join(' ')}
              disabled={!canAnswer || busy}
              onClick={() => lock(o.id)}
            >
              {o.text}
              {isCorrect && ' ✓'}
            </button>
          );
        })}
      </div>

      {locked && !revealed && (
        <p className="q-status">
          Answer locked{lockedAnswer?.teamId ? ' for your team' : ''}. It can’t be changed.
        </p>
      )}
      {phase === 'question_locked' && !locked && <p className="q-status">Answers closed.</p>}
      {revealed && lastResult?.correctOptionId == null && (
        <p className="q-status">No correct answer was marked for this question.</p>
      )}
      {err && <p className="q-error">{err}</p>}
    </div>
  );
}
