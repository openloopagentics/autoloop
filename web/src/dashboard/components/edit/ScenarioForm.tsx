import { useState } from "react";
import type { Goal, RubricCriterion } from "../../types";

export interface ScenarioBody {
  goalId?: string;
  title: string;
  description?: string;
  order?: number;
  threshold?: number;
  rubric: { criteria: RubricCriterion[] };
}

interface CriterionRow { name: string; weight: string; max: string; }

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

const emptyRow = (): CriterionRow => ({ name: "", weight: "1", max: "5" });

export function ScenarioForm({ initial, goals, onSave }: {
  initial?: { goalId?: string; title?: string; description?: string; order?: number; threshold?: number; rubric?: { criteria: RubricCriterion[] } };
  goals: Goal[];
  onSave: (body: ScenarioBody) => Promise<void>;
}) {
  const editing = initial != null;
  const [goalId, setGoalId] = useState(initial?.goalId ?? (goals[0]?.id ?? ""));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [order, setOrder] = useState(initial?.order != null ? String(initial.order) : "");
  const [threshold, setThreshold] = useState(initial?.threshold != null ? String(initial.threshold) : "");
  const [rows, setRows] = useState<CriterionRow[]>(
    initial?.rubric?.criteria?.length
      ? initial.rubric.criteria.map((c) => ({ name: c.name, weight: String(c.weight), max: String(c.max) }))
      : [emptyRow()],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setRow(i: number, patch: Partial<CriterionRow>) {
    setRows((rs) => rs.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  }
  function addRow() { setRows((rs) => [...rs, emptyRow()]); }
  function removeRow(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); }

  const validRows = rows.filter((r) => r.name.trim() && Number(r.weight) > 0 && Number.isInteger(Number(r.max)) && Number(r.max) >= 1);
  const thresholdNum = threshold.trim() === "" ? null : Number(threshold);
  const thresholdValid = thresholdNum === null || (!Number.isNaN(thresholdNum) && thresholdNum >= 0 && thresholdNum <= 100);
  const canSubmit = title.trim().length > 0 && validRows.length === rows.length && rows.length > 0 && thresholdValid && !pending;

  function buildCriteria(): RubricCriterion[] {
    const seen = new Set<string>();
    return rows.map((r, i) => {
      let id = slugify(r.name) || `c${i + 1}`;
      while (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      return { id, name: r.name.trim(), weight: Number(r.weight), max: Number(r.max) };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const body: ScenarioBody = { title: title.trim(), rubric: { criteria: buildCriteria() } };
    if (goalId) body.goalId = goalId;
    if (description.trim()) body.description = description.trim();
    if (order.trim() && !Number.isNaN(Number(order))) body.order = Number(order);
    if (thresholdNum !== null) body.threshold = thresholdNum;
    try {
      await onSave(body);
      if (!editing) {
        setTitle(""); setDescription(""); setOrder(""); setThreshold(""); setRows([emptyRow()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="edit-form edit-form--col" onSubmit={submit}>
      <input className="input" aria-label="Scenario title" placeholder="Scenario title"
        value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input" aria-label="Scenario description" placeholder="Description (optional)"
        value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="edit-row">
        <select className="select" aria-label="Goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          <option value="">(no goal)</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title ?? g.id}</option>)}
        </select>
        <input className="input input-num" aria-label="Scenario order" placeholder="Order" type="number"
          value={order} onChange={(e) => setOrder(e.target.value)} />
        <input className="input input-num" aria-label="Threshold" placeholder="Threshold 0-100" type="number"
          value={threshold} onChange={(e) => setThreshold(e.target.value)} />
      </div>

      <div className="criteria-editor">
        <span className="edit-label dim">Rubric criteria</span>
        {rows.map((r, i) => (
          <div key={i} className="criterion-row">
            <input className="input" aria-label={`criterion ${i + 1} name`} placeholder="Name"
              value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
            <input className="input input-num" aria-label={`criterion ${i + 1} weight`} placeholder="Weight" type="number"
              value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value })} />
            <input className="input input-num" aria-label={`criterion ${i + 1} max`} placeholder="Max" type="number"
              value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} />
            <button className="btn btn-sm btn-danger" type="button" aria-label={`remove criterion ${i + 1}`}
              onClick={() => removeRow(i)} disabled={rows.length === 1}>×</button>
          </div>
        ))}
        <button className="btn btn-sm btn-ghost" type="button" onClick={addRow}>+ Add criterion</button>
      </div>

      <div className="edit-row">
        <button className="btn btn-sm" type="submit" disabled={!canSubmit}>{editing ? "Save scenario" : "Add scenario"}</button>
      </div>
      {error && <p role="alert" className="err edit-err">{error}</p>}
    </form>
  );
}
