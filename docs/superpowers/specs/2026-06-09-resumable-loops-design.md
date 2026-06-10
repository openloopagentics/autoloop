# Autoloop — Durable, resumable loops design spec

**Date:** 2026-06-09
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** 4 of 6 in the self-evolution batch. Makes "running is the default"
survive the Claude Code session: a fresh session can reconstruct a mid-flight loop from
the server (**Phase 1: resume**), and hooks relaunch a session when it dies mid-loop or
when a message arrives for a paused loop (**Phase 2: relaunch**) — replacing the
context-burning sleep-poll pause with an external wake.

## Goal

Today the loop lives entirely inside one session: context exhaustion or a crash
orphans the run (dashboard shows `running` forever, nobody is listening for messages),
and the Step 4 pause is a `while true; sleep 30` loop that burns tokens doing nothing.
The server already stores the entire plan (phases/tasks with statuses and ordering,
pending messages, events) — what's missing is a way to read it back and a trigger to
start a new session.

**Mechanism (user decision): resume verb + relaunch hook.** A full headless daemon
owning loop lifecycle was explicitly not chosen.

## Architecture

- **Phase 1** adds the second agent **read** endpoint (after `messages pull`):
  `GET …/loops/:loopId/state` returning an aggregated state bundle, a CLI
  `autoloop loop resume` that prints it, and a **Resume** section in the driver skill.
  Pure read — no schema or rules change.
- **Phase 2** adds `autoloop init --relaunch`, installing host-side machinery in the
  same way `init --session-log` already installs hooks: (a) a Claude Code **Stop hook**
  that relaunches a headless session when the session ends while the current loop is
  still non-terminal, and (b) a **launchd interval job** (macOS; documented cron
  variant for Linux) that wakes a *paused* loop when a pending user message exists. A
  **lockfile** prevents two sessions driving one project.

## Phase 1 — resume

### API

`GET /v1/teams/:teamId/projects/:slug/loops/:loopId/state` (`requireApiKeyMember`;
loop-scoped mount beside the other `…/loops/:loopId/*` mounts). Also a project-direct
variant `GET …/state` for implicit-`main` projects (same handler, no loopId).

Response `{ ok: true, state }` where `state` =

```ts
{
  loop: { id, goal, name?, order, status, currentPhaseId?, currentTaskId? } | null, // null project-direct
  project: { slug, title, status, currentLoopId? },
  phases: [{ id, name, order, status }],                  // ordered by order
  tasks:  [{ id, phaseId, title, order, status, scenarioIds }],  // ordered by order
  scenarios: [{ id, goalId, title, threshold,
               latestComposite?, latestTestRun?: { passed, failed } }], // project-level vision,
                                                          // latest events read loop-scoped
  openBugs: [{ id, title, severity?, scenarioId?, taskId? }],
  pendingMessages: [{ id, text, createdAt }],             // project-level, oldest-first
}
```

Implementation: one service `getLoopState` in a new `services/loopState.ts` —
parallel reads of the base-path collections (phases, tasks, bugs filtered `open`),
project-level scenarios + pending messages (reuse the messages service query), and per
scenario the latest score + latest test-run (order-by-id-desc limit-1 each, loop-scoped
via `resolveBase`). Scenario count is small; N+1 reads are fine at this volume
(consistent with the no-composite-indexes stance).

### CLI

- `autoloop loop resume [loopId]` — loopId defaults to `cfg.currentLoopId`, else the
  server project's `currentLoopId` (returned in `state.project`); prints the bundle as
  pretty JSON plus a human header: loop id/status, `N/M tasks terminal`, `K pending
  messages`, first non-terminal task. Uses the `fetchJson` helper. Exits 0 always
  (best-effort), but prints `no active loop` when nothing is resumable.
- Sync the three CLI copies.

### Driver skill — new Step 0 (Resume check)

At `/autoloop` start, before Step 1: if `.autoloop.json` exists, run
`autoloop loop resume`. If it returns a non-terminal loop:
- **Skip setup** (no `vision import`, no new `loop start`).
- Rebuild the working plan from `state` (phases/tasks + statuses); the next task = the
  first non-terminal task by phase order then task order.
