# `/autoloop` driver hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the `/autoloop` loop-driver skill to start a loop per run, transition task/phase/loop status to terminal when done, open/fix trackable bugs, and attach test-run summaries.

**Architecture:** Prose-only change to one skill file (`plugins/autoloop-reporting/skills/autoloop/SKILL.md`), a plugin version bump, and a sync of the curl-installer copy. The CLI verbs all already exist (SP1/v2.1) — no code, no contract change. Correctness bar: every `autoloop …` command in the file is valid against `cli/autoloop.mjs`, and the existing suites stay green.

**Tech Stack:** Markdown skill file; the dependency-free `autoloop` CLI; `scripts/sync-autoloop-cli.sh`.

**Spec:** `docs/superpowers/specs/2026-06-03-autoloop-driver-hygiene-design.md`

**Conventions:**
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- This is SP3 (final) of the batch; SP1+SP2 are already on this branch (PR #17). We deploy the batch together — do NOT merge/deploy here.

---

### Task 1: Rewrite the `/autoloop` SKILL.md with the four hygiene behaviors

**Files:**
- Overwrite: `plugins/autoloop-reporting/skills/autoloop/SKILL.md`

This task replaces the file with the version below. The changes vs the current file: (1) a `loop start` step in the Algorithm + a Preconditions note; (2) `task set`/`phase set`/`loop set` status transitions; (3) bug open/fix in the Test step + Evaluate step; (4) `--summary` on `test-run`; (5) two new Rules bullets; (6) a rewritten Example. Everything else (best-effort reporting, honest scoring, the met-rule, caps) is preserved.

- [ ] **Step 1: Overwrite the file with exactly this content**

````markdown
---
name: autoloop
description: Use to run a vision-driven, self-evaluating development loop from a vision.json — generate a task plan, implement each task, re-test and self-score the scenarios it advances, track bugs, record revisions when quality is short, and report progress to Autoloop. Trigger when the user wants to "run the loop", "build toward the vision", "/autoloop", or drive a scenario-scored build.
---

# Autoloop Loop Driver

Drive a self-evaluating build loop toward a `vision.json`. You **orchestrate skills
you already have** — `superpowers:writing-plans` to plan, and
`superpowers:subagent-driven-development` (or `superpowers:test-driven-development`
for a single slice) to implement — and add the vision layer: test, score, track bugs,
evaluate, revise. Every state change is reported via the bundled `autoloop` CLI.
**Reporting is best-effort: a `autoloop` warning is noted, never fatal — it must not
derail the work.**

## Preconditions

- A **`vision.json`** in the cwd. If absent, offer to run `/autoloop-vision` first.
- An initialised **`.autoloop.json`** (`autoloop init --team <t> --project <slug>`) and
  `AUTOLOOP_API_KEY` in the env. If missing, set them up (or proceed local-only — the
  loop still runs; reporting just warns). `init` seeds an empty loop state; the run's
  loop is created in step 1.

## Algorithm

1. **Import, start the loop & plan.**
   - `autoloop vision import --file vision.json` (best-effort).
   - `autoloop project set --title "<project>" --status running`.
   - **Start this run's loop** so all its work is grouped and shows as the current loop
     on the dashboard:
     `autoloop loop start <loopId> --goal "<this run's objective>" --order <n>`.
     - `<loopId>` = a short date-stamped slug, `loop-YYYY-MM-DD` (add a `-2`, `-3`, …
       suffix if the project already has a loop for today). `<n>` = the next loop
       number for the project (1 for the first run).
     - This sets the current loop; **every later `phase`/`task`/`commit`/`score`/
       `test-run`/`revise`/`bug` command then targets it automatically** — you do not
       pass a loop flag on those.
   - Invoke `superpowers:writing-plans` to turn the vision into a **phases → tasks**
     plan. Tag **each task with the `scenarioIds` it advances**. Keep tasks small.
   - Report the plan. For each phase:
     `autoloop phase start <id> --name "<n>" --order <k>`. For each task:
     `autoloop task start <id> --phase <p> --name "<n>" --order <k> --scenarios <id1>,<id2>`.
     (`--name` and `--order` are REQUIRED on both verbs — omitting them fails the call.)

2. **Iterate per task** (in plan order):
   - Implement the task with `superpowers:subagent-driven-development` (or
     `superpowers:test-driven-development`).
   - `git commit` the work, then `autoloop commit --task <taskId>`.
   - For **each scenario the task advances**:
     - **Test.** If the scenario has a `test.command` in `vision.json`, run it and
       parse the pass/fail counts. Otherwise **AI-judge**: inspect the work against
       the scenario's description and decide pass/fail yourself. Report with a short
       summary of what was exercised + the conclusion:
       `autoloop test-run <scenarioId> --task <taskId> --passed <n> --failed <m> --summary "<1–3 sentences>"`.
       (Use `--summary-file <path.md>` instead when the summary is long, e.g. a
       captured report.)
     - **Track bugs.** If the test has `failed > 0`, or you find a concrete defect,
       open a trackable bug:
       `autoloop bug add <bugId> --title "<short>" --scenario <scenarioId> --task <taskId> --severity <low|medium|high> [--description "<detail>"]`.
       - `<bugId>` = a slug of the title (stable — re-running `bug add` with the same id
         updates it in place).
       - **Severity:** `high` = blocks a targeted scenario / breaks core behavior;
         `medium` = a real defect with a workaround or limited scope; `low` =
         cosmetic/minor.
       (A `test-run --issue "<note>"` is still available for a transient one-line note,
       but a real defect should be a tracked `bug`.)
     - **Score.** Rate **each rubric criterion** `0..max` against the work (be an
       honest judge — cite what's missing). Compute the weighted composite normalised
       to `0..100`:
       `composite = round(100 * Σ(value_i × weight_i) / Σ(max_i × weight_i))`.
       (The **rounded** composite is the value reported and the one the `met` rule in
       step 3 compares to the threshold — e.g. a raw 79.5 rounds to 80 and counts as met
       at threshold 80.)
       Report:
       `autoloop score <scenarioId> --task <taskId> --criterion <id>=<value> [--criterion ...] --composite <n> --commit <sha> [--note "..."]`.
   - **Close the task.** When its work is done, mark it terminal:
     `autoloop task set <taskId> --status completed` (use `--status failed` if you
     abandon it). A task is "done" when its implementation+evaluation cycle is
     complete — even if its scenario is still unmet (that drives a revision or a new
     task in step 3, not a task left `running`). **Never leave a finished task
     `running`.**

3. **Evaluate & revise.** A scenario is **met** when its latest composite ≥ its
   threshold (default 80) AND its latest test-run `failed == 0`. After a task:
   - If a bug you opened is now resolved (ideally confirmed by a later passing
     test-run), close it: `autoloop bug set <bugId> --status fixed`.
   - When **every task in a phase is terminal**, close the phase:
     `autoloop phase set <phaseId> --status completed`.
   - If a scenario the task targeted is **still unmet**, decide a **revision** of the
     remaining task path — add a hardening task, replace/reorder, or drop a dead end —
     and record it:
     `autoloop revise --scenario <s> --reason "<why>" --change <op>:<taskId> [--change ...]`
     (op ∈ add|replace|reorder|drop). Then actually adjust your remaining plan to match.

4. **Terminate** when ANY of:
   - **All targeted scenarios are met** → success.
   - **A cap is hit** — stop after a sensible max number of total iterations, or after
     **3 revisions on a single scenario** without it becoming met (it's stuck —
     escalate to the user rather than thrash), or an explicit token/budget limit.
   - **The user interrupts.**

   **Close the loop:** `autoloop loop set <loopId> --status completed` on success, or
   `--status cancelled` if a cap truncated the run.

   Always finish with a **"N/M scenarios met"** summary: which scenarios are
   met/unmet, the latest composite per scenario, open bugs, revisions made, and the
   dashboard URL (https://daloop-42b47.web.app). If a cap truncated the work, say so
   explicitly.

## Rules

- **Best-effort reporting.** If any `autoloop` command warns (bad key, non-member,
  network), note it once and keep building. Never abort the loop over reporting.
- **Close what you open.** A finished task gets `task set --status completed/failed`; a
  phase whose tasks are all terminal gets `phase set --status completed`; the loop gets
  `loop set --status` at the end. Don't leave work `running`.
- **Bugs are tracked, not just noted.** Open a `bug` for real defects (so they appear in
  the dashboard's Bugs view and can be resolved), and `bug set --status fixed` when
  resolved. Reserve `test-run --issue` for transient notes.
- **Honest scoring.** Don't inflate composites to hit the threshold; an unmet scenario
  driving a revision is the loop working as intended.
- **No silent truncation.** If a cap stops the loop, the summary must say which
  scenarios were left unmet and why.
- **Stay in plan order**; respect the current task. One task in flight at a time.

## Example (one task's cycle)

```
autoloop vision import --file vision.json
autoloop project set --title "Acme Web" --status running
autoloop loop start loop-2026-06-03 --goal "Ship login + payments" --order 1
# writing-plans → phase "build", task "login" advancing scenario "login-works"
autoloop phase start build --name "Build" --order 1
autoloop task start login --phase build --name "Login" --order 1 --scenarios login-works
# …implement via subagent-driven-development, git commit…
autoloop commit --task login
autoloop test-run login-works --task login --passed 5 --failed 1 --summary "Ran login e2e; happy path passes, password reset 500s on an expired token."
autoloop bug add login-reset-500 --title "Password reset 500s on expired token" --scenario login-works --task login --severity high
autoloop score login-works --task login --criterion correctness=4 --criterion ux=3 --composite 78 --commit <sha>
autoloop task set login --status completed
# composite 78 < 80 and a high bug open → still unmet → revise
autoloop revise --scenario login-works --reason "reset path 500s" --change add:login-reset-fix
# …later task fixes it, re-test passes…
autoloop bug set login-reset-500 --status fixed
autoloop phase set build --status completed
autoloop loop set loop-2026-06-03 --status completed
```
````

- [ ] **Step 2: Verify command accuracy against the CLI**

Read `cli/autoloop.mjs` and confirm every `autoloop …` command in the new SKILL.md matches a real dispatch case + flags: `vision import --file`, `project set`, `loop start <id> --goal --order`, `loop set <id> --status`, `phase start <id> --name --order`, `task start <id> --phase --name --order --scenarios`, `commit --task`, `test-run <scn> --task --passed --failed --summary` (and `--summary-file`/`--issue`), `bug add <id> --title --scenario --task --severity --description`, `bug set <id> --status`, `score <scn> --task --criterion --composite --commit --note`, `task set <id> --status`, `phase set <id> --status`, `revise --scenario --reason --change`. Confirm enums: status ∈ {queued,running,blocked,paused,completed,failed,cancelled}; severity ∈ {low,medium,high}; bug status ∈ {open,fixed}. Fix any mismatch in the SKILL.md.

- [ ] **Step 3: Commit**

```bash
git add plugins/autoloop-reporting/skills/autoloop/SKILL.md
git commit -m "feat(skill): /autoloop driver — loop start, status hygiene, bugs, test summaries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Bump the plugin version, sync the curl copy, verify green

**Files:**
- Modify: `plugins/autoloop-reporting/.claude-plugin/plugin.json` (version `0.2.1` → `0.3.0`)
- Synced (generated): `web/public/skill/autoloop/SKILL.md`

- [ ] **Step 1: Bump the plugin version**

In `plugins/autoloop-reporting/.claude-plugin/plugin.json`, change `"version": "0.2.1"` to `"version": "0.3.0"` (a meaningful driver-behavior change so installed plugins pick it up).

- [ ] **Step 2: Sync the curl-installer copy**

Run: `bash scripts/sync-autoloop-cli.sh`
Expected: prints the `✓ synced …` lines (it copies `plugins/autoloop-reporting/skills/autoloop/SKILL.md` → `web/public/skill/autoloop/SKILL.md`, among the CLI/vision copies).

- [ ] **Step 3: Verify the skill copy is identical**

Run: `diff plugins/autoloop-reporting/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && echo IDENTICAL`
Expected: `IDENTICAL` (no diff output).

- [ ] **Step 4: Sanity-check the suites (no code changed — confirm no accidental breakage)**

Run: `cd functions && npm test` then `cd web && npm test`
Expected: both green (functions 230 + rules 37; web 114). This is a regression sanity check; SP3 touched no code.

- [ ] **Step 5: Commit**

```bash
git add plugins/autoloop-reporting/.claude-plugin/plugin.json web/public/skill/autoloop/SKILL.md
git commit -m "chore(plugin): bump autoloop-reporting 0.3.0 + sync /autoloop skill copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- `/autoloop` SKILL.md instructs the driver to: start a loop per run (date-stamped id), set
  task/phase/loop status terminal when done, open bugs (AI-judged severity) and fix them, and
  attach `test-run --summary`; the worked example reflects this flow.
- Every `autoloop` command in the file is valid against `cli/autoloop.mjs`.
- Plugin bumped to 0.3.0; `web/public/skill/autoloop/SKILL.md` is identical to the plugin copy.
- `functions` + `web` suites stay green.

## Out of scope

- Per-loop notifications (v2.3); any CLI/contract change (all verbs already exist).
