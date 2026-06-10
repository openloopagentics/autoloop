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
autoloop init --session-log   # real-time hook: session log updates in the dashboard as the loop runs
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
single task's steps from the plan**. The subagent must:
- Read the relevant files and implement the feature.
- **Write a real automated test for EACH scenario this task advances** — a test
  that actually exercises the scenario's behavior and fails before the feature
  exists, passes after. Do not hand-wave "it works"; there must be an executable
  test per scenario.
- Run the full test suite and report the **actual** pass/fail counts per scenario.
- Commit code + tests together.

It does NOT call any `autoloop` CLI commands — that is your job. Wait for it to finish.

**Note the subagent's `agentId`** from the Agent tool's result (it appears as
`agentId: a…` in the returned text). You pass it to `autoloop commit --agent`
below so the subagent's token usage is attributed to this task's commit.

If the subagent reports it could not write a passing test for a scenario, that
scenario stays **unmet** — do not score it as met (see 2c).

### 2c. Report — run these CLI commands yourself, in order

The `--passed`/`--failed` numbers MUST come from the subagent's real test run —
never invent them. A scenario with no passing automated test is unmet.

**Traceability is mandatory.** Every test-run and every bug must point back to the
exact artifacts so anyone can follow scenario → test → result → bug → fix.

```bash
# 1. Report the commit (gives every test-run/bug below a commit to trace to).
#    Pass --agent <agentId> (from 2b) to attribute the subagent's token usage to this commit.
autoloop commit --task <taskId> --agent <agentId>

# 2. For EACH scenario this task advances — submit the REAL test result.
#    The --summary MUST name: the test file path, the test name(s), and the exact
#    command used to run them, plus the conclusion. One --issue per failing assertion.
autoloop test-run <scenarioId> --task <taskId> --passed <n> --failed <m> \
  --summary "test: web/src/foo.test.tsx › 'hero rotates' | cmd: npm test -- foo | <pass/fail conclusion>" \
  [--issue "<file::test> expected X, got Y"]   # repeat per failure
#    Record the `autoloop: id <ULID>` line each test-run prints — you need it
#    for the verification step in 3a. (If you lost one, re-run the test and
#    submit a fresh test-run.)

# 3. Open a bug for EVERY concrete defect found. It must be traceable:
#    --scenario + --task link it; --description carries the test that caught it,
#    the commit sha, and expected-vs-actual so it can be reproduced and verified.
autoloop bug add <bugId> --title "<short, specific>" \
  --scenario <scenarioId> --task <taskId> --severity <low|medium|high> \
  --description "caught by: <test file::name> @ <commit sha> | expected: <…> | actual: <…> | repro: <steps>"

# When a bug is fixed, close it with the fixing commit referenced:
autoloop bug set <bugId> --status fixed \
  --description "fixed in <commit sha>; <test file::name> now passes"

# 4. Score each scenario (only score met when its test-run has failed=0):
autoloop score <scenarioId> --task <taskId> \
  --criterion <id>=<val> [--criterion ...] --composite <n> --commit <sha>
```

**Every scenario tagged on this task must get BOTH a test-run and a score here.**
Skipping a scenario's test-run is the #1 cause of features shipping with scenarios
stuck unmet.

**Traceability checklist — every test-run and bug must carry:**
- which **scenario** it belongs to (`<scenarioId>` / `--scenario`)
- which **task** produced it (`--task`)
- the exact **test** (file path + test name) — in the test-run `--summary` and the bug `--description`
- the **commit sha** the result/defect is against
- for bugs: **expected vs actual** and how to **reproduce**; on fix, the **fixing commit**

A test-run with a vague summary ("tests pass") or a bug with no scenario/test/commit
reference is not acceptable — redo it with the specifics.

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

- If any message is a **stop/pause**: finish the current task cleanly, then go to
  **Step 4 (Paused — wait for resume)**. Do NOT end the session.
- If any message changes scope or direction: adjust the remaining task plan accordingly.

**Now go back to 2a for the next task.**

## Step 3 — Verify EVERY scenario, then close the loop

### 3a. Scenario verification sweep (do this BEFORE closing)

Before closing the loop, account for **every scenario that belongs to this loop
iteration** — i.e. the union of `scenarioIds` across all of this loop's tasks.
For each such scenario, confirm there is:
1. a **test-run** with `failed = 0` (a real automated test that passes), AND
2. a **score** with `composite >= threshold`.

For any scenario missing either:
- If it's genuinely implemented but you never wrote/ran its test → dispatch a
  subagent to write the automated test now, run it, then submit the test-run + score.
- If it's actually not met → record a revision and leave it unmet honestly:
  `autoloop revise --scenario <s> --reason "<why>" --change <op>:<id>`

Do not close the loop with implemented-but-untested scenarios silently sitting
unmet. Either they have a passing test (met) or a revision explaining why not.

**Independent verification (mandatory, after the sweep, before 3b):**

1. Collect, for every scenario in this loop, its **latest test-run id** — each
   `autoloop test-run` prints `autoloop: id <ULID>`; record it when you submit —
   plus the exact command and test file/names from that run's `--summary`
   (already mandatory per Traceability).
2. Dispatch **one verifier subagent** with a clean context. Its prompt contains
   ONLY the list of `{scenarioId, testRunId, command, expected pass/fail}` plus
   repo access. It replays each command and reports the actual pass/fail counts
   per scenario. It does not see the implementation conversation and calls no
   `autoloop` commands.
3. For each scenario, submit the verdict yourself:

