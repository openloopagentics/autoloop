# The loop never stops unless the user stops it (compaction-resilient driver)

**Date:** 2026-06-30
**Status:** Design — approved, pending spec review
**Scope:** `cli/autoloop.mjs` (relaunch installer + two new hook handlers + pure decision/fingerprint helpers) and the driver skill `plugins/autoloop/skills/autoloop/SKILL.md`. No backend/web changes. Independent of SP1/SP2.

## Problem

An Autoloop loop must keep running until the *user* stops it. Today it can silently stall on **Claude Code context compaction**. Compaction happens **in-place** — the session stays alive and keeps holding its lock, so none of the existing liveness machinery fires:

- `SessionEnd`/relaunch and the launchd `wake` job only trigger on actual session **termination**; compaction is not a termination.
- The driver's "go back to Step 2a / start the next loop / run `autoloop loop resume`" intent lives only in conversation history, which the compaction **summary discards**.
- There is **no `PreCompact` or `SessionStart` hook**, and the SKILL never tells a *continuing* (non-fresh) session to re-resume. Step 0 / `autoloop loop resume` only runs when `/autoloop` is invoked fresh (a relaunch).
- The SKILL even lists *"context exhaustion"* as a **valid reason to stop** (line ~363) — backwards.

Net: after compaction the orchestrator may lose its "keep looping" imperative and stall, while every relaunch/wake guard correctly stays inert (the session is still alive and holding its lock). The server still holds the full resumable state — nothing consumes it.

(Confirmed Claude Code behavior: auto-compaction continues the same session; `SessionStart` fires with `source: "compact"` and can inject `additionalContext`; the `Stop` hook can block a turn from ending; `PreCompact` can only block compaction and thrashes — not usable.)

## Goals

- A loop **never stops unless the user stops it** — surviving both in-place compaction and premature turn-ends.
- The user can **always** stop it: a `stop`/`pause` dashboard message, a paused/terminal loop, or simply killing the session (Ctrl-C) all end it.
- A **bounded** guarantee: a genuinely wedged loop (no progress) is cut after a small number of idle continues, with a loud record — never an unbounded token burn.
- Reuse existing primitives (lockfile, `fetchResumeState`/`isResumable`, `~/.autoloop/env`, the relaunch installer, pure-decision + unit-test pattern).

## Non-goals

