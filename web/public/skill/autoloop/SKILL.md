---
name: autoloop
description: Use to run a vision-driven, self-evaluating development loop from a vision.json — generate a task plan, implement each task, re-test and self-score the scenarios it advances, track bugs, record revisions when quality is short, report progress to Autoloop, and receive user messages mid-run. Trigger when the user wants to "run the loop", "build toward the vision", "/autoloop", or drive a scenario-scored build.
---

# Autoloop Loop Driver

Drive a self-evaluating build loop toward a `vision.json`. You are the **sole
orchestrator**: you implement one task at a time yourself (using your coding tools or a
single-task subagent), and you report status to the Autoloop dashboard after **each
task** before moving to the next. Do NOT hand the whole plan to another orchestrator
(`superpowers:subagent-driven-development` implements many tasks at once and bypasses
per-task reporting — only use it scoped to **one task** at a time). The per-task cycle
is an unbreakable atomic unit:

  **mark running → implement → commit → test → score → mark completed**

Every state change is reported via the bundled `autoloop` CLI immediately as it happens.
**Reporting is best-effort: an `autoloop` warning is noted, never fatal.**

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
   - **Mark it running** before you start (report immediately — this is what makes the
     dashboard flip from queued to running in real time):
     `autoloop task set <taskId> --status running`
   - **Implement this one task.** Use your coding tools (Read/Edit/Write/Bash) directly,
     or invoke `superpowers:test-driven-development` scoped to **this single task only**.
     Do NOT use `superpowers:subagent-driven-development` for the whole plan — it
     implements all tasks at once and prevents per-task status reporting. Implement, then
     immediately continue to the reporting steps below before touching the next task.
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
   - **Close the task — do this the instant its cycle ends, before touching the next
     task.** Mark it terminal: `autoloop task set <taskId> --status completed` (use
     `--status failed` if you abandon it). A task is "done" when its
     implementation+evaluation cycle is complete — even if its scenario is still unmet
     (that drives a revision or a new task in step 3, not a task left `running`).
     **Never leave a finished task `running`** — on the dashboard a `running` task is
     indistinguishable from one still in progress, so a skipped close makes a finished
     build look stuck. (Step 4 has a safety-net sweep, but close each task here.)
   - **Check for user messages.** The `task set` response surfaces a `📨 N message(s)
     from the user` notice when messages are pending; on seeing it (or proactively at
     each task boundary), run:
     `autoloop messages pull`
     Process each message oldest-first:
     - **Question / info request** → answer in-thread:
       `autoloop messages send --text "…"`, then `autoloop messages ack <id>`.
     - **Reprioritise / add / drop tasks** → act via the existing `autoloop revise`
       flow (step 3), then `autoloop messages ack <id>`.
     - **Stop or pause** → graceful terminate (see step 4), then
       `autoloop messages ack <id>`.
     - **Ambiguous** → ask for clarification:
       `autoloop messages send --text "…"`, then `autoloop messages ack <id>`.
     Reply at your discretion for questions, stop signals, or plan changes; routine
     status messages that need no reply can be acked immediately.

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
   - **The user sends a stop or pause message.** When a pulled message signals a stop
     or pause: reply confirming the stop (`autoloop messages send --text "Stopping the
     loop as requested."`), ack the message (`autoloop messages ack <id>`), then close
     the loop with `autoloop loop set <loopId> --status cancelled`. Finish with the
     standard "N/M scenarios met" summary (below), explicitly noting the user-requested
     stop.

   **Reconcile status (MANDATORY — every run, before closing the loop).** Make the
   dashboard match reality. Go through **every** task you started this run and set it
   terminal — `autoloop task set <taskId> --status completed` (or `--status failed` for
   one you abandoned); then set **every** phase whose tasks are all done to
   `autoloop phase set <phaseId> --status completed`. These calls are **idempotent** —
   re-issue them even for items you believe you already closed; cost is nothing and it
   guarantees nothing is missed. **A run must never end with an implemented task or a
   finished phase still `running`** — that is the single most common way a completed
   build looks "stuck" on the dashboard. (Use the plan's task/phase ids, e.g. the ones
   recorded in `.autoloop.json`, as your checklist.)

   **Close the loop:** `autoloop loop set <loopId> --status completed` on success, or
   `--status cancelled` if a cap or user stop truncated the run.

   Always finish with a **"N/M scenarios met"** summary: which scenarios are
   met/unmet, the latest composite per scenario, open bugs, revisions made, and the
   dashboard URL (https://daloop-42b47.web.app). If a cap truncated the work, say so
   explicitly.

## Rules

- **Best-effort reporting.** If any `autoloop` command warns (bad key, non-member,
  network), note it once and keep building. Never abort the loop over reporting.
- **Message channel is best-effort.** A `autoloop messages pull` error is noted once
  and skipped — never block or abort the build on the message channel.
- **Close what you open, and reconcile at the end.** A finished task gets `task set
  --status completed/failed`; a phase whose tasks are all terminal gets `phase set
  --status completed`; the loop gets `loop set --status` at the end. Close each item as
  it finishes AND run the mandatory end-of-run reconciliation sweep (step 4) over every
  task/phase before the summary — the `set` calls are idempotent, so re-set freely.
  **Never end a run with implemented work left `running`.**
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
autoloop phase start build --name "Build" --order 1      # queued
autoloop task start login --phase build --name "Login" --order 1 --scenarios login-works  # queued
autoloop task set login --status running                  # mark running → visible on dashboard NOW
# …implement this one task (direct coding or /test-driven-development for this task only), git commit…
autoloop commit --task login
autoloop test-run login-works --task login --passed 5 --failed 1 --summary "Ran login e2e; happy path passes, password reset 500s on an expired token."
autoloop bug add login-reset-500 --title "Password reset 500s on expired token" --scenario login-works --task login --severity high
autoloop score login-works --task login --criterion correctness=4 --criterion ux=3 --composite 78 --commit <sha>
autoloop task set login --status completed
# ↑ response shows: 📨 1 message(s) from the user — run `autoloop messages pull`
autoloop messages pull
# → [{ id: "01JWXYZ...", text: "Can you also add Google OAuth?" }]
# interpret: new requirement → record a revision, reply, ack
autoloop revise --scenario login-works --reason "user requested Google OAuth" --change add:login-google-oauth
autoloop messages send --text "Got it — added a Google OAuth task to the plan. It will run after the current fix."
autoloop messages ack 01JWXYZ...
# composite 78 < 80 and a high bug open → still unmet → revise
autoloop revise --scenario login-works --reason "reset path 500s" --change add:login-reset-fix
# …later task fixes it, re-test passes…
autoloop bug set login-reset-500 --status fixed
autoloop phase set build --status completed
autoloop loop set loop-2026-06-03 --status completed
```
