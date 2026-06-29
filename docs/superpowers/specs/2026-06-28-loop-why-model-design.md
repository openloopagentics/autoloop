# Loop legibility — the "why" model (SP1)

**Date:** 2026-06-28
**Status:** Design — approved, pending spec review
**Scope:** SP1 of a 3-part initiative. This spec covers the data model and capture
only. The visible surfaces (graph, vision, timeline) are SP2/SP3 and are out of scope
here except as consumers.

## Problem

The loop emits a lot of evidence — scores, test-runs, verifications, revisions, vision
changes, bugs — but the *reasoning* connecting it is buried or thrown away. Two concrete
symptoms, in the user's words: "the graph is dumb" and "I want to see why each loop is
deciding to do the things it does."

Today's map (`web/src/dashboard/mapView.ts`, `components/MapCanvas.tsx`) is a static
structural DAG (goal → scenario → task → bug). It shows *what exists*, never *why*. And
the rationale the loop already records is mostly invisible:

- `revision.trigger.reason` — only in the Loops drilldown, never linked to the map.
- `score.criteria` / `score.note` — fetched, never rendered.
- `verification.summary` — only a ✓/✗ badge shows; the reason is dropped.
- `visionChange.reason` / `prior` / `payload` — reason shown, diff never rendered.
- `testRun.issues` — never shown.
- "Unmet" is a binary — the UI never says *which* of the three conditions failed.

Some "why" is not recorded at all: why a loop picked its goal, what approach a task took,
and the dead-ends the loop hit when stuck.

## Goals

- Define **one shared "why" model** that any surface (graph, vision tab, timeline) can
  render. The graph is the eventual hero (SP2), but the model is surface-agnostic.
- Make the model populated from **existing records immediately**, with **no migration**.
- Add a **minimal new `decision` record** to capture the three genuinely-missing moments
  (goal choice, task approach, dead-ends) without burdening the driver.
- Ship SP1 as **model + capture + tests**, fully unit-tested, so SP2/SP3 are thin views.

## Non-goals

- No new UI surface in SP1 (the graph redesign is SP2; inline vision + timeline are SP3).
- SP1 does not change the **canonical** met rule (`docs/concepts.md`: test failed === 0,
  composite ≥ threshold, **and** not refuted). It *does* bring the **web's displayed**
  met-state into line with that canonical rule. Today `web/src/dashboard/scenarioState.ts`
  (`deriveScenarioState`) computes met from only two conditions and never imports
  verification, so a refuted-but-high-scoring scenario currently renders `met` — a latent
  divergence from the canonical definition. SP1's `Explanation.state` is verification-aware
  (all three conditions); consolidating the dashboard onto this single source of truth is
  an SP2 task (see Risks). No backfill, no API/status-field change.
- No server-side derivation of the model. Derivation stays client-side (like `mapView.ts`).
- No backfill of `decision` records for historical loops.

## The initiative (for context)

| Sub-project | Deliverable |
|---|---|
| **SP1 (this spec)** | The "why" model + the `decision` record + capture (CLI/driver) + tests. No UI. |
| SP2 | The explanation graph — the hero surface, rendered from the model. |
| SP3 | Self-explaining vision (inline met/unmet + rubric breakdown) and a per-loop reasoning timeline. |

Sequencing is **model-first**: the model is populated from existing rationale on day one,
so when SP2 lands the graph lights up without further plumbing. New `decision` records
enrich it as the driver adopts them.

## The "why" model

A normalized, derived structure. Three kinds of node plus typed edges:

- **Subjects** — the things that have a state and a why: `Loop`, `Goal`, `Scenario`,
  `Task`, `Bug`. Each carries a computed `explanation`.
- **Decisions** — a fork the loop took, with rationale. One unified concept, three
  sources: the new `decision` record (`goal-pick` | `approach` | `stuck`), plus existing
  `revision`s (mapped to `plan-change`) and `visionChange`s (mapped to `vision-change`).
- **Evidence** — facts that justify a state: `score`, `test-run`, `verification`,
  `commit`. Linked to subjects as `supports` or `refutes`.

### Shapes (TypeScript, in `web/src/dashboard/whyModel.ts`)

