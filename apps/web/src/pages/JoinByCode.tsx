import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { creds } from '../lib/creds';

/**
 * Deep-link join (Round 2 §1): /join/:code drops a participant straight into the join
 * flow for that specific session (name entry → team selection).
 */
export function JoinByCode() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [solo, setSolo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const join = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await api.join({
        joinCode: code.trim().toUpperCase(),
        displayName: name.trim(),
        teamName: solo ? undefined : teamName.trim() || undefined,
      });
      creds.savePlayer({
        sessionId: res.sessionId,
        participantId: res.participantId,
        token: res.token,
        livekit: res.livekit,
        displayName: name.trim(),
        teamId: null,
      });
      nav(`/play/${res.sessionId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <h1 className="brand">Sigunu</h1>
      <p className="tagline">You're joining quiz <b>{code.toUpperCase()}</b>.</p>
      <div className="card">
        <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" autoFocus /></label>
        <label className="checkbox">
          <input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} /> Play solo (no team)
        </label>
        {!solo && (
          <label>Team name<input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Create or join a team by name" /></label>
        )}
        <button className="primary" disabled={busy || !name.trim()} onClick={join}>Join</button>
        {err && <p className="q-error">{err}</p>}
      </div>
    </div>
  );
}
