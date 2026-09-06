import type { Leaderboard as LB } from '@sigunu/shared';

/** Persistent ranked panel; teams and solo players together, solo tagged (Section 4). */
export function Leaderboard({ leaderboard, highlightKey }: { leaderboard: LB; highlightKey?: string }) {
  return (
    <aside className="panel leaderboard">
      <h3>Leaderboard</h3>
      {leaderboard.entries.length === 0 ? (
        <p className="muted">No players yet.</p>
      ) : (
        <ol className="lb-list">
          {leaderboard.entries.map((e) => (
            <li key={e.key} className={e.key === highlightKey ? 'lb-me' : ''}>
              <span className="lb-rank">{e.rank}</span>
              <span className="lb-name">
                {e.name}
                {e.kind === 'solo' && <span className="lb-tag">Solo</span>}
              </span>
              <span className="lb-score">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
