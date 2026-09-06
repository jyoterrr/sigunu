import { useState } from 'react';
import type { IncomingInvite, NamePrompt } from '../state/useSession';

function Backdrop({ children }: { children: React.ReactNode }) {
  return <div className="modal-backdrop"><div className="modal">{children}</div></div>;
}

/** Generic confirm (used for Leave Quiz — Round 2 §6). */
export function ConfirmDialog({
  open, title, message, confirmLabel, danger, onConfirm, onCancel,
}: {
  open: boolean; title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Backdrop>
      <h3>{title}</h3>
      <p className="muted">{message}</p>
      <div className="modal-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Backdrop>
  );
}

/** Shown to a participant who received a team invite (Round 2 §4). */
export function InvitePrompt({
  invite, onRespond,
}: {
  invite: IncomingInvite | null;
  onRespond: (inviteId: string, accept: boolean) => void;
}) {
  if (!invite) return null;
  return (
    <Backdrop>
      <h3>Team invite</h3>
      <p><b>{invite.fromName}</b> invited you to join their team.</p>
      <div className="modal-actions">
        <button onClick={() => onRespond(invite.inviteId, false)}>Decline</button>
        <button className="primary" onClick={() => onRespond(invite.inviteId, true)}>Accept</button>
      </div>
    </Backdrop>
  );
}

/** Shown to the requester after a solo+solo invite is accepted: name the new team. */
export function NameTeamPrompt({
  prompt, onSubmit, onCancel, error,
}: {
  prompt: NamePrompt | null;
  onSubmit: (inviteId: string, name: string) => void;
  onCancel: () => void;
  error?: string | null;
}) {
  const [name, setName] = useState('');
  if (!prompt) return null;
  return (
    <Backdrop>
      <h3>Name your team</h3>
      <p className="muted"><b>{prompt.inviteeName}</b> accepted! Pick a team name (must be unique).</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" autoFocus
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSubmit(prompt.inviteId, name.trim())} />
      {error && <p className="q-error">{error}</p>}
      <div className="modal-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={() => onSubmit(prompt.inviteId, name.trim())}>Create team</button>
      </div>
    </Backdrop>
  );
}

/** Transient toast for invite results / notices. */
export function Toast({ text, onClose }: { text: string | null; onClose: () => void }) {
  if (!text) return null;
  return (
    <div className="toast" onClick={onClose}>
      {text} <span className="toast-x">✕</span>
    </div>
  );
}
