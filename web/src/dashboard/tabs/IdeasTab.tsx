import { useState } from "react";
import { IdeaItem } from "../components/IdeaItem";
import { ErrorNote } from "../components/ErrorNote";
import { sortIdeas, moveIdea, ideaIdFor } from "../ideasView";
import type { Idea } from "../types";

export function IdeasTab({ ideas, onPut }: {
  ideas: Idea[];
  onPut: (id: string, body: object) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = sortIdeas(ideas);

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Idea update failed"); }
    finally { setBusy(false); }
  }

  function handleMove(id: string, dir: "up" | "down") {
    const writes = moveIdea(ideas, id, dir);
    if (writes.length === 0) return;
    void guard(async () => { for (const w of writes) await onPut(w.id, { order: w.order }); });
  }

  async function handleAdd() {
    if (!title.trim()) return;
    const id = ideaIdFor(title.trim(), new Set(ideas.map((i) => i.id)));
    const body: Record<string, unknown> = { title: title.trim(), status: "proposed", order: 100 };
    if (rationale.trim()) body.rationale = rationale.trim();
    await guard(async () => { await onPut(id, body); setTitle(""); setRationale(""); });
  }

  const bandIndex = (id: string) => {
    const me = sorted.find((i) => i.id === id);
    const band = sorted.filter((i) => (i.status ?? "proposed") === (me?.status ?? "proposed"));
    return { idx: band.findIndex((i) => i.id === id), len: band.length };
  };

  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Ideas</h2></div>
      {error && <ErrorNote message={error} />}
      {sorted.length === 0 ? <div className="empty">No ideas yet.</div> : (
        <div className="idealist">
          {sorted.map((i) => {
            const { idx, len } = bandIndex(i.id);
            return <IdeaItem key={i.id} idea={i} canMoveUp={idx > 0} canMoveDown={idx < len - 1}
              onPut={onPut} onMove={handleMove} />;
          })}
        </div>
      )}
      <div className="ideacompose">
        <input className="ideacompose-title" placeholder="Idea title…" value={title}
          onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <textarea className="ideacompose-rationale" placeholder="Rationale (optional)…" rows={2}
          value={rationale} onChange={(e) => setRationale(e.target.value)} disabled={busy} />
        <button type="button" className="btn ideacompose-add" onClick={() => void handleAdd()}
          disabled={busy || !title.trim()}>Add idea</button>
      </div>
    </section>
  );
}