```bash
autoloop verify <scenarioId> --test-run <testRunId> --verdict confirmed|refuted \
  [--task <taskId>] --summary "<command> → <actual result>"
```

   Verdict mapping: the verifier's actual counts match the recorded run (and
   `failed = 0`) → `confirmed`; anything else → `refuted`.

4. A `refuted` verdict means the scenario is **unmet** regardless of its score —
   record a revision (the existing unmet path) and do not count it met in the
   closing summary.

### 3b. Close the loop

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

**The only valid reasons to stop building are:**
1. The user sent a **stop/pause** message → go to **Step 4 (Paused)**, keep the
   session alive and polling. (This is a pause, not an exit.)
2. The user gave an explicit iteration count and you've reached it (e.g. "run 3 rounds").
3. Genuine context or token exhaustion — you physically cannot continue.

**Only end the session** on an explicit **shutdown/exit/quit/"we're done"** message.

Anything else — "a sensible cap", "one round is enough", "the app looks good" —
is a rationalization. Ignore it and start the next loop.

A scenario is **met** in this summary if AND ONLY IF, for that scenario, you
submitted ALL of:
1. a score with `composite >= threshold` (default 80), AND
2. a test-run with `failed = 0`, AND
3. its latest test-run was NOT `refuted` by verification.

If any of these is missing, the scenario is **unmet** — even if the composite is
high. Conditions 1–2 match the UI's met/unmet state; a refuted verdict
additionally shows as ✗ Refuted there — report such a scenario as unmet even
though its met-state may still read met. Do not report a scenario as "met"
based on the score alone.

## Step 4 — Paused: keep polling, act on the next message

A **stop/pause** message does NOT end your session. It parks the loop in a paused
state where you **keep polling for the user's next message and act on whatever it
says** — it will rarely be the literal word "resume"; it's any prompt (a new
instruction, a scope change, "keep going", "fix the header", "build X next", etc.).

On entering pause:
```bash
autoloop messages ack <stopMsgId>
autoloop loop set <loopId> --status paused
# reply so the dashboard shows you're parked and listening:
autoloop messages send --text "Paused. Send any message and I'll act on it and resume."
```

Then poll indefinitely until a message arrives — the session stays alive the whole
time, so a message sent from the dashboard reaches you here:
```bash
# Wait-for-next-message loop. Keep going; do NOT exit the session.
while true; do
  autoloop messages pull        # prints any pending user messages
  # → if one or more messages came back: break out and handle them (below)
  sleep 30
done
```

When a message arrives:
1. `autoloop messages ack <id>` for each.
2. **Do exactly what it says.** Treat it as a fresh user instruction:
   - If it's a directive to keep building / continue / a new feature → `autoloop loop
     set <loopId> --status running` (or `loop start` a new iteration), then go back
     to **Step 2** and run it.
   - If it changes scope/plan → adjust the plan, then resume Step 2.
   - Only if it explicitly says to **shut down / exit / quit / we're done** → close
     the loop terminally (Step 3b) and end the session.
3. After handling, if you're building again you're back in the normal loop; if the
   message was itself another pause, return to the wait-for-next-message loop above.

**Never end the session on a plain stop/pause.** Ending is only for an explicit
shutdown/exit message or genuine context exhaustion. As long as the session is
alive, a stop must leave you polling so the user's next dashboard message is picked up.

## Rules

- **One task at a time.** Never start 2b for task N+1 while task N is still open.
- **Report in this session.** All `autoloop` CLI calls happen here, not in subagents.
- **Best-effort.** If an `autoloop` command warns, note it once and continue.
- **Honest scoring.** Don't inflate composites; an unmet scenario driving a revision is the loop working correctly.
- **No silent truncation.** If a cap stops the loop, the summary must say which scenarios remain unmet.
- **test-run is required.** A score alone does not make a scenario met. Always submit `autoloop test-run` before `autoloop score` for every scenario a task advances. Skipping test-run means the scenario will show as "unmet" in the UI regardless of the composite.
- **Real tests, real numbers.** Every scenario in the loop needs an executable automated test that actually verifies it. The `--passed`/`--failed` counts must come from running that test — never fabricated. Implementing a feature without a test for its scenario leaves the scenario unmet, which is the defect we're avoiding.
- **No scenario left behind.** Before closing a loop, run the Step 3a sweep: every scenario tagged to this loop's tasks must end either met (passing test + score) or with a revision explaining why not. Never close a loop with implemented-but-untested scenarios silently unmet.
- **Verification is independent.** The verifier subagent never implements code and the implementer never verifies; refuted = unmet.
- **Traceability is mandatory.** Every test-run names the exact test (file + test name) and command in its `--summary`; every bug links `--scenario` + `--task` and records the catching test, commit sha, and expected-vs-actual in `--description`; fixed bugs cite the fixing commit. Vague "tests pass" summaries or bugs with no scenario/test/commit reference must be redone.
- **Loop is the default.** Do not stop between loops unless the user explicitly said to, gave a round count you've hit, or you've hit genuine context exhaustion. "The app looks good" is not a stopping condition.
- **Pause ≠ exit.** A stop/pause message parks you in Step 4 polling for the next message — it never ends the session. Only an explicit shutdown/exit message (or context exhaustion) ends it. While the session is alive, always be polling so a dashboard message lands. The next message may be any prompt, not the word "resume" — act on whatever it says.

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

# pre-close verification sweep (3a): verifier subagent replays both commands
autoloop verify login-works --test-run <ulid-from-login-test-run> --verdict confirmed --summary "npm test -- login → 8/8"
autoloop verify search-works --test-run <ulid-from-search-test-run> --verdict confirmed --summary "npm test -- search → 6/6"

autoloop phase set build --status completed
autoloop loop set loop-2026-06-04 --status completed
```
