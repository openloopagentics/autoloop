---
name: autoloop
description: Use to run a vision-driven, self-evaluating development loop from a vision.json — generate a task plan, implement each task one at a time with live status reporting, re-test and self-score the scenarios it advances, track bugs, record revisions when quality is short, report progress to Autoloop, and receive user messages mid-run. Trigger when the user wants to "run the loop", "build toward the vision", "/autoloop", or drive a scenario-scored build.
---

# Autoloop Loop Driver

You are the **sole orchestrator**. You drive the loop task-by-task in your own
session. The structure is a strict `while (tasks remain)` loop — **you never exit
the loop to delegate the whole plan elsewhere**. Each iteration is:

```
pick next queued task
→ autoloop task set <id> --status running        ← dashboard updates NOW
→ dispatch ONE implementation subagent           ← code only, no reporting
→ autoloop commit --task <id>                    ← report commit
→ autoloop test-run / score / bug                ← report evaluation
→ autoloop task set <id> --status completed      ← dashboard updates NOW
→ check messages, evaluate, revise if needed
→ repeat
```

**The CLI calls (`autoloop task set`, `autoloop commit`, etc.) MUST run in this
session, not inside a subagent.** Subagents implement code; you report status.

## Preconditions

- A **`vision.json`** in the cwd. If absent, run `/autoloop-vision` first.
- An initialised **`.autoloop.json`** (`autoloop init --team <t> --project <slug>`)
  and `AUTOLOOP_API_KEY` in the env.

## Step 1 — Setup (once per run)

```bash
autoloop vision import --file vision.json
autoloop project set --title "<project>" --status running
autoloop loop start loop-YYYY-MM-DD --goal "<objective>" --order <n>
autoloop init --session-log   # writes Stop hook so every response appears in the dashboard
```

Use `superpowers:writing-plans` to turn the vision into a phases → tasks plan.
Tag each task with the `scenarioIds` it advances. Keep tasks small.

Register the plan — all tasks start as **queued**:
```bash
autoloop phase start <phaseId> --name "<n>" --order <k>   # repeat per phase
autoloop task start <taskId> --phase <p> --name "<n>" --order <k> --scenarios <ids>  # repeat per task
```

## Step 2 — Per-task loop (repeat until done)

For each task in plan order, execute these steps **without skipping or batching**:

### 2a. Mark running (immediately — do not delay)
```bash
autoloop task set <taskId> --status running
```
The dashboard flips to running the moment this executes. Do this BEFORE writing
any code.

### 2b. Implement — dispatch ONE subagent for this task only

Use `superpowers:subagent-driven-development` with the subagent scoped to **this
single task's steps from the plan**. The subagent: reads the relevant files,
writes/edits code, runs tests, commits. It does NOT call any `autoloop` CLI
commands — that is your job.

Wait for the subagent to finish before proceeding.

### 2c. Report — run these CLI commands yourself, in order

```bash
# 1. Report the commit
autoloop commit --task <taskId>

# 2. For each scenario this task advances:
autoloop test-run <scenarioId> --task <taskId> --passed <n> --failed <m> \
  --summary "<what was tested and the conclusion>"

# 3. Open a bug for any concrete defect found:
autoloop bug add <bugId> --title "<short>" --scenario <scenarioId> \
  --task <taskId> --severity <low|medium|high>

# 4. Score each scenario:
autoloop score <scenarioId> --task <taskId> \
  --criterion <id>=<val> [--criterion ...] --composite <n> --commit <sha>
```

### 2d. Mark completed
```bash
autoloop task set <taskId> --status completed
```

### 2e. Evaluate, revise, drain messages

After closing the task:
- If a phase is fully done: `autoloop phase set <phaseId> --status completed`
- If a scenario is unmet: `autoloop revise --scenario <s> --reason "<why>" --change <op>:<id>`
- **Poll for messages** — run the pull/ack loop below. The subagent may have run for
  several minutes; messages that arrived during that window are waiting here.

```bash
# Drain messages after each task (3 polls × 15 s ≈ 45 s window)
for i in 1 2 3; do
  autoloop messages pull   # prints any pending messages
  # for each message returned: act on it, then:
  autoloop messages ack <id>
  sleep 15
done
```

- If any message is a **stop**: reply, ack, then go to Step 3.
- If any message changes scope or direction: adjust the remaining task plan accordingly.

