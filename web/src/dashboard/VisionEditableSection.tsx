import { useState } from "react";
import { VisionSection } from "./components/VisionSection";
import { GoalForm, type GoalBody } from "./components/edit/GoalForm";
import { ScenarioForm, type ScenarioBody } from "./components/edit/ScenarioForm";
import { DocumentForm, type DocumentBody } from "./components/edit/DocumentForm";
import { ErrorNote } from "./components/ErrorNote";
import { putGoal, deleteGoal, putScenario, deleteScenario, putDocument, deleteDocument } from "./api";
import type { Goal, Scenario, Score, TestRun, DocumentRec } from "./types";

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
  teamId, slug, goals, scenarios, scores, testRuns, documents,
}: {
  teamId: string; slug: string;
  goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; documents: DocumentRec[];
}) {
  const [open, setOpen] = useState<null | "goal" | "scenario" | "document">(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(which: "goal" | "scenario" | "document") {
    setError(null);
    setOpen((cur) => (cur === which ? null : which));
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
        <VisionSection goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} />
      )}

      {(goals.length > 0 || scenarios.length > 0) && (
        <div className="edit-listing">
          {goals.map((g) => (
            <div key={g.id} className="edit-listing-row">
              <span className="dim">goal:</span> {g.title ?? g.id}
              <button className="btn btn-sm btn-danger" type="button"
                aria-label={`delete goal ${g.id}`} onClick={() => onDelete("goal", g.id)}>Delete</button>
            </div>
          ))}
          {scenarios.map((s) => (
            <div key={s.id} className="edit-listing-row">
              <span className="dim">scenario:</span> {s.title ?? s.id}
              <button className="btn btn-sm btn-danger" type="button"
                aria-label={`delete scenario ${s.id}`} onClick={() => onDelete("scenario", s.id)}>Delete</button>
            </div>
          ))}
          {documents.map((d) => (
            <div key={d.id} className="edit-listing-row">
              <span className="dim">document:</span> {d.title ?? d.id}
              <button className="btn btn-sm btn-danger" type="button"
                aria-label={`delete document ${d.id}`} onClick={() => onDelete("document", d.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
