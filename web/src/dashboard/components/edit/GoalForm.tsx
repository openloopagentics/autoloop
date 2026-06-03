import { useState } from "react";

export interface GoalBody { title: string; description?: string; order?: number; }

export function GoalForm({ initial, onSave }: { initial?: { title?: string; description?: string; order?: number }; onSave: (body: GoalBody) => Promise<void> }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [order, setOrder] = useState(initial?.order != null ? String(initial.order) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = initial != null;
  const canSubmit = title.trim().length > 0 && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const body: GoalBody = { title: title.trim() };
    if (description.trim()) body.description = description.trim();
    if (order.trim() && !Number.isNaN(Number(order))) body.order = Number(order);
    try {
      await onSave(body);
      if (!editing) { setTitle(""); setDescription(""); setOrder(""); }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="edit-form" onSubmit={submit}>
      <input className="input" aria-label="Goal title" placeholder="Goal title"
        value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input" aria-label="Goal description" placeholder="Description (optional)"
        value={description} onChange={(e) => setDescription(e.target.value)} />
      <input className="input input-num" aria-label="Goal order" placeholder="Order" type="number"
        value={order} onChange={(e) => setOrder(e.target.value)} />
      <button className="btn btn-sm" type="submit" disabled={!canSubmit}>{editing ? "Save goal" : "Add goal"}</button>
      {error && <p role="alert" className="err edit-err">{error}</p>}
    </form>
  );
}
