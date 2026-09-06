import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { QuizQuestion, QuestionMedia } from '@sigunu/shared';
import { api } from '../lib/api';
import { creds } from '../lib/creds';

interface Draft {
  id?: string;
  text: string;
  media: QuestionMedia[];
  options: { id: string; text: string }[];
  correctOptionId: string | null;
  correctPoints: number | null;
  wrongPenalty: number | null;
  timeLimitSec: number | null;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const emptyDraft = (): Draft => ({
  text: '',
  media: [],
  options: [
    { id: uid(), text: '' },
    { id: uid(), text: '' },
  ],
  correctOptionId: null,
  correctPoints: null,
  wrongPenalty: null,
  timeLimitSec: null,
});

export function Builder() {
  const { sessionId = '' } = useParams();
  const hc = creds.loadHost(sessionId);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [cfg, setCfg] = useState({ defaultCorrectPoints: 10, defaultWrongPenalty: 0, unansweredPolicy: 'zero' as 'zero' | 'penalty' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pdfRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    if (!hc) return;
    const q = await api.listQuestions(sessionId, hc.hostToken);
    setQuestions(q.questions);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [sessionId]);

  if (!hc) return <div className="home"><p>No host token. <Link to="/">Go back</Link>.</p></div>;
  const ht = hc.hostToken;

  const setField = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const addOption = () => setField('options', [...draft.options, { id: uid(), text: '' }]);
  const removeOption = (id: string) =>
    setField('options', draft.options.filter((o) => o.id !== id));
  const setOptionText = (id: string, text: string) =>
    setField('options', draft.options.map((o) => (o.id === id ? { ...o, text } : o)));

  const uploadMedia = async (files: FileList | null) => {
    if (!files) return;
    setErr(null);
    try {
      const added: QuestionMedia[] = [];
      for (const f of Array.from(files)) {
        const m = await api.uploadMedia(sessionId, ht, f);
        added.push({ id: m.id, type: m.type, url: m.url });
      }
      setField('media', [...draft.media, ...added]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed.');
    }
  };

  const validate = (d: Draft): string | null => {
    if (!d.text.trim()) return 'Question text is required.';
    if (d.options.length < 2 || d.options.some((o) => !o.text.trim())) return 'Provide at least two non-empty options.';
    if (d.correctPoints != null && d.correctPoints <= 0) return 'Correct points must be positive.';
    if (d.wrongPenalty != null && d.wrongPenalty < 0) return 'Wrong penalty cannot be negative.';
    return null;
  };

  const save = async () => {
    setErr(null); setMsg(null);
    const v = validate(draft);
    if (v) { setErr(v); return; }
    const payload = {
      text: draft.text.trim(),
      media: draft.media,
      options: draft.options.map((o) => ({ id: o.id, text: o.text.trim() })),
      correctOptionId: draft.correctOptionId,
      correctPoints: draft.correctPoints,
      wrongPenalty: draft.wrongPenalty,
      timeLimitSec: draft.timeLimitSec,
      source: 'manual' as const,
    };
    try {
      if (draft.id) await api.updateQuestion(sessionId, ht, draft.id, payload);
      else await api.createQuestion(sessionId, ht, payload);
      setDraft(emptyDraft());
      setMsg('Saved.');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    }
  };

  const editExisting = (q: QuizQuestion) =>
    setDraft({
      id: q.id,
      text: q.text,
      media: q.media,
      options: q.options,
      correctOptionId: q.correctOptionId,
      correctPoints: q.scoring?.correctPoints ?? null,
      wrongPenalty: q.scoring?.wrongPenalty ?? null,
      timeLimitSec: q.timeLimitSec,
    });

  const del = async (id: string) => {
    await api.deleteQuestion(sessionId, ht, id);
    if (draft.id === id) setDraft(emptyDraft());
    await load();
  };

  const importPdf = async (file: File | null) => {
    if (!file) return;
    setErr(null); setMsg(null);
    try {
      const res = await api.extractPdf(sessionId, ht, file);
      setMsg(`Imported ${res.imported.length} question(s) via ${res.mode === 'text' ? 'text extraction' : 'scanned-PDF reading'}. Review and set any missing correct answers below.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Extraction failed.');
    }
  };

  const saveConfig = async () => {
    setErr(null);
    try {
      await api.setConfig(sessionId, ht, cfg);
      setMsg('Scoring config saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Config save failed.');
    }
  };

  return (
    <div className="builder">
      <header className="topbar">
        <span className="brand-sm">Sigunu · Quiz builder</span>
        <span className="code-pill">Join code: <b>{hc.joinCode || '—'}</b></span>
        <Link className="btn-link" to={`/host/${sessionId}`}>Go to host console →</Link>
      </header>

      <div className="builder-grid">
        <div>
          {/* Scoring config (Section 9) */}
          <div className="panel">
            <h3>Scoring defaults</h3>
            <label>Correct points (must be &gt; 0)
              <input type="number" min={1} value={cfg.defaultCorrectPoints}
                onChange={(e) => setCfg({ ...cfg, defaultCorrectPoints: Number(e.target.value) })} />
            </label>
            <label>Wrong-answer deduction (0 = no penalty)
              <input type="number" min={0} value={cfg.defaultWrongPenalty}
                onChange={(e) => setCfg({ ...cfg, defaultWrongPenalty: Number(e.target.value) })} />
            </label>
            <label>Unanswered questions
              <select value={cfg.unansweredPolicy} onChange={(e) => setCfg({ ...cfg, unansweredPolicy: e.target.value as 'zero' | 'penalty' })}>
                <option value="zero">Score zero (no award, no penalty)</option>
                <option value="penalty">Apply the wrong-answer penalty</option>
              </select>
            </label>
            <button onClick={saveConfig}>Save scoring</button>
          </div>

          {/* PDF import (extraction only) */}
          <div className="panel">
            <h3>Import from PDF</h3>
            <p className="muted">Extracts the questions/options already in your PDF (works for text or scanned PDFs). It never invents content — review afterward and set any missing correct answers.</p>
            <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={(e) => importPdf(e.target.files?.[0] ?? null)} />
            <button onClick={() => pdfRef.current?.click()}>Upload PDF</button>
          </div>
        </div>

        {/* Question editor */}
        <div className="panel editor">
          <h3>{draft.id ? 'Edit question' : 'Add a question'}</h3>
          <label>Question text
            <textarea value={draft.text} onChange={(e) => setField('text', e.target.value)} rows={2} />
          </label>

          <div className="media-editor">
            <div className="media-row">
              {draft.media.map((m) => (
                <div key={m.id} className="media-thumb">
                  {m.type === 'image'
                    ? <img src={(import.meta.env.VITE_API_URL || '') + m.url} alt="" />
                    : <video src={(import.meta.env.VITE_API_URL || '') + m.url} muted />}
                  <button className="x" onClick={() => setField('media', draft.media.filter((x) => x.id !== m.id))}>×</button>
                </div>
              ))}
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => uploadMedia(e.target.files)} />
            <button onClick={() => fileRef.current?.click()}>Add images / videos</button>
          </div>

          <div className="options-editor">
            <span className="control-label">Options (tick the correct one)</span>
            {draft.options.map((o) => (
              <div key={o.id} className="option-row">
                <input type="radio" name="correct" checked={draft.correctOptionId === o.id}
                  onChange={() => setField('correctOptionId', o.id)} />
                <input value={o.text} placeholder="Option text" onChange={(e) => setOptionText(o.id, e.target.value)} />
                <button className="x" disabled={draft.options.length <= 2} onClick={() => removeOption(o.id)}>×</button>
              </div>
            ))}
            <button onClick={addOption}>+ Add option</button>
            {draft.correctOptionId && (
              <button className="btn-link" onClick={() => setField('correctOptionId', null)}>Clear correct answer</button>
            )}
          </div>

          <details className="overrides">
            <summary>Per-question overrides (optional)</summary>
            <label>Correct points <input type="number" min={1} value={draft.correctPoints ?? ''} onChange={(e) => setField('correctPoints', e.target.value ? Number(e.target.value) : null)} /></label>
            <label>Wrong penalty <input type="number" min={0} value={draft.wrongPenalty ?? ''} onChange={(e) => setField('wrongPenalty', e.target.value ? Number(e.target.value) : null)} /></label>
            <label>Time limit (sec) <input type="number" min={1} value={draft.timeLimitSec ?? ''} onChange={(e) => setField('timeLimitSec', e.target.value ? Number(e.target.value) : null)} /></label>
          </details>

          <div className="editor-actions">
            <button className="primary" onClick={save}>{draft.id ? 'Update' : 'Add'} question</button>
            {draft.id && <button onClick={() => setDraft(emptyDraft())}>Cancel edit</button>}
          </div>
          {err && <p className="q-error">{err}</p>}
          {msg && <p className="q-ok">{msg}</p>}
        </div>

        {/* Existing questions */}
        <div className="panel">
          <h3>Quiz ({questions.length})</h3>
          <ol className="build-list">
            {questions.map((q) => (
              <li key={q.id}>
                <div>
                  <div className="q-text-sm">{q.text}</div>
                  <div className="muted">
                    {q.options.length} options · {q.correctOptionId ? 'answer set' : 'no answer set'}
                    {q.media.length > 0 && ` · ${q.media.length} media`}
                  </div>
                </div>
                <div className="row-actions">
                  <button onClick={() => editExisting(q)}>Edit</button>
                  <button className="danger" onClick={() => del(q.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