```ts
type SubjectKind = "loop" | "goal" | "scenario" | "task" | "bug";
type DecisionKind =
  | "goal-pick" | "approach" | "stuck"      // from the new decision record
  | "plan-change" | "vision-change";        // adapted from revisions / visionChanges

interface WhySubject {
  id: string;                 // namespaced: "scenario:<id>", "task:<id>", …
  kind: SubjectKind;
  label: string;
  loopId?: string;
  explanation?: Explanation;  // scenarios carry met/unmet + reasons; other kinds carry a bare state, no reasons
}

interface Explanation {       // why a subject is in its state
  state: "met" | "unmet" | "neutral" | "active" | "bugged";
  reasons: ExplanationReason[];
}
interface ExplanationReason {
  kind: "score" | "test" | "verification" | "missing";
  ok: boolean;                // did this condition pass?
  text: string;               // "score 72 < threshold 80", "2 tests failing", …
  evidenceId?: string;        // link back into Evidence
}

interface WhyDecision {
  id: string;
  kind: DecisionKind;
  loopId: string;
  summary: string;
  rationale: string;
  alternatives?: string[];
  refs: { scenarioIds: string[]; taskIds: string[]; commitShas: string[] };
  at: string;                 // ISO; from createdAt
  source: "decision" | "revision" | "visionChange" | "synthesized";
}

interface WhyEvidence {
  id: string;
  kind: "score" | "test-run" | "verification" | "commit";
  subjectId: string;          // the subject it bears on
  relation: "supports" | "refutes";
  detail: Record<string, unknown>;  // criteria, note, issues, summary, verdict, …
}

type WhyEdge =
  | { type: "structure"; from: string; to: string }   // goal→scenario, scenario→task
  | { type: "affects"; from: string; to: string; decisionId: string }
  | { type: "evidence"; from: string; to: string; evidenceId: string };

interface WhyModel {
  subjects: WhySubject[];
  decisions: WhyDecision[];
  evidence: WhyEvidence[];
  edges: WhyEdge[];
}
```

`buildWhyModel(inputs): WhyModel` is a pure function — same spirit and call site as
today's `buildMap()`. Inputs are the data the dashboard already loads (goals, scenarios,
tasks, bugs, scores, testRuns, verifications, revisions, visionChanges, ideas) plus the
new `decisions`. SP2 will likely re-express `mapView.ts` on top of `whyModel.ts`; that
refactor is SP2's concern, not SP1's.

### Scenario explanation derivation

The existing met rule is unchanged; we record *why* per condition
(`web/src/dashboard/scenarioState.ts` is the source of the rule):

1. `score` — `ok` iff `composite ≥ threshold`; text carries composite, threshold, the
   per-criterion breakdown, and `note`.
2. `test` — `ok` iff a latest test-run exists and `failed === 0`; text carries the failed
   count and `issues`.
3. `verification` — `ok` iff not `refuted`; text carries `summary` when refuted.

`state = "met"` iff all three `ok`; otherwise `"unmet"` with the failing reasons first.
A missing score or test-run yields a `kind: "missing"` reason ("no test run yet").

> **This is the canonical 3-condition rule from `docs/concepts.md`.** Today's
> `deriveScenarioState` uses only conditions 1–2 (it never imports verification), so a
> refuted-but-high-scoring scenario currently renders `met`. SP1 defines the corrected,
> verification-aware state; SP2 then consolidates `mapView`/`scenarioState` onto the
> why-model so there is exactly one source of truth (see Risks).

## The `decision` record

A new append-only event under a loop, parallel to scores/test-runs/revisions:

```
teams/{teamId}/projects/{slug}/loops/{loopId}/decisions/{id}
```

### Schema (`functions/src/schemas.ts` — `decisionBody`)

| field | required | rule |
|---|---|---|
| `kind` | ✓ | enum `goal-pick` \| `approach` \| `stuck` |
| `summary` | ✓ | string, 1–200 chars |
| `rationale` | ✓ | string, 1–4096 chars |
| `alternatives` | — | string[]; each 1–500 chars; ≤ 10 items |
| `refs` | — | `{ scenarioIds?: string[]; taskIds?: string[]; commitShas?: string[] }`, each id matching the existing id pattern |
| `by` | — | string ≤ 200 |

Server-owned: `id` (ULID, uppercase — like `visionChange`/`message` ids, **not** the
lowercase `idPattern`), `loopId`, `createdAt`. **Append-only and immutable** — no upsert,
no edit, no delete (mirrors `visionChanges` semantics).

Deliberately, the record covers only the three missing moments:

- **`why this loop/goal`** → `goal-pick`, emitted once at loop start.
- **`why this task`** → `approach` for a non-obvious approach; *plan* changes already live
  in `revisions` (the model adapts those, no duplication).
- **`why stuck`** → `stuck` when a scenario won't converge or the loop blocks/pauses.
- **`why met/unmet`** is **not** a decision — it is derived from evidence.

### Storage / service / route

- New `functions/src/services/decisions.ts` — `addDecision()` (validate, stamp ULID +
  `createdAt`, write) and `listDecisions(limit)` capped like the SP1-adjacent list
  endpoints (`functions/src/pagination.ts`, default/max 500). Mirrors
  `services/visionChanges.ts`.
- New route in `functions/src/routes/` mounted under the loop path, behind the existing
  `requireApiKeyMember` + rate-limit middleware. `POST …/decisions` to append. (A `GET`
  for completeness, though the web reads via Firestore listeners, not the API.)