- No change to the existing `SessionEnd` relaunch / `wake` machinery (it correctly handles genuine termination and stays as-is).
- No `PreCompact` hook (it can't inject context and thrashes).
- No backend, schema, web, or new-CLI-command work. The hooks install through the existing `autoloop init --relaunch` path.

## Design

Two new Claude Code hooks (Layers A + B) plus SKILL wording, all installed by the existing `installRelaunch` (`cli/autoloop.mjs`) into the project `.claude/settings.json` alongside today's `SessionEnd` hook — so they inherit the per-project env, the stable CLI path, and the relaunch install/uninstall lifecycle.

### Layer A — `SessionStart` hook (compaction recovery)

- Registered for `SessionStart`; handler `node <cli> hook session-start`.
- Fires on `startup` / `resume` / **`compact`**. The handler reads the hook stdin payload (for `cwd`), loads `~/.autoloop/env`, resolves the project from the cwd's `.autoloop.json`, and calls `fetchResumeState`.
- **Only if `isResumable`** (loop exists, non-terminal, **not** paused) it prints:
  ```json
  { "hookSpecificOutput": { "hookEventName": "SessionStart",
    "additionalContext": "An Autoloop loop is mid-flight (loop <id>, next: <task header>). Your context may have just been compacted or resumed — run `autoloop loop resume` now and continue from Step 0. Compaction/summarization is NOT a stop." } }
  ```
  Otherwise it prints nothing (`{}` / empty) so non-loop sessions and paused/terminal loops are never nagged.
- This is the core compaction fix: intent + state come from the **server**, not the lost conversation history.

### Layer B — `Stop` hook (the "never stop" guarantee, bounded)

- Registered for `Stop`; handler `node <cli> hook stop`. Fires when the driver's turn ends. Runs in-process (our pid holds the lock) — it only **blocks the current turn from ending**; it never spawns a competing driver, so it doesn't conflict with the `SessionEnd` relaunch.
- The handler gathers state from a **single `fetchResumeState`** call (the `/state` `LoopState` bundle already carries `loop.status`, the per-task/phase/scenario fields used for the fingerprint, **and `pendingMessages`** — no separate `/messages` call needed), updates the idle counter, then calls the pure `decideStop`.

**Pending-stop classification (`hasPendingStop`).** Read `state.pendingMessages` (each has `text`). `hasPendingStop = true` iff any pending message's text, **trimmed and lower-cased, equals exactly `"stop"` or `"pause"`** — matching the SKILL's documented `stop`/`pause` commands. Exact-match (not substring) so messages like "don't stop" don't trip it. This is a secondary fast-path; the primary user-stop signal is the driver draining the message and setting the loop to `paused` (which `decideStop` already allows on).

**`decideStop({ loopStatus, hasPendingStop, progressed, idleCount, idleMax = STOP_IDLE_MAX })`** — sibling to `decideSessionEndRelaunch`/`decideWake`:

| condition | result |
|---|---|
| `loopStatus` missing or terminal (completed/failed/cancelled) | **allow** — nothing to run / done |
| `loopStatus === "paused"` | **allow** — user paused it |
| `hasPendingStop` (a `stop`/`pause` message in the channel) | **allow** — user is stopping it |
| `!progressed && idleCount + 1 >= idleMax` | **allow** + write a loud "loop wedged — stopped after N idle continues" record |
| otherwise (running/queued/blocked, progressing or under the idle cap) | **block** |

Block output:
```json
{ "decision": "block", "reason": "The Autoloop loop is still live — run `autoloop loop resume` and continue (Step 2a / start the next loop). Do not stop until the loop is terminal or the user stops it." }
```
Allow output: nothing (`{}`), letting the turn end (genuine headless termination then flows through the existing `SessionEnd` relaunch).

**Bounded idle guard.** The Stop handler keeps `~/.autoloop/run/<team>-<slug>.stop.json` = `{ fingerprint, idleCount }`. The pure **`stopFingerprint(state)`** derives a stable string from fields the `/state` bundle **actually returns** (confirmed in `functions/src/services/loopState.ts` — `LoopState`):
- `loop.status`, `loop.currentPhaseId`, `loop.currentTaskId`
- sorted per-task `id:status` and per-phase `id:status`
- sorted `openBugs` ids
- sorted per-scenario `id:<latestComposite>:<latestTestRun.passed>/<latestTestRun.failed>` — note the bundle attaches the score as a **flat `scenario.latestComposite`** field (`loopState.ts` line 71), NOT `latestScore.composite`; `latestTestRun` is `{ passed, failed }`. So scoring/testing activity is visible as progress.

`progressed = fingerprint !== stored.fingerprint`. On progress → reset `idleCount = 0` and store the new fingerprint. On no progress → `idleCount += 1`. At `STOP_IDLE_MAX` (default **3**) the guard allows the stop and writes a loud wedged record via **`autoloop messages send`** (best-effort) so it surfaces in the dashboard. **The idle counter is the sole bound** — we do not depend on the payload's `stop_hook_active` (a missing/corrupt `.stop.json` resets to `idleCount = 0`, so the bound is always re-derivable).

### SKILL.md changes (`plugins/autoloop/skills/autoloop/SKILL.md`)

- **Delete the context-exhaustion stop in BOTH places** (there are two authoritative occurrences):
  1. the valid-stop list (~line 353): "Genuine context or token exhaustion — you physically cannot continue."
  2. the Rules section (~line 454): "Do not stop between loops unless the user explicitly said to, gave a round count you've hit, or you've hit genuine context exhaustion." → remove the "or genuine context exhaustion" clause.
  Both must be addressed or the Rules will still permit stopping on compaction. After deleting item 3 from the valid-stop list, re-number the remaining items (1, 2) so no dangling reference is left.
- Add a short **"Surviving compaction"** note near Step 0 / the loop-control section: *if your context is compacted/summarized mid-loop (you'll notice lost detail, or a SessionStart-injected resume note), immediately run `autoloop loop resume` and continue from the next task — never conclude the work is done just because context was summarized.*
- Tighten the **"only valid stops"** list to exactly: a user `stop`/`pause` message, an explicit iteration count reached, or a genuinely terminal loop. Add one line noting a `Stop` hook keeps the loop alive across turn-ends, so ending a turn with work remaining will prompt continuation.

## Components / file map

| File | Change |
|---|---|
| `cli/autoloop.mjs` | `installRelaunch`: also register `SessionStart` + `Stop` hooks. **Idempotency:** mirror the existing `RELAUNCH_HOOK_MARKER` ("hook session-end") filter — define markers for "hook session-start" / "hook stop" and filter those hook arrays before re-pushing, so repeated `autoloop init --relaunch` never accumulates duplicates. New handlers `case "hook session-start"` and `case "hook stop"`. New exported pure helpers `decideStop`, `stopFingerprint`, and a `STOP_IDLE_MAX` const. Small read/write of the `.stop.json` idle-state file (reuse the run-dir helpers). |
| `plugins/autoloop/skills/autoloop/SKILL.md` | wording changes above |
| `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs` | re-synced via `scripts/sync-autoloop-cli.sh` |
| `web/public/skill/autoloop/SKILL.md` | re-synced SKILL copy |
| `functions/test/cli.unit.test.ts` | tests for `decideStop`, `stopFingerprint`, and the two hook handlers |

## Error handling / safety

- All hook handlers are **best-effort**: any failure (no env, network error, unparmable payload) prints nothing and exits 0 — a broken hook must never wedge the session or block compaction.
- Layer B only ever **blocks in-process**; it cannot spawn or relaunch, so it can't create competing drivers. The **idle guard is the sole bound** on the block loop; the user's `stop`/`pause` message and Ctrl-C always win.
- The `.stop.json` idle state is per-project in the run dir; a missing/corrupt file resets to `idleCount = 0` (fail-open toward "allow" only via the cap, never toward infinite block).

## Testing

- **`decideStop`** unit tests (mirror `decideWake`/`decideSessionEndRelaunch`): terminal→allow; paused→allow; pendingStop→allow; running + progressed→block (idle reset); running + no progress under cap→block (idle++); no progress at cap→allow + wedged record.
- **`stopFingerprint`** tests: changes when a task status / `currentTaskId` / event count changes; stable otherwise.
- **`hook session-start`** test (injected `fetchImpl`): resumable→emits the `additionalContext` JSON; terminal/paused/none→emits nothing.
- **`hook stop`** test (injected `fetchImpl` + temp run dir): block vs allow per `decideStop`; idle counter increments/resets across calls; the wedged record is written at the cap.
- **`installRelaunch`** test: settings now contain `SessionStart` + `Stop` hooks alongside `SessionEnd`.
- After CLI edits: `bash scripts/sync-autoloop-cli.sh`; assert the tracked copies match.

## Risks / open questions

- **Interactive UX:** in an interactive terminal the Stop block means the agent won't return to the prompt while a loop is live; the user stops via a `stop`/`pause` message or Ctrl-C. This is the intended "running is the default" behavior, but it is a behavior change for interactive `/autoloop` users — call it out in the PR.
- **Per-turn network cost:** the Stop handler makes a single `/state` fetch on every turn-end (the bundle already includes pending messages — no extra call), same cost profile as the existing `SessionEnd` hook. Acceptable.
- **`STOP_IDLE_MAX` tuning:** default 3; a pathological loop that makes *tiny* progress each turn without truly advancing could evade the idle guard — acceptable for v1 (the fingerprint keys on task-status/counts, which a real stall won't change).
