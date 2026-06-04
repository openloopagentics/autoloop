# Autoloop — `/autoloop` driver hygiene design spec

**Date:** 2026-06-03
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** SP3 (final) of the tabs/loops/bugs batch — teach the `/autoloop` loop-driver
skill to drive the loop level and the new artifacts the contract (SP1) + UI (SP2) added.
**Skill-instruction authoring only** — the CLI verbs (`loop start/set`, `task set`,
`bug add/set`, `test-run --summary`) already exist; no code, no contract change.

## Goal

The loop driver currently (a) writes everything project-direct (never starts a loop),
(b) starts tasks `running` but never transitions them to `completed`/`failed` — so the
dashboard shows "lots of tasks stuck running", (c) records test issues only as transient
`--issue` strings (no trackable bugs), and (d) reports pass/fail counts with no summary.
SP1 added the `bug` entity + `testRun.summary`; v2.1 added the loop level; SP2 renders all
of it. SP3 makes the driver actually **produce** that data: start a loop per run, transition
task/phase/loop status, open/fix bugs, and attach test-run summaries.

## Architecture

Edit one skill file — `plugins/autoloop-reporting/skills/autoloop/SKILL.md` — and sync its
curl-installer copy via `scripts/sync-autoloop-cli.sh` (which copies the skill to
`web/public/skill/autoloop/SKILL.md`; the plugin bundles the canonical copy directly). The
plugin version is bumped. No other files change. The driver keeps its **best-effort
reporting** contract (a `autoloop` warning is noted, never fatal).

This is prose, so the "interface" is the set of CLI commands the algorithm emits; the
correctness bar is that **every command in the file matches a real CLI verb + flags** and
the algorithm's ordering is sound (ids generated before use, status transitions in the
right place, bugs opened/closed coherently).

## The four behaviors

### 1. Start a loop at run start (v2.4)

After `autoloop project set`, before planning:
```
autoloop loop start <loopId> --goal "<this run's objective>" --order <n>
```
- **Always** — every `/autoloop` run begins a loop, so all its phases/tasks/scores/testRuns/
  revisions/bugs land under that loop and the dashboard's loop selector + per-loop rollups
  are meaningful. Existing project-direct data stays as the synthesized legacy `main`.
- **Loop id scheme:** a short date-stamped slug — `loop-YYYY-MM-DD`, with a `-<n>` suffix if
  a project already has a loop for that day (the driver picks the next free suffix). Readable
  and `order`-sortable. `--order` = the next loop number for the project (1 for the first).
- `autoloop init` already seeds `currentLoopId`/`loops` (v2.1); once `loop start` sets
  `currentLoopId`, all later reporting auto-targets the loop (CLI `loopSeg`). No other command
  in the algorithm needs a loop flag.

### 2. Transition task / phase / loop status (the data half of only-current-is-live)

- After a task's implement → test → score cycle completes: `autoloop task set <id> --status
  completed` (the task's work is done — even if its scenario still needs more work; that drives
  a revision/new task, not a non-terminal task). Use `--status failed` if the task is abandoned.
- When every task in a phase is terminal: `autoloop phase set <id> --status completed`.
- At termination: `autoloop loop set <loopId> --status completed`; use `--status cancelled` if a
  cap truncated the run. (Server derives `currentTaskId`/`currentPhaseId`/`currentLoopId` to
  null/advance as things go terminal — this is what makes the dashboard stop showing stale
  "running".)

### 3. Open / fix bugs as trackable entities

- When a test-run has `failed > 0`, **or** the AI-judge finds a concrete defect: open a bug
  ```
  autoloop bug add <bugId> --title "<short>" --scenario <scenarioId> --task <taskId> --severity <low|medium|high> [--description "<detail>"]
  ```
  - `bugId` = a slug of the title (stable, so re-reporting updates in place).
  - **Severity (AI-judged):** `high` = blocks a targeted scenario / breaks core behavior;
    `medium` = real defect with a workaround or limited scope; `low` = cosmetic/minor.
- When a later task resolves it (ideally confirmed by a subsequent passing test-run): `autoloop
  bug set <bugId> --status fixed`.
- The transient `test-run --issue "<note>"` becomes **optional** — bugs are the tracked
  artifact; an `--issue` is just a one-line per-run note when a full bug isn't warranted.

### 4. Test-run summaries

Add a short summary to each test report:
```
autoloop test-run <scenarioId> --task <taskId> --passed <n> --failed <m> --summary "<1–3 sentences: what was exercised + the conclusion>"
```
Use `--summary-file <path.md>` instead when the summary is long (e.g. a captured report).

## Worked example (replaces the current one)

The bottom-of-file example is rewritten to show one full cycle:
```
autoloop vision import --file vision.json
autoloop project set --title "Acme Web" --status running
autoloop loop start loop-2026-06-03 --goal "Ship login + payments" --order 1
# writing-plans → phase "build", task "login" advancing scenario "login-works"
autoloop phase start build --name "Build" --order 1
autoloop task start login --phase build --name "Login" --order 1 --scenarios login-works
# …implement via subagent-driven-development, git commit…
autoloop commit --task login
autoloop test-run login-works --task login --passed 5 --failed 1 --summary "Ran login e2e; happy path passes, password-reset throws on expired token."
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

## Rules additions

Add to the skill's **Rules** section:
- **Close what you open.** A task that finishes gets `task set --status completed/failed`; a
  phase whose tasks are all done gets `phase set --status completed`; the loop gets
  `loop set --status` at the end. Don't leave work `running`.
- **Bugs are tracked, not just noted.** Open a `bug` for real defects (so they appear in the
  Bugs view and can be resolved); reserve `test-run --issue` for transient notes.
- (Keep the existing best-effort / honest-scoring / no-silent-truncation / plan-order rules.)

## Plugin version

Bump `plugins/autoloop-reporting/.claude-plugin/plugin.json` (currently `0.2.1` → `0.3.0`,
a meaningful behavior change) so installed plugins pick up the new driver.

## Testing / verification

- **Command accuracy:** every `autoloop …` line in SKILL.md must match a real CLI verb + flags
  (cross-check against `cli/autoloop.mjs`: `loop start/set`, `task set --status`, `phase set
  --status`, `bug add/set` flags, `test-run --summary/--summary-file`, `--severity` enum
  low|medium|high, `--status` open|fixed for bugs).
- **Sync parity:** after `scripts/sync-autoloop-cli.sh`, `web/public/skill/autoloop/SKILL.md` is
  identical to the plugin copy (the script copies it).
- **No regressions:** `functions` + `web` suites stay green (no code changed, so this is a
  sanity check, not new coverage).
- No unit tests — this is skill prose.

## Out of scope

- Per-loop notifications (v2.3) — separate.
- Any contract/CLI change (all verbs already exist).
- Automating loop-id collision handling beyond "pick the next free `-<n>` suffix" guidance.

## Success criteria

- The driver starts a loop per run and reports all run data under it; the dashboard shows a
  real current loop with advancing phases/tasks (no stuck "running").
- Tasks/phases/the loop reach terminal status when done.
- Defects surface as trackable bugs (opened with AI-judged severity, fixed when resolved).
- Test reports carry a human-readable summary.
- Every command in SKILL.md is valid against the CLI; the plugin + curl copies are in sync;
  the suites stay green.