- Drain `pendingMessages` first (act + ack), then continue the normal Step 2 per-task
  loop. A `paused` loop resumes into Step 4 (paused) unless a pending message says
  otherwise.
If the state shows no non-terminal loop, proceed to normal Step 1 setup.

## Phase 2 — relaunch machinery

All installed by `autoloop init --relaunch` (mirroring the session-log hook installer:
copies a stable CLI to `~/.autoloop/`, writes idempotent, versioned entries):

- **Lockfile:** `~/.autoloop/run/<teamId>-<slug>.lock` containing the session PID.
  The skill's Step 0/Step 1 asks the CLI to acquire it (`autoloop lock acquire`,
  stale-PID detection: dead PID ⇒ steal); `autoloop lock release` at terminal loop
  close. All relaunch triggers no-op when a live lock exists.
- **Stop hook** (project `.claude/settings.json`): on session end, runs a small shim
  that checks (1) lock owner == this session's PID tree, (2)
  `autoloop loop resume --check` (new flag: exit 0 + silent when a non-terminal,
  non-paused loop exists; exit 1 otherwise). If resumable: release the lock and
  relaunch `claude -p "/autoloop" --permission-mode acceptEdits` detached (nohup, output
  to `~/.autoloop/logs/<slug>.log`). **Backoff guard:** a relaunch-stamp file; more
  than 3 relaunches within 30 minutes ⇒ stop relaunching and leave a log line (prevents
  crash loops).
- **launchd wake job** (`com.autoloop.wake.<slug>`, every 5 min): if no live lock AND
  the loop is `paused` AND `autoloop messages pull --check` (new flag: exit 0 when
  pending user messages exist, without acking) ⇒ launch the same headless command. The
  skill's Step 4 pause is rewritten: instead of an indefinite sleep-poll, after a short
  drain window the paused session **exits** (releasing the lock) — the wake job is now
  the listener. This is the token-burn fix.
- `autoloop init --relaunch --uninstall` removes the hook entries, plist, and lock.

Linux: a documented crontab line replaces launchd; the Stop hook is identical.

## Validation / rules

No schema change (Phase 1 is read-only; Phase 2 is client-side). No `firestore.rules`
change. The state endpoint needs no new rules tests (API-key path, not client reads),
but gets API auth tests like other agent routes.

## Testing

- **API (Supertest + emulator):** state bundle — loop-scoped and project-direct shapes,
  ordering (phases/tasks by order, messages oldest-first), latest-event selection per
  scenario (latest by ULID, not timestamp), open-bug filtering, 404 on missing
  loop/project, 401 unauthenticated.
- **CLI:** `loop resume` URL construction + loopId fallback chain + `--check` exit
  codes; `messages pull --check` does not ack; lock acquire/steal-on-dead-PID/release
  (unit-testable against a temp dir).
- **Hook shims:** unit-test the decision functions (resumable? backoff exceeded? lock
  live?) as pure node functions in the shim file; the launchd/Stop wiring itself is
  verified by a documented manual checklist (same approach as the session-log hook).
- **Skill:** prose validated against the CLI (every command exists, flags real) — the
  driver-hygiene review rule.

## Back-compat

Purely additive. Sessions that never run `init --relaunch` behave exactly as today
(modulo the skill's Step 0, which no-ops when there is no non-terminal loop). The
old sleep-poll pause remains the documented fallback when relaunch machinery is not
installed — the skill branches on whether `--relaunch` is installed (the init writes a
marker the CLI can report via `autoloop status`).

## Out of scope

- A persistent daemon owning loop lifecycle (explicitly rejected option).
- Cross-machine resume (lock + hooks are per-host; the state endpoint itself is
  machine-agnostic and would support it later).
- Windows host support.
- Realtime push to wake instantly on message (5-min poll is accepted; FCM/webhook push
  is future work shared with the native apps' SP4).

## Success criteria

- Kill a mid-loop session; a fresh `/autoloop` session reconstructs position from the
  server and continues from the first non-terminal task, draining messages first.
- With `--relaunch` installed: a dying mid-loop session relaunches itself (≤3 times/30
  min); a paused loop's session exits cleanly and a dashboard message brings a new
  session up within ~5 minutes; no double-driver thanks to the lock.
- All suites green; three CLI copies + skill copies synced; no schema/rules change.
