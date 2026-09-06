import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { creds } from '../lib/creds';

export function Home() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'join' | 'host'>('join');

  // join
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [solo, setSolo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // host
  const [hostToken, setHostToken] = useState('');
  const [hostSession, setHostSession] = useState('');

  const doJoin = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await api.join({
        joinCode: joinCode.trim(),
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

  const doCreate = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await api.createSession();
      creds.saveHost({ sessionId: res.sessionId, hostToken: res.hostToken, joinCode: res.joinCode });
      nav(`/host/${res.sessionId}/build`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create session.');
    } finally {
      setBusy(false);
    }
  };

  const resumeHost = () => {
    if (!hostSession.trim() || !hostToken.trim()) {
      setErr('Enter both the session id and host token.');
      return;
    }
    creds.saveHost({ sessionId: hostSession.trim(), hostToken: hostToken.trim(), joinCode: '' });
    nav(`/host/${hostSession.trim()}/build`);
  };

  return (
    <div className="home">
      <h1 className="brand">Sigunu</h1>
      <p className="tagline">Live team quizzes with video, private team audio, and a real-time leaderboard.</p>

      <div className="tabs">
        <button className={tab === 'join' ? 'active' : ''} onClick={() => setTab('join')}>Join a quiz</button>
        <button className={tab === 'host' ? 'active' : ''} onClick={() => setTab('host')}>Host</button>
      </div>

      {tab === 'join' ? (
        <div className="card">
          <label>Join code<input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="e.g. TESTQZ" /></label>
          <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" /></label>
          <label className="checkbox">
            <input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} /> Play solo (no team)
          </label>
          {!solo && (
            <label>Team name<input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Create or join a team by name" /></label>
          )}
          <button className="primary" disabled={busy} onClick={doJoin}>Join</button>
        </div>
      ) : (
        <div className="card">
          <button className="primary" disabled={busy} onClick={doCreate}>Create a new session</button>
          <p className="muted">You’ll get a join code and a host token. Save the token — it controls the quiz.</p>
          <hr />
          <p className="muted">Resume hosting (e.g. the seeded demo — session id + host token):</p>
          <label>Session id<input value={hostSession} onChange={(e) => setHostSession(e.target.value)} /></label>
          <label>Host token<input value={hostToken} onChange={(e) => setHostToken(e.target.value)} /></label>
          <button onClick={resumeHost}>Resume as host</button>
        </div>
      )}

      {err && <p className="q-error">{err}</p>}
    </div>
  );
}
