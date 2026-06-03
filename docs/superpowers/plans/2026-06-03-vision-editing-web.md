# Vision Editing — Web Forms Implementation Plan (#5b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in member author/edit a web-owned project's vision from the browser — create a project, add/edit/delete goals, scenarios (with a rubric-criteria editor + threshold), and documents — calling the #5a `/v1/u/...` endpoints. Loop-owned projects stay read-only (no controls).

**Architecture:** A small ID-token write client (`dashboard/api.ts`, mirroring `keys/client.ts`) + presentational form components rendered inside the existing #4 Vision section, shown only when `project.visionOwner !== "loop"`. Live `onSnapshot` (from #4) reflects changes — no manual refetch. A minimal "New project" form on the dashboard home for web-first start.

**Tech Stack:** React + react-router-dom + Firebase JS SDK (ID token via `auth.currentUser.getIdToken()`), Vitest + jsdom + @testing-library/react (existing `web` harness), the single `web/src/index.css`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-vision-editing-design.md` ; **builds on** the merged #4 read-only UI and the #5a backend (`/v1/u/teams/:teamId/projects/...`).

---

## Background / conventions (read before Task 1)

- **Write client pattern** (`web/src/keys/client.ts`): `BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")`; `headers()` adds `Authorization: Bearer ${await auth.currentUser!.getIdToken()}` + JSON content-type; `parse(res)` throws `Error(error.message)` on non-2xx. Mirror this exactly for `dashboard/api.ts`.
- **Endpoints (from #5a):** `PUT /v1/u/teams/:teamId/projects/:slug` (body `{title,status}`), `PUT …/goals/:goalId` (`goalBody`), `DELETE …/goals/:goalId`, `PUT …/scenarios/:scenarioId` (`scenarioBody`), `DELETE …/scenarios/:scenarioId`, `PUT …/documents/:docId` (`documentBody`), `DELETE …/documents/:docId`. All return `{ ok: true }` or throw.
- **Editability:** a project is web-editable iff `project.visionOwner !== "loop"` (absent ⇒ editable). The `Project` type already gains `visionOwner?: "web" | "loop"` in #5a's plan — confirm it's in `web/src/dashboard/types.ts`; if not, add it.
- **Components are presentational + render-tested** with props and a **mocked client** (vi.mock or an injected callback). Follow `web/src/dashboard/components/detail.test.tsx` / `vision.test.tsx` idiom. Forms manage local `useState`, call an `onSubmit`/client fn, surface errors inline.
- **Live updates:** after a successful write, the open `onSnapshot` subscriptions (#4 `useGoals`/`useScenarios`/`useDocuments`) re-render automatically — do NOT manually refetch.
- **Schema-matching client validation:** title non-empty; rubric criterion `{name non-empty, weight>0, max integer ≥1}`; threshold 0..100 (optional). Mirror the zod rules so the server rarely 400s.
- **Commands:** `cd web && npm test` (vitest run, jsdom), single file `npx vitest run src/dashboard/<file>`, `cd web && npm run build` (tsc -b + vite). Do NOT `git add -A`.
- **Scope:** edit controls live in the Vision area (and a New-project form on the dashboard home). Reordering is via the numeric `order` field (no drag-drop). Loop-owned ⇒ read-only.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/dashboard/api.ts` | ID-token write client (put/delete project/goal/scenario/document) | 1 |
| `web/src/dashboard/types.ts` | ensure `visionOwner?` on `Project` (from #5a) | 1 |
| `web/src/dashboard/components/edit/GoalForm.tsx` | add/edit a goal | 2 |
| `web/src/dashboard/components/edit/ScenarioForm.tsx` | add/edit a scenario + rubric-criteria editor | 3 |
| `web/src/dashboard/components/edit/DocumentForm.tsx` | add/edit a document | 4 |
| `web/src/dashboard/components/edit/NewProjectForm.tsx` | create a web project (dashboard home) | 5 |
| `web/src/dashboard/components/edit/*.test.tsx` | render+submit tests (mocked client) | 2–5 |
| `web/src/dashboard/VisionEditableSection.tsx` (or extend `VisionSection`) | wire forms + delete buttons when web-editable | 6 |
| `web/src/dashboard/ProjectDetail.tsx`, `DashboardHome.tsx` | mount the editable section + New-project | 6 |
| `web/src/index.css` | form/control styles | 6 |

---

## Task 1: Write client + Project type

**Files:** Create `web/src/dashboard/api.ts`; Modify `web/src/dashboard/types.ts` (if `visionOwner` missing).

- [ ] **Step 1: Confirm/add the type** — ensure `web/src/dashboard/types.ts` `Project` has `visionOwner?: "web" | "loop"`. (Added in #5a; if absent, add it.)

- [ ] **Step 2: Write the client** (`web/src/dashboard/api.ts`) — mirror `web/src/keys/client.ts` (`BASE`, `headers()`, `parse()`):

```typescript
import { auth } from "../firebase";
import type { GoalBodyInput, ScenarioBodyInput, DocumentBodyInput } from "./types"; // see note

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function headers(): Promise<HeadersInit> {
  const token = await auth.currentUser!.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
async function ok(res: Response): Promise<void> {
  if (!res.ok) { let m = `HTTP ${res.status}`; try { m = (await res.json())?.error?.message ?? m; } catch { /* */ } throw new Error(m); }
}
function u(teamId: string, slug: string, rest = ""): string {
  return `${BASE}/v1/u/teams/${teamId}/projects/${slug}${rest}`;
}
export async function putProject(teamId: string, slug: string, body: { title: string; status?: string }) {
  await ok(await fetch(u(teamId, slug), { method: "PUT", headers: await headers(), body: JSON.stringify({ status: "running", ...body }) }));
}
export async function putGoal(teamId: string, slug: string, id: string, body: object) {
  await ok(await fetch(u(teamId, slug, `/goals/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}
export async function deleteGoal(teamId: string, slug: string, id: string) {
  await ok(await fetch(u(teamId, slug, `/goals/${id}`), { method: "DELETE", headers: await headers() }));
}
export async function putScenario(teamId: string, slug: string, id: string, body: object) {
  await ok(await fetch(u(teamId, slug, `/scenarios/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}
export async function deleteScenario(teamId: string, slug: string, id: string) {
  await ok(await fetch(u(teamId, slug, `/scenarios/${id}`), { method: "DELETE", headers: await headers() }));
}
export async function putDocument(teamId: string, slug: string, id: string, body: object) {
  await ok(await fetch(u(teamId, slug, `/documents/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}
export async function deleteDocument(teamId: string, slug: string, id: string) {
  await ok(await fetch(u(teamId, slug, `/documents/${id}`), { method: "DELETE", headers: await headers() }));
}
```
NOTE: the `GoalBodyInput` etc. imports are optional typing sugar — `body: object` is fine; drop the import if you don't add those types. Keep it dependency-free and matching keys/client.ts style.

- [ ] **Step 3: Build** — `cd web && npm run build` → 0 errors.

- [ ] **Step 4: Commit**
```bash
git add web/src/dashboard/api.ts web/src/dashboard/types.ts
git commit -m "feat(web): ID-token write client for /v1/u vision editing"
```

---

## Task 2: GoalForm (add/edit) + test

**Files:** Create `web/src/dashboard/components/edit/GoalForm.tsx`, `web/src/dashboard/components/edit/edit.test.tsx`.

- [ ] **Step 1: Write the failing test** (`edit.test.tsx`)

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GoalForm } from "./GoalForm";

describe("GoalForm", () => {
  it("submits title + order via onSave and clears", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<GoalForm onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/goal title/i), { target: { value: "Ship" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Ship" })));
  });
  it("disables submit when title is empty", () => {
    render(<GoalForm onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add goal/i })).toBeDisabled();
  });
  it("shows an error when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    render(<GoalForm onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/goal title/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    await waitFor(() => expect(screen.getByText(/nope/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run → fail** — `cd web && npx vitest run src/dashboard/components/edit`.

- [ ] **Step 3: Implement `GoalForm.tsx`** — a presentational form: props `{ initial?: {id,title,description,order}, onSave: (body) => Promise<void> }`. Local state for title/description/order; an `id` field when creating (or derive a slug). On submit: validate title non-empty, call `onSave({ title, description, order })`, catch → set error message, clear on success. Disable submit when title empty or pending. Use existing form/input classes (see `keys/components/KeyMintForm.tsx` for the idiom).

(The container in Task 6 supplies `onSave = (body) => putGoal(teamId, slug, id, body)` and a generated id for new goals, e.g. slugify(title).)

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(web): goal add/edit form`.

---

## Task 3: ScenarioForm (with rubric-criteria editor) + test

**Files:** Create `web/src/dashboard/components/edit/ScenarioForm.tsx`; extend `edit.test.tsx`.

- [ ] **Step 1: Failing test** — render `ScenarioForm` with `goals={[{id:"g1",title:"G"}]}` and `onSave`; fill title, select goal, add a rubric criterion row (name "Correctness", weight 3, max 5), submit; assert `onSave` called with `{ goalId:"g1", title, rubric:{criteria:[{id,name:"Correctness",weight:3,max:5}]} }`. Test add/remove criterion rows and that submit is disabled with no criteria or empty title.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `ScenarioForm.tsx`** — props `{ initial?, goals: Goal[], onSave }`. Fields: title, description, goal `<select>` (from `goals`), order, threshold (optional, 0..100), and a **rubric-criteria editor**: a list of rows `{name, weight, max}` with "add criterion"/"remove" buttons; each row generates a stable `id` (slugify(name) or `c{n}`). Validate: title non-empty, ≥1 criterion, each weight>0 & max integer≥1, threshold (if set) 0..100. On submit call `onSave({ goalId, title, description, order, threshold?, rubric: { criteria } })`. Inline error on reject.

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(web): scenario form with rubric-criteria editor`.

---

## Task 4: DocumentForm (add/edit) + test

**Files:** Create `web/src/dashboard/components/edit/DocumentForm.tsx`; extend `edit.test.tsx`.

- [ ] **Step 1: Failing test** — render `DocumentForm` + `onSave`; fill kind, title, choose format (markdown|url) `<select>`, content; submit; assert `onSave` called with `{ kind, title, format, content }`. Disable submit if any required field empty.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `DocumentForm.tsx`** — props `{ initial?, onSave }`. Fields kind, title, format select, content textarea. Validate all non-empty + content ≤ 100KB. `onSave({ kind, title, format, content })`. Inline error.

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(web): document add/edit form`.

---

## Task 5: NewProjectForm + test

**Files:** Create `web/src/dashboard/components/edit/NewProjectForm.tsx`; extend `edit.test.tsx`.

- [ ] **Step 1: Failing test** — render `NewProjectForm` with `teams={[{teamId:"t1",role:"member"}]}` + `onCreate`; pick team, enter slug "web" + title "Web"; submit; assert `onCreate` called with `{ teamId:"t1", slug:"web", title:"Web" }`. Validate slug matches `^[a-z0-9._-]+$` and title non-empty (disable otherwise).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `NewProjectForm.tsx`** — props `{ teams: TeamRef[], onCreate: ({teamId,slug,title}) => Promise<void> }`. Team `<select>`, slug input (validate id pattern), title input. On submit call `onCreate(...)`, inline error. (Container in Task 6 wires `onCreate = ({teamId,slug,title}) => putProject(teamId, slug, {title})` then navigates to `/dashboard/${teamId}/${slug}`.)

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(web): new-project form`.

---

## Task 6: Wire editing into the dashboard + CSS

**Files:** Modify `web/src/dashboard/ProjectDetail.tsx`, `web/src/dashboard/DashboardHome.tsx`, `web/src/index.css`; create container wiring as needed.

- [ ] **Step 1: ProjectDetail — editable vision when web-owned.**
  - Compute `editable = project.data && project.data.visionOwner !== "loop"`.
  - When `editable`, render the edit affordances alongside the read-only Vision section: an "Add goal" (`GoalForm` → `putGoal(teamId, slug, slugify(title), body)`), per-goal "Add scenario"/delete, per-scenario edit/delete (`ScenarioForm`/`deleteScenario`), an "Add document" (`DocumentForm`), and delete buttons — each calling the `dashboard/api.ts` client. Errors surface inline (reuse `ErrorNote`). The live `onSnapshot` hooks re-render on success.
  - When NOT editable (loop-owned), render exactly the #4 read-only view (no controls).
  - Keep it tasteful: a compact "＋ Add" control that toggles the relevant form; edit pencil/delete on each card. Generated ids: `slugify(title)` for new goals/scenarios/documents (validate against id pattern; if slug empty/dup, append a short suffix).

- [ ] **Step 2: DashboardHome — New project.** Add a "New project" control rendering `NewProjectForm` (teams from `useMyTeams`) → `putProject` → `navigate('/dashboard/${teamId}/${slug}')`.

- [ ] **Step 3: CSS** — append form/control classes to `web/src/index.css` (inputs, the criteria-editor rows, add/delete buttons, the toggle), on the existing palette. Reuse existing input/button classes where they exist (see `keys` components).

- [ ] **Step 4: Build + full web tests** — `cd web && npm run build && npm test` → clean + all green (edit tests + #4 vision tests + existing).

- [ ] **Step 5: Commit**
```bash
git add web/src/dashboard/ProjectDetail.tsx web/src/dashboard/DashboardHome.tsx web/src/index.css web/src/dashboard/components/edit/
git commit -m "feat(web): wire vision editing into the dashboard (web-owned projects)"
```

---

## Task 7: Verification

- [ ] **Step 1:** `cd web && npm test` → all green (edit.test.tsx, vision.test.tsx, existing dashboard/auth/teams tests).
- [ ] **Step 2:** `cd web && npm run build` → clean.
- [ ] **Step 3:** Confirm: editable controls appear only when `visionOwner !== "loop"`; a loop-owned project shows the read-only #4 view; the New-project flow creates a project and navigates to it; all writes go through `dashboard/api.ts` (ID token). No change under `functions/`/`firestore.rules`/`cli/`.
- [ ] **Step 4:** Final commit if needed.

---

## Notes for the executor
- Forms are presentational + render-tested with a **mocked `onSave`/`onCreate`** — do NOT call Firestore/fetch in component tests. The container (ProjectDetail/DashboardHome) binds the real `dashboard/api.ts` calls.
- **Loop-owned ⇒ strictly read-only** — gate every edit affordance on `visionOwner !== "loop"`.
- Mirror `keys/client.ts` for the write client and `keys/components/KeyMintForm.tsx` for the form idiom (local state, pending, inline error).
- Generated ids must match `^[a-z0-9._-]+$`; slugify titles and guard empties/dupes.
- No new deps. CSS in the single `web/src/index.css`. Do NOT `git add -A`.
