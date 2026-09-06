import { useState } from 'react';
import type { LockedAnswer, PublicQuestion, QuestionResult, SessionPhase } from '@sigunu/shared';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * "Who Wants to Be a Millionaire"-style answer bars, laid out as a 2×2 grid along the
 * lower part of the screen (Addendum §3). Server enforces locking; this reflects it —
 * a teammate's lock disables the bars here too.
 */
export function AnswerOptions({
  question,
  phase,
  lockedAnswer,
  lastResult,
  onLock,
}: {
  question: PublicQuestion;
  phase: SessionPhase;
  lockedAnswer: LockedAnswer | null;
  lastResult: QuestionResult | null;
  onLock: (optionId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    <div className="mq-options-wrap">
      <div className="mq-options">
        {question.options.map((o, i) => {
          const chosen = lockedAnswer?.optionId === o.id;
          const isCorrect = revealed && lastResult?.correctOptionId === o.id;
          const isWrongChoice = revealed && chosen && !isCorrect;
          return (
            <button
              key={o.id}
              className={[
                'mq-option',
                chosen ? 'chosen' : '',
                isCorrect ? 'correct' : '',
                isWrongChoice ? 'wrong' : '',
              ].join(' ')}
              disabled={!canAnswer || busy}
              onClick={() => lock(o.id)}
            >
              <span className="mq-letter">{LETTERS[i]}</span>
              <span className="mq-text">{o.text}</span>
              {isCorrect && <span className="mq-mark">✓</span>}
            </button>
          );
        })}
      </div>
      <div className="mq-status">
        {locked && !revealed && (
          <span>Answer locked{lockedAnswer?.teamId ? ' for your team' : ''} — can’t be changed.</span>
        )}
        {phase === 'question_locked' && !locked && <span>Answers closed.</span>}
        {revealed && lastResult?.correctOptionId == null && <span>No correct answer was marked.</span>}
        {err && <span className="q-error">{err}</span>}
      </div>
    </div>
  );
}
