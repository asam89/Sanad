"use client";

import { useState } from "react";

type Bubble = { kind: "in" | "out" | "sys"; text: string; meta?: string };

const SUGGESTIONS = [
  "When is my daughter's next practice?",
  "How much is the girls basketball program?",
  "Where is the gym and is there parking?",
  "What's your refund policy?",
  "What should my son bring to the first session?",
  "Can I register my 14 year old?",
  "Do you offer a sibling discount?",
  "My kid got hurt at practice yesterday",
  "STOP",
];

export function Simulator() {
  const [from, setFrom] = useState("+14165550100");
  const [text, setText] = useState("");
  const [thread, setThread] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setText("");
    setThread((t) => [...t, { kind: "in", text: message }]);
    try {
      const res = await fetch("/api/sanad/admin/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, body: message }),
      });
      const data = (await res.json()) as {
        error?: string;
        result?: { outcome: string; path?: string; intent?: string; reason?: string };
        replies?: string[];
        adminNotices?: string[];
        latencyMs?: number;
      };
      if (!res.ok || !data.result) {
        setThread((t) => [...t, { kind: "sys", text: `Error: ${data.error ?? res.status}` }]);
        return;
      }
      const r = data.result;
      const meta = [r.outcome, r.path, r.intent, r.reason, `${data.latencyMs} ms`].filter(Boolean).join(" · ");
      const bubbles: Bubble[] = (data.replies ?? []).map((reply, i) => ({ kind: "out", text: reply, meta: i === 0 ? meta : undefined }));
      if (bubbles.length === 0) bubbles.push({ kind: "sys", text: `No reply sent (${meta})` });
      for (const n of data.adminNotices ?? []) bubbles.push({ kind: "sys", text: `→ admin WhatsApp: ${n}` });
      setThread((t) => [...t, ...bubbles]);
    } catch (err) {
      setThread((t) => [...t, { kind: "sys", text: `Network error: ${String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <label className="muted">
        Parent phone (E.164)&nbsp;
        <input type="tel" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 200 }} />
      </label>
      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => send(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <div className="thread">
        {thread.length === 0 && <div className="muted">Pick a suggestion or type a message.</div>}
        {thread.map((b, i) => (
          <div key={i} className={`bubble ${b.kind}`}>
            {b.text}
            {b.meta && <span className="meta">{b.meta}</span>}
          </div>
        ))}
        {busy && <div className="bubble out muted">…</div>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type as the parent…" disabled={busy} />
        <button type="submit" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
