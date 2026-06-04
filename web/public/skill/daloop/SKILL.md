---
name: daloop
description: Use to run a vision-driven, self-evaluating development loop from a vision.json — generate a task plan, implement each task, re-test and self-score the scenarios it advances, track bugs, record revisions when quality is short, and report progress to Daloop. Trigger when the user wants to "run the loop", "build toward the vision", "/daloop", or drive a scenario-scored build.
---

# Daloop Loop Driver

Drive a self-evaluating build loop toward a `vision.json`. You **orchestrate skills
you already have** — `superpowers:writing-plans` to plan, and
`superpowers:subagent-driven-development` (or `superpowers:test-driven-development`
for a single slice) to implement — and add the vision layer: test, score, track bugs,
evaluate, revise. Every state change is reported via the bundled `daloop` CLI.
**Reporting is best-effort: a `daloop` warning is noted, never fatal — it must not
derail the work.**

## Preconditions

- A **`vision.json`** in the cwd. If absent, offer to run `/daloop-vision` first.
- An initialised **`.daloop.json`** (`daloop init --team <t> --project <slug>`) and
  `DALOOP_API_KEY` in the env. If missing, set them up (or proceed local-only — the
  loop still runs; reporting just warns). `init` seeds an empty loop state; the run's
  loop is created in step 1.

## Algorithm

1. **Import, start the loop & plan.**
   - `daloop vision import --file vision.json` (best-effort).
   - `daloop project set --title "<project>" --status running`.
   - **Start this run's loop** so all its work is grouped and shows as the current loop
     on the dashboard:
     `daloop loop start <loopId> --goal "<this run's objective>" --order <n>`.
     - `<loopId>` = a short date-stamped slug, `loop-YYYY-MM-DD` (add a `-2`, `-3`, …
       suffix if the project already has a loop for today). `<n>` = the next loop
       number for the project (1 for the first run).
     - This sets the current loop; **every later `phase`/`task`/`commit`/`score`/
       `test-run`/`revise`/`bug` command then targets it automatically** — you do not
       pass a loop flag on those.
   - Invoke `superpowers:writing-plans` to turn the vision into a **phases → tasks**
     plan. Tag **each task with the `scenarioIds` it advances**. Keep tasks small.
   - Report the plan. For each phase:
     `daloop phase start <id> --name "<n>" --order <k>`. For each task:
     `daloop task start <id> --phase <p> --name "<n>" --order <k> --scenarios <id1>,<id2>`.
     (`--name` and `--order` are REQUIRED on both verbs — omitting them fails the call.)

2. **Iterate per task** (in plan order):
   - Implement the task with `superpowers:subagent-driven-development` (or
     `superpowers:test-driven-development`).
   - `git commit` the work, then `daloop commit --task <taskId>`.
   - For **each scenario the task advances**:
     - **Test.** If the scenario has a `test.command` in `vision.json`, run it and
       parse the pass/fail counts. Otherwise **AI-judge**: inspect the work against
       the scenario's description and decide pass/fail yourself. Report with a short
       summary of what was exercised + the conclusion:
       `daloop test-run <scenarioId> --task <taskId> --passed <n> --failed <m> --summary "<1–3 sentences>"`.
       (Use `--summary-file <path.md>` instead when the summary is long, e.g. a
       captured report.)
     - **Track bugs.** If the test has `failed > 0`, or you find a concrete defect,
       open a trackable bug:
       `daloop bug add <bugId> --title "<short>" --scenario <scenarioId> --task <taskId> --severity <low|medium|high> [--description "<detail>"]`.
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
       `daloop score <scenarioId> --task <taskId> --criterion <id>=<value> [--criterion ...] --composite <n> --commit <sha> [--note "..."]`.
   - **Close the task.** When its work is done, mark it terminal:
     `daloop task set <taskId> --status completed` (use `--status failed` if you
     abandon it). A task is "done" when its implementation+evaluation cycle is
     complete — even if its scenario is still unmet (that drives a revision or a new
     task in step 3, not a task left `running`). **Never leave a finished task
     `running`.**

3. **Evaluate & revise.** A scenario is **met** when its latest composite ≥ its
   threshold (default 80) AND its latest test-run `failed == 0`. After a task:
   - If a bug you opened is now resolved (ideally confirmed by a later passing
     test-run), close it: `daloop bug set <bugId> --status fixed`.
   - When **every task in a phase is terminal**, close the phase:
     `daloop phase set <phaseId> --status completed`.
   - If a scenario the task targeted is **still unmet**, decide a **revision** of the
     remaining task path — add a hardening task, replace/reorder, or drop a dead end —
     and record it:
     `daloop revise --scenario <s> --reason "<why>" --change <op>:<taskId> [--change ...]`
     (op ∈ add|replace|reorder|drop). Then actually adjust your remaining plan to match.

4. **Terminate** when ANY of:
   - **All targeted scenarios are met** → success.
   - **A cap is hit** — stop after a sensible max number of total iterations, or after
     **3 revisions on a single scenario** without it becoming met (it's stuck —
     escalate to the user rather than thrash), or an explicit token/budget limit.
   - **The user interrupts.**

   **Close the loop:** `daloop loop set <loopId> --status completed` on success, or
   `--status cancelled` if a cap truncated the run.

   Always finish with a **"N/M scenarios met"** summary: which scenarios are
   met/unmet, the latest composite per scenario, open bugs, revisions made, and the
   dashboard URL (https://daloop-42b47.web.app). If a cap truncated the work, say so
   explicitly.

## Rules

- **Best-effort reporting.** If any `daloop` command warns (bad key, non-member,
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
daloop vision import --file vision.json
daloop project set --title "Acme Web" --status running
daloop loop start loop-2026-06-03 --goal "Ship login + payments" --order 1
# writing-plans → phase "build", task "login" advancing scenario "login-works"
daloop phase start build --name "Build" --order 1
daloop task start login --phase build --name "Login" --order 1 --scenarios login-works
# …implement via subagent-driven-development, git commit…
daloop commit --task login
daloop test-run login-works --task login --passed 5 --failed 1 --summary "Ran login e2e; happy path passes, password reset 500s on an expired token."
daloop bug add login-reset-500 --title "Password reset 500s on expired token" --scenario login-works --task login --severity high
daloop score login-works --task login --criterion correctness=4 --criterion ux=3 --composite 78 --commit <sha>
daloop task set login --status completed
# composite 78 < 80 and a high bug open → still unmet → revise
daloop revise --scenario login-works --reason "reset path 500s" --change add:login-reset-fix
# …later task fixes it, re-test passes…
daloop bug set login-reset-500 --status fixed
daloop phase set build --status completed
daloop loop set loop-2026-06-03 --status completed
```
