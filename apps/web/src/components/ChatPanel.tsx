import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@sigunu/shared';

/** Global chat (Round 2 §chat): everyone in the session reads and writes here. */
export function ChatPanel({
  messages,
  selfId,
  onSend,
}: {
  messages: ChatMessage[];
  selfId: string;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSend(t);
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-title">Chat</div>
      <div className="chat-list">
        {messages.length === 0 && <p className="muted small">Say hello 👋</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.participantId === selfId ? 'mine' : ''}`}>
            <span className={`chat-name ${m.role === 'quizmaster' ? 'host' : ''}`}>
              {m.name}{m.role === 'quizmaster' ? ' (host)' : ''}
            </span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-input">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Message everyone…"
          maxLength={500}
        />
        <button onClick={send} disabled={busy || !text.trim()}>Send</button>
      </div>
    </div>
  );
}
