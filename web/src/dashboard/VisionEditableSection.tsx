import { useState } from "react";
import { VisionSection } from "./components/VisionSection";
import { GoalForm, type GoalBody } from "./components/edit/GoalForm";
import { ScenarioForm, type ScenarioBody } from "./components/edit/ScenarioForm";
import { DocumentForm, type DocumentBody } from "./components/edit/DocumentForm";
import { ErrorNote } from "./components/ErrorNote";
import { putGoal, deleteGoal, putScenario, deleteScenario, putDocument, deleteDocument } from "./api";
import type { Goal, Scenario, Score, TestRun, DocumentRec, Verification } from "./types";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Produce a valid, non-colliding id from a title, falling back to a prefix. */
function genId(title: string, taken: Set<string>, prefix: string): string {
  let base = slugify(title) || prefix;
  let id = base;
  let n = 2;
  while (taken.has(id)) { id = `${base}-${n}`; n++; }
  return id;
}

export function VisionEditableSection({
  teamId, slug, goals, scenarios, scores, testRuns, documents, verifications = [],
}: {
  teamId: string; slug: string;
  goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; documents: DocumentRec[];
  verifications?: Verification[];
}) {
  const [open, setOpen] = useState<null | "goal" | "scenario" | "document">(null);
  const [editing, setEditing] = useState<null | { kind: "goal" | "scenario" | "document"; id: string }>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(which: "goal" | "scenario" | "document") {
    setError(null);
    setEditing(null);
    setOpen((cur) => (cur === which ? null : which));
  }

  function toggleEdit(kind: "goal" | "scenario" | "document", id: string) {
    setError(null);
    setOpen(null);
    setEditing((cur) => (cur && cur.kind === kind && cur.id === id ? null : { kind, id }));
  }

  function isEditing(kind: "goal" | "scenario" | "document", id: string) {
    return editing != null && editing.kind === kind && editing.id === id;
  }

  async function addGoal(body: GoalBody) {
    const taken = new Set(goals.map((g) => g.id));
    const id = genId(body.title, taken, "goal");
    await putGoal(teamId, slug, id, body);
    setOpen(null);
  }
  async function addScenario(body: ScenarioBody) {
    const taken = new Set(scenarios.map((s) => s.id));
    const id = genId(body.title, taken, "scenario");
    await putScenario(teamId, slug, id, body);
    setOpen(null);
  }
  async function addDocument(body: DocumentBody) {
    const taken = new Set(documents.map((d) => d.id));
    const id = genId(body.title, taken, "document");
    await putDocument(teamId, slug, id, body);
    setOpen(null);
  }

  // Edit: keep the EXISTING doc id (no slug regeneration), close the form on success.
  async function editGoal(id: string, body: GoalBody) {
    await putGoal(teamId, slug, id, body);
    setEditing(null);
  }
  async function editScenario(id: string, body: ScenarioBody) {
    await putScenario(teamId, slug, id, body);
    setEditing(null);
  }
  async function editDocument(id: string, body: DocumentBody) {
    await putDocument(teamId, slug, id, body);
    setEditing(null);
  }

  async function onDelete(kind: "goal" | "scenario" | "document", id: string) {
    setError(null);
    try {
      if (kind === "goal") await deleteGoal(teamId, slug, id);
      else if (kind === "scenario") await deleteScenario(teamId, slug, id);
      else await deleteDocument(teamId, slug, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="vision-editable">
      <div className="proj-section-head proj-section-head--actions">
        <h2 className="proj-section-title">Vision</h2>
        <div className="edit-actions">
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => toggle("goal")}>+ Add goal</button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => toggle("scenario")}>+ Add scenario</button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => toggle("document")}>+ Add document</button>
        </div>
      </div>

      {open === "goal" && <GoalForm onSave={addGoal} />}
      {open === "scenario" && <ScenarioForm goals={goals} onSave={addScenario} />}
      {open === "document" && <DocumentForm onSave={addDocument} />}
      {error && <ErrorNote message={error} />}

      {(goals.length > 0 || scenarios.length > 0) && (
        <VisionSection goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} verifications={verifications} />
      )}

      {(goals.length > 0 || scenarios.length > 0 || documents.length > 0) && (
        <div className="edit-listing">
          {goals.map((g) => (
            <div key={g.id}>
              <div className="edit-listing-row">
                <span className="dim">goal:</span> {g.title ?? g.id}
                <button className="btn btn-sm btn-ghost" type="button"
                  aria-label={`edit goal ${g.id}`} onClick={() => toggleEdit("goal", g.id)}>Edit</button>
                <button className="btn btn-sm btn-danger" type="button"
                  aria-label={`delete goal ${g.id}`} onClick={() => onDelete("goal", g.id)}>Delete</button>
              </div>
              {isEditing("goal", g.id) && (
                <GoalForm initial={{ title: g.title, description: g.description, order: g.order }}
                  onSave={(body) => editGoal(g.id, body)} />
              )}
            </div>
          ))}
          {scenarios.map((s) => (
            <div key={s.id}>
              <div className="edit-listing-row">
                <span className="dim">scenario:</span> {s.title ?? s.id}
                <button className="btn btn-sm btn-ghost" type="button"
                  aria-label={`edit scenario ${s.id}`} onClick={() => toggleEdit("scenario", s.id)}>Edit</button>
                <button className="btn btn-sm btn-danger" type="button"
                  aria-label={`delete scenario ${s.id}`} onClick={() => onDelete("scenario", s.id)}>Delete</button>
              </div>
              {isEditing("scenario", s.id) && (
                <ScenarioForm goals={goals}
                  initial={{ goalId: s.goalId, title: s.title, description: s.description, order: s.order, threshold: s.threshold, rubric: s.rubric }}
                  onSave={(body) => editScenario(s.id, body)} />
              )}
            </div>
          ))}
          {documents.map((d) => (
            <div key={d.id}>
              <div className="edit-listing-row">
                <span className="dim">document:</span> {d.title ?? d.id}
                <button className="btn btn-sm btn-ghost" type="button"
                  aria-label={`edit document ${d.id}`} onClick={() => toggleEdit("document", d.id)}>Edit</button>
                <button className="btn btn-sm btn-danger" type="button"
                  aria-label={`delete document ${d.id}`} onClick={() => onDelete("document", d.id)}>Delete</button>
              </div>
              {isEditing("document", d.id) && (
                <DocumentForm initial={{ kind: d.kind, title: d.title, format: d.format, content: d.content }}
                  onSave={(body) => editDocument(d.id, body)} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
