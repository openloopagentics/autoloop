# Daloop — Vision-authoring + Loop-driver skills design spec

**Date:** 2026-06-02
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-projects:** #2 (vision-authoring skill) and #3 (loop-driver skill) of the
"vision-driven loop" initiative. They **consume** the merged loop-contract
(sub-project #1: domain model + write-only API + `daloop` CLI verbs) and do not
change it. Deferred to its own spec: #4, the website tracking UI.

## Goal

Make the vision-driven loop usable end-to-end **without hand-driving CLI verbs**.
Two Claude Code skills:

- **`/daloop-vision`** — interviews the user and produces a validated `vision.json`
  (goals → scenarios → scoring rubric → optional per-scenario test command).
- **`/daloop-loop`** — given a `vision.json`, drives the self-evaluating loop:
  turns the vision into a task plan, implements each task, re-tests and self-scores
  the scenarios it advanced, records revisions when quality is short, and reports
  everything to Daloop — stopping when scenarios are met, a cap is hit, or the user
  interrupts.

These are the "authoring" and "driving" halves that sub-project #1 deliberately
left out; #1 is the recording substrate they write to.

## Architecture

**The driver orchestrates machinery we already trust rather than reinventing it.**
`/daloop-loop` composes existing superpowers skills — `superpowers:writing-plans`
to turn the vision into phases→tasks, and `superpowers:subagent-driven-development`
(or `superpowers:test-driven-development`) to implement each task — and adds a thin
**vision layer** on top: test execution, rubric self-scoring, and revision
decisions. Every state change is reported through the **existing `daloop` CLI
verbs** shipped in #1 (`init`, `project set`, `vision import`, `phase start`,
`task start`/`task set`, `commit --task`, `score`, `test-run`, `revise`).

Two principles inherited from #1:
- **Best-effort reporting** — a daloop reporting failure (bad key, non-member,
  network) never blocks or derails the actual development work (the CLI exits 0
  unless `--strict`). The loop notes the warning and continues.
- **The agent computes, Daloop records** — tests are run and the rubric is scored
  locally by the loop; Daloop only stores the results.

Skills are primarily **instruction documents** (`SKILL.md`) that tell Claude Code
how to behave, plus a small bundled schema + validator. The only executable code in
this spec is the `vision.json` schema validator (it guards the interface both skills
depend on); the skills themselves are validated by review and a worked dry-run.

## Component 1 — `vision.json` (the shared interface)

The contract between the two skills. It mirrors the loop-contract domain model
(goals, scenarios, rubric, documents) plus one addition: a per-scenario `test` hook.

```jsonc
{
  "goals": [
    { "id": "g1", "title": "Users can sign in", "description": "...", "order": 1 }
  ],
  "scenarios": [
    {
      "id": "login-works",
      "goalId": "g1",
      "title": "Email+password login succeeds",
      "description": "...",
      "order": 1,
      "threshold": 80,                       // optional; global default 80
      "rubric": {
        "criteria": [
          { "id": "correctness", "name": "Correctness", "weight": 3, "max": 5 },
          { "id": "ux",          "name": "UX",          "weight": 1, "max": 5 }
        ]
      },
      "test": { "command": "npm test -- login" }   // optional; absent → AI-judged
    }
  ],
  "documents": [
    { "id": "vision", "kind": "vision", "title": "Vision", "format": "markdown", "content": "..." }
  ]
}
```

Field rules (mirror the loop-contract zod schemas so `vision import` accepts the
output): ids match `^[a-z0-9._-]+$`; rubric `criteria` non-empty, each
`{ id, name, weight>0, max≥1 }`; `threshold` `0..100`; `document.format` ∈
`markdown|url`. The **only field not in the contract** is `scenario.test`
(`{ command?: string }`) — it is a *loop-local* hint (how to test the scenario).
**It must be stripped client-side before `vision import`** (the validator exposes a
helper that returns the import-safe scenario without `test`): the server's
`scenarioBody` is a plain `z.object` that happens to drop unknown keys today, but the
loop must not depend on that drop — stripping client-side keeps the loop-local
boundary explicit and robust if `scenarioBody` ever gains `.passthrough()`. The loop
may separately persist the test approach as a `Document` of `kind:"test-spec"` via
`vision import` (`documentBody.kind` is free-form, so `"test-spec"` is accepted).

### Validator (the one piece of real code)

`skills/.../vision-schema.mjs` (dependency-free Node ESM) exports
`validateVision(obj) → { ok: true } | { ok: false, errors: string[] }`. It enforces
the field rules above and cross-checks that every `scenario.goalId` references a
defined goal. Both skills validate before writing/importing. This module has
**real unit tests** (Vitest, in `functions/test/` to reuse the harness, imported as
the CLI tests are): valid vision passes; bad id, empty rubric, weight≤0, max<1,
threshold>100, dangling goalId, bad format each fail with a specific message.

## Component 2 — `/daloop-vision` (sub-project #2)

A conversational authoring skill (a `SKILL.md` instruction doc).

**Behavior:**
1. Detect/scaffold: if a `vision.json` exists in the cwd, load it and offer to
   extend; else start fresh.
2. **Interview one topic at a time** (per the brainstorming-style cadence the user
   already likes): elicit goals; for each goal, its scenarios; for each scenario, a
   short description, the rubric criteria (name + weight + max) and an optional
   threshold, and — optionally — a **test command** (or "AI-judge it"). Keep
   questions tight and prefer the user's own words for titles/descriptions.
3. Assemble the object, assign stable kebab-case ids (or reuse existing), and
   **validate** with `validateVision`. On failure, surface the messages and fix
   interactively — never write an invalid file.