**Now go back to 2a for the next task.**

## Step 3 — Close the current loop, then start the next one

When a loop's tasks are done, close it:

```bash
# Safety net — idempotent, re-set every task and phase to terminal:
autoloop task set <id> --status completed   # for every task you implemented
autoloop phase set <id> --status completed  # for every finished phase

# Close the loop:
autoloop loop set <loopId> --status completed   # or --status cancelled
```

Print a brief **"N/M scenarios met"** summary: which met/unmet, composites,
open bugs, revisions, and the dashboard URL (https://daloop-42b47.web.app).

**Drain messages before starting the next loop** — this is the longest idle
window; poll generously:

```bash
# Message drain between loops (6 polls × 30 s = 3 min window)
for i in 1 2 3 4 5 6; do
  autoloop messages pull   # act on any messages returned, ack each
  sleep 30
done
```

If a stop message arrives during the drain, go to the stopping path above.
Otherwise, **immediately start the next loop.** Autoloop is a loop — running is
the default, stopping is the exception. Generate 5 new improvement ideas based
on what's already been built, open `loop start loop-YYYY-MM-DD-<n>` with the
next order number, plan its tasks, and go back to Step 2. Do NOT ask the user
whether to continue. Do NOT suggest the next round as an option. Just run it.

**The only valid reasons to stop are:**
1. The user sent an explicit stop message (via `autoloop messages pull`).
2. The user gave an explicit iteration count and you've reached it (e.g. "run 3 rounds").
3. Genuine context or token exhaustion — you physically cannot continue.

Anything else — "a sensible cap", "one round is enough", "the app looks good" —
is a rationalization. Ignore it and start the next loop.

A scenario is **met** in this summary if AND ONLY IF, for that scenario, you
submitted BOTH:
1. a score with `composite >= threshold` (default 80), AND
2. a test-run with `failed = 0`.

If either is missing, the scenario is **unmet** — even if the composite is high.
This matches exactly what the UI shows. Do not report a scenario as "met" based
on the score alone.

## Rules

- **One task at a time.** Never start 2b for task N+1 while task N is still open.
- **Report in this session.** All `autoloop` CLI calls happen here, not in subagents.
- **Best-effort.** If an `autoloop` command warns, note it once and continue.
- **Honest scoring.** Don't inflate composites; an unmet scenario driving a revision is the loop working correctly.
- **No silent truncation.** If a cap stops the loop, the summary must say which scenarios remain unmet.
- **test-run is required.** A score alone does not make a scenario met. Always submit `autoloop test-run` before `autoloop score` for every scenario a task advances. Skipping test-run means the scenario will show as "unmet" in the UI regardless of the composite.
- **Loop is the default.** Do not stop between loops unless the user explicitly said to, gave a round count you've hit, or you've hit genuine context exhaustion. "The app looks good" is not a stopping condition.

## Example (two tasks)

```
# Setup
autoloop vision import --file vision.json
autoloop project set --title "Acme Web" --status running
autoloop loop start loop-2026-06-04 --goal "Ship login + search" --order 1
autoloop phase start build --name "Build" --order 1
autoloop task start login --phase build --name "Login" --order 1 --scenarios login-works
autoloop task start search --phase build --name "Search" --order 2 --scenarios search-works

# --- Task 1: login ---
autoloop task set login --status running          # ← dashboard: login is running

# dispatch subagent: implement login (code only)

autoloop commit --task login
autoloop test-run login-works --task login --passed 8 --failed 0 --summary "Login e2e passes."
autoloop score login-works --task login --criterion correctness=5 --criterion ux=4 --composite 90 --commit <sha>
autoloop task set login --status completed        # ← dashboard: login is done

# --- Task 2: search ---
autoloop task set search --status running         # ← dashboard: search is running

# dispatch subagent: implement search (code only)

autoloop commit --task search
autoloop test-run search-works --task search --passed 6 --failed 0 --summary "Search returns relevant results."
autoloop score search-works --task search --criterion correctness=4 --criterion ux=4 --composite 85 --commit <sha>
autoloop task set search --status completed       # ← dashboard: search is done
autoloop session push --loop loop-2026-06-04      # ← session log updates in UI

autoloop phase set build --status completed
autoloop loop set loop-2026-06-04 --status completed
```