- Decisions are included in the resume **state bundle** (`services/loopState.ts`)? **No** —
  out of scope for SP1; the driver does not need to read its own past decisions to
  function. Revisit if SP2/SP3 needs it.

### CLI (`cli/autoloop.mjs`)

New verb, best-effort like all reporting (warns and exits 0 unless `--strict`):

```
autoloop decision add --kind goal-pick \
  --summary "This loop: checkout reliability" \
  --reason "Top accepted idea; declines are the #1 support theme" \
  [--scenario s1 --task t1 --commit <sha> --alt "tried fixed-delay retry"]
```

- Validates `--kind` against the enum and `--summary`/`--reason` presence *before* any
  network call (a `UsageError`, like other verbs).
- Repeatable `--scenario`/`--task`/`--commit`/`--alt` collect into arrays (the existing
  repeated-flag pattern).
- Posts via the existing `report()` path (POST, so retry only on 429 per the hardened
  `fetchWithRetry`). Synced to the plugin + curl-installer copies via
  `scripts/sync-autoloop-cli.sh`.

### Driver guidance (`plugins/autoloop/skills/autoloop/SKILL.md`)

Add a short subsection telling the driver to emit a decision at exactly three points:

- **Loop start** — one `goal-pick` after resume/setup, stating the loop's thesis.
- **Non-obvious task approach** — an `approach` when the chosen implementation path isn't
  the obvious one (skip routine tasks; this is for judgment calls).
- **Stuck** — a `stuck` when a scenario fails to converge after a revision, or when the
  loop enters `blocked`/`paused`, capturing what was tried and what's next.

Emission is best-effort and must never block the loop. Keep it to one decision per moment
— this is signal, not a log.

## Mapping existing records into the model

`buildWhyModel` adapts existing records at read time (no migration, no new writes):

| existing record | becomes | rationale source |
|---|---|---|
| `revision` | Decision `plan-change` | `trigger.reason`; refs from `trigger.scenarioId` + changed task ids |
| `visionChange` | Decision `vision-change` | `reason`; diff from `prior`/`payload`; refs to affected goal/scenario |
| `score` | Evidence `supports` scenario | `criteria`, `composite`, `note` |
| `test-run` | Evidence `supports` scenario | `failed`, `issues`, `summary` |
| `verification` | Evidence `refutes`/`supports` scenario | `verdict`, `summary` |
| `bug` | Subject + "created-by" edge | `taskId`/`scenarioId`, `loopId` |
| accepted `idea` seeding the loop | synthesized `goal-pick` (only if the driver emitted none) | `idea.rationale` |

The synthesized `goal-pick` carries `source: "synthesized"` so a surface can show it
faintly / distinguish it from a driver-authored decision.

## Testing

- **`whyModel.test.ts` (vitest, web)** — the core of SP1. Fixture-driven pure-function
  tests:
  - scenario with low composite → `unmet` with a `score` reason "72 < 80" flagged `ok:false`.
  - scenario passing all three → `met`, all reasons `ok:true`.
  - refuted verification → `unmet` with the refutation summary, even when composite ≥ threshold.
  - revision → `plan-change` decision with the right refs.
  - accepted idea, no driver decision → one synthesized `goal-pick`.
  - edges: goal→scenario→task structure + an `affects` edge from a decision to its refs.
- **Decisions route (functions, emulator)** — append + validation (bad `kind` → 400;
  oversized `rationale` → 400; member auth required; list cap honored).
- **CLI unit test (`functions/test/cli.unit.test.ts`)** — `decision add` sends the right
  body; rejects a bad `--kind` before any network call; repeated `--scenario` collects.

## Risks / open questions

- **Two met-state derivations during the transition.** SP1 introduces the
  verification-aware `Explanation.state`; the legacy `deriveScenarioState` (2-condition)
  still feeds `mapView.buildMap` until SP2 consolidates. Until then the why-model and the
  old map can disagree on a refuted scenario (the why-model is the correct one per
  `concepts.md`). SP2 **must** adopt the why-model state as the single source of truth and
  retire the divergent path. This is the one place SP1 deliberately changes displayed
  behavior, and only for scenarios that are currently mislabeled `met` despite a refutation.
- **Driver adoption.** If the driver rarely emits decisions, `goal-pick`/`approach`/
  `stuck` stay thin. Mitigation: the model degrades gracefully (existing records + the
  synthesized `goal-pick` keep it useful), and SP2's graph must render cleanly with zero
  decisions present.
- **Rationale quality.** Garbage-in: a one-word rationale helps no one. Out of scope to
  enforce; SKILL.md guidance sets the bar, and the adversarial-verification idea (separate
  initiative) is the real backstop on honesty.
- **`refs` integrity.** A decision may reference a scenario/task id that no longer exists.
  The model should drop dangling refs silently rather than render broken edges.
- **Decision `kind` growth.** Starting with three. New kinds are additive; the schema enum
  is the single source of truth.