4. Write `vision.json` to the cwd. Offer to push it now via
   `daloop vision import --file vision.json` (best-effort; requires `DALOOP_API_KEY`
   + an initialized `.daloop.json` — if not initialized, point the user at
   `daloop init`).

**Boundaries:** it authors the *what* (vision), never the *how* (plan/code) — that
is the driver's job. It does not run tests or score anything.

## Component 3 — `/daloop-loop` (sub-project #3)

The driver (a `SKILL.md` instruction doc that composes other skills). Preconditions:
a `vision.json` (offer to run `/daloop-vision` if missing) and an initialized
`.daloop.json` (offer `daloop init` if missing). Algorithm:

1. **Import & plan.** `daloop vision import --file vision.json`. Then invoke
   `superpowers:writing-plans` to turn the vision into a phases→tasks plan, where
   **each task is tagged with the `scenarioIds` it advances**. Report the plan:
   `phase start <id> --name <n> --order <k>` per phase, then
   `task start <id> --phase <p> --name <n> --order <k> --scenarios <ids>` per task.
   (`--name` and `--order` are CLI-required on both verbs — the SKILL.md must always
   include them or the call exits 1; abbreviated forms elsewhere omit them for brevity.)
2. **Iterate per task** (in plan order, respecting the current task):
   - Implement the task via `superpowers:subagent-driven-development` (or
     `superpowers:test-driven-development` for a single-task slice).
   - `git commit` the work, then `daloop commit --task <taskId>`.
   - For **each scenario the task advances**:
     - **Test →** if the scenario has `test.command`, run it and parse pass/fail
       counts; else perform an **AI check** (the loop inspects the work against the
       scenario description and judges pass/fail). Report `daloop test-run <s>
       --task <t> --passed <n> --failed <m> [--issue ...]`.
     - **Score →** an **LLM judge** rates each rubric criterion `0..max` against the
       work, computes the weighted composite normalized to `0..100`, and reports
       `daloop score <s> --task <t> --criterion id=val... --composite <n>
       [--commit <sha>] [--note ...]`.
3. **Evaluate & revise.** Derive `met` for each targeted scenario (latest composite
   ≥ threshold AND latest testRun.failed == 0). If a targeted scenario is still
   **unmet** after its task, decide a **revision** of the task path
   (`add`/`replace`/`reorder`/`drop`) — adjusting the remaining plan — and record it:
   `daloop revise --scenario <s> --reason "..." --change op:<taskId>...`. The agent
   decides; Daloop records.
4. **Terminate** when **all targeted scenarios are met**, OR a **cap** is hit
   (max total iterations / max revisions-per-scenario [default 3] / optional token
   budget), OR the **user interrupts**. Always print a final
   **"N/M scenarios met"** summary with per-scenario state and the dashboard URL.

**Safety:** the per-scenario revision cap prevents thrashing; the iteration cap
prevents runaway loops; any cap that truncates work is stated explicitly in the
summary (no silent stop). Reporting stays best-effort throughout — a failed
`daloop` call is logged and the loop continues.

## Packaging

Both skills ship in the **existing `daloop-reporting` Claude Code plugin**
(`plugins/daloop-reporting/skills/daloop-vision/SKILL.md` and
`.../skills/daloop-loop/SKILL.md`), so they auto-update via the marketplace like the
reporting skill. The shared `vision-schema.mjs` is bundled where both skills can
reference it (e.g. `plugins/daloop-reporting/skills/_shared/` or each skill's dir);
`scripts/sync-daloop-cli.sh` already keeps the plugin's CLI copy in sync and will be
extended to keep any shared skill asset in sync if it lives outside the plugin.

The plugin's marketplace manifest is updated to register the two new skills.

## Testing

- **Validator:** real Vitest unit tests for `validateVision` (valid + each failure
  mode), reusing the `functions/` test harness.
- **Skills:** validated by (a) a worked **dry-run example** in each `SKILL.md`
  showing the exact verb sequence, and (b) the spec/skill review. Skill *markdown*
  is not unit-testable, but every CLI verb the skills invoke is already covered by
  the #1 suites (143 API/CLI tests green).
- **No new API/rules tests** — these skills add no server surface.

## Error handling

- **`/daloop-vision`:** never writes an invalid `vision.json` (validate first; fix
  interactively). Missing `DALOOP_API_KEY`/`.daloop.json` on import → a clear pointer
  to `daloop init` / the API-keys page, not a crash.
- **`/daloop-loop`:** reporting failures are best-effort (warn + continue). A failing
  implementation step (tests red) is handled by the underlying TDD/subagent skill,
  not swallowed. Caps and interrupts always produce a final summary.

## Out of scope (separate specs / deferred)

- **Website tracking UI** (sub-project #4): rendering the vision/docs, phase→task
  tree, score charts, revision timeline, "N/M scenarios met".
- **Extending the `/skill` curl installer** to ship these two skills — the plugin is
  the primary, auto-updating channel; the curl installer continues to ship the
  reporting skill only for now (a minor follow-up, not required to use the loop).
- **Any change to the loop contract** (#1) — these skills consume it unchanged.

## Success criteria

- A user can run `/daloop-vision`, answer the interview, and get a `vision.json` that
  passes `validateVision` and is accepted by `daloop vision import`.
- A user can run `/daloop-loop` and have it: import the vision, produce and report a
  phases→tasks plan, implement tasks via the existing dev skills, report task-scoped
  commits, run scenario tests (command or AI) and self-score against the rubric
  (reported as `test-run`/`score` events), record revisions when scenarios stay
  unmet, and stop on met/cap/interrupt with a clear "N/M scenarios met" summary.
- Reporting stays best-effort (dev work never blocked).
- The `vision.json` validator unit tests are green and `npm run build`/test suites
  remain green.
- Both skills are registered in the `daloop-reporting` plugin and load in Claude Code.
