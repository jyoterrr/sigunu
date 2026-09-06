import { useState } from 'react';

/** Host share panel (Round 2 §1): join code + full shareable link, each with copy. */
export function SharePanel({ joinCode }: { joinCode: string }) {
  const link = `${window.location.origin}/join/${joinCode}`;
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string, which: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  if (!joinCode) return null;
  return (
    <div className="share-panel">
      <div className="share-row">
        <span className="share-label">Join code</span>
        <code className="share-code">{joinCode}</code>
        <button onClick={() => copy(joinCode, 'code')}>{copied === 'code' ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <div className="share-row">
        <span className="share-label">Link</span>
        <input className="share-link" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button onClick={() => copy(link, 'link')}>{copied === 'link' ? 'Copied ✓' : 'Copy'}</button>
      </div>
    </div>
  );
}
