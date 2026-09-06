import { useCallback, useEffect, useState } from 'react';
import type { Leaderboard, ScoreAdjustment } from '@sigunu/shared';
import { api } from '../lib/api';

/**
 * Manual score override + host-only audit log (Addendum §2). The quiz master can add
 * or subtract any number of points to a team or solo player, on top of automatic
 * scoring. Every change is logged with one-click undo. Players never see this panel —
 * only the resulting leaderboard change.
 */
export function ScoreOverridePanel({
  sessionId,
  hostToken,
  leaderboard,
  onAdjust,
  onUndo,
}: {
  sessionId: string;
  hostToken: string;
  leaderboard: Leaderboard;
  onAdjust: (subjectKey: string, delta: number, reason?: string) => Promise<void>;
  onUndo: (adjustmentId: string) => Promise<void>;
}) {
  const [subjectKey, setSubjectKey] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [log, setLog] = useState<ScoreAdjustment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { adjustments } = await api.listAdjustments(sessionId, hostToken);
      setLog(adjustments);
    } catch {
      /* ignore */
    }
  }, [sessionId, hostToken]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh, leaderboard.updatedAt]);

  const apply = async () => {
    setErr(null);
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) {
      setErr('Enter a non-zero whole number (negative to subtract).');
      return;
    }
    if (!subjectKey) {
      setErr('Pick a team or player.');
      return;
    }
    try {
      await onAdjust(subjectKey, d, reason || undefined);
      setDelta('');
      setReason('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to apply.');
    }
  };

  const undo = async (id: string) => {
    await onUndo(id);
    await refresh();
  };

  return (
    <div className="panel override-panel">
      <button className="override-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Manual score override (host only)
      </button>
      {open && (
        <div className="override-body">
          <div className="override-form">
            <select value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)}>
              <option value="">Choose team / player…</option>
              {leaderboard.entries.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.name}
                  {e.kind === 'solo' ? ' (solo)' : ''} — {e.score} pts
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="± points"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              title="Positive to add, negative to subtract"
            />
            <input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="primary" onClick={apply}>Apply</button>
          </div>
          <p className="muted small">Overrides can be any amount, including making a score negative — deliberate host action.</p>
          {err && <p className="q-error">{err}</p>}

          <div className="override-log">
            <div className="control-label">Audit log</div>
            {log.length === 0 ? (
              <p className="muted small">No manual adjustments yet.</p>
            ) : (
              <ul>
                {log.map((a) => (
                  <li key={a.id} className={a.active ? '' : 'undone'}>
                    <span className={`delta ${a.delta >= 0 ? 'pos' : 'neg'}`}>
                      {a.delta >= 0 ? '+' : ''}{a.delta}
                    </span>
                    <span className="who">{a.subjectName}</span>
                    {a.reason && <span className="reason">“{a.reason}”</span>}
                    <span className="when">{new Date(a.createdAt).toLocaleTimeString()}</span>
                    {a.active ? (
                      <button className="x" onClick={() => undo(a.id)}>Undo</button>
                    ) : (
                      <span className="muted small">undone</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
