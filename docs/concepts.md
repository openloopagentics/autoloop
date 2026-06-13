# Autoloop — Concepts & Vocabulary

This is the **canonical vocabulary** for Autoloop. When the driver skill, the CLI,
the API schemas, the web UI, and product copy disagree on what a word means, this
document wins. Each section is **layered**: a one-line plain definition (what it
means to a user), then a *Formal* block (types, states, invariants) with the source
of truth in code.

It answers four questions:

1. [The vocabulary](#1-the-vocabulary) — how we name the parts.
2. [Self-learning](#2-self-learning-how-a-loop-improves) — how a loop improves.
3. [Guidance](#3-guidance-what-a-user-can-tell-a-loop) — what a user can tell a loop.
4. [Self-fixing](#4-self-fixing-how-a-loop-recovers) — how a loop recovers.

Four **drift-killers** the rest of this doc nails down, because they are the terms
that currently slip:

- A **run / iteration is not a stored thing** — only Loops and Sessions exist; "run"
  is a way of *grouping loops for display*.
- **Self-learning is cross-loop and inspectable** — a loop learns by writing durable,
  reason-bearing records the *next* loop reads, not by hidden weights.
- **Guidance is organized by timescale** — vision-time, mid-run, cross-loop.
- **"Fixes itself" is two different things** — self-*correction* (getting the work
  right) versus self-*recovery* (staying alive).

---

## 1. The vocabulary

### Containment hierarchy

```
Team
└─ Project
   ├─ Vision ............ goals + scenarios + rubrics (what "done" means)
   ├─ Ideas backlog ..... durable cross-loop improvement ideas
   ├─ Messages .......... the user↔loop channel
   ├─ visionChanges ..... append-only log of vision growth
   └─ Loop  (one iteration toward the vision)
      ├─ Phase
      │  └─ Task
      ├─ Scenario (← Goal, via Vision) → Rubric → threshold
      ├─ events: commit · test-run · score · verification · revision · bug
      └─ Session (transcript of one driving process)
```

### The nouns

**Vision** — *the durable definition of what is being built and what "good" means.*
A set of **goals**, each holding **scenarios**, each scenario carrying a **rubric**
and a **threshold**. Authored with `/autoloop-vision` into a `vision.json`, mirrored
server-side.
*Formal:* ownership is tracked on the project as `visionOwner: "web" | "loop"` —
`"web"` = the user edited it in the dashboard, `"loop"` = the agent proposed it (see
[§2 Vision growth](#2-self-learning-how-a-loop-improves)). Types: `web/src/dashboard/types.ts`
`Project.visionOwner`; schemas: `functions/src/schemas.ts` `scenarioBody`, `goalBody`.

**Goal** — *a textual objective inside a vision.* Groups related scenarios.

**Scenario** — *a single testable acceptance criterion.* The unit of "done."
*Formal — a scenario is **met** when all three hold* (`SKILL.md` Step 3, lines 362–365):
1. a **test-run** with `failed === 0`, **and**
2. a **score** with `composite ≥ threshold` (threshold default **80**), **and**
3. the latest test-run was **not `refuted`** by verification.
Missing any one ⇒ **unmet**, even if the composite is high. Schemas: `scenarioBody`
(`threshold` 0–100), `scoreBody` (`composite` 0–100).

**Rubric** — *the weighted criteria a scenario is scored against.* Each criterion is
`{name, weight, max}`; scoring produces the 0–100 `composite`.

**Loop** — *one scoped development effort — a single iteration toward the vision.*
The central noun. It is a **container**, not a schedule: a loop is driven by an agent,
not fired by cron. Fields: `goal`, `name`, `order`, `status`, `previewUrl`; plus the
derived pointers `currentPhaseId` / `currentTaskId`. Types: `web/src/dashboard/types.ts`
`Loop`; schema: `loopBody`; service: `functions/src/services/loops.ts`.

**Phase** — *an ordered grouping of tasks inside a loop.*

**Task** — *the atomic unit of work.* The driver dispatches **one implementation
subagent per task**; the task emits a commit, a test-run, and a score (`SKILL.md` Step 2).

**Session** — *the transcript of one Claude Code process driving a loop.* **A loop can
span many sessions** — each crash, relaunch, or wake starts a new session against the
same loop. Append-only. Schema: `sessionBody`; routes: `functions/src/routes/sessions.ts`.

**Run / iteration** — *presentation only.* Loops grouped by the **calendar day they
started** ("Today" / "Yesterday" / a date) for display. **There is no Run entity in the
data model** — `web/src/dashboard/loopView.ts` `groupLoopRuns()` derives it. When you
hear "run," read it as "a loop, shown under its start-day."

**Driver** — *the orchestrating agent* — the `/autoloop` skill. It is the **sole
orchestrator** of a loop: it drives task-by-task in its own session and reports status;
subagents only implement code, they never report.

**Event records** — *append-only facts a loop emits as it works:* `commit`, `test-run`,
`score`, `verification`, `revision`, `bug`. They are the loop's evidence trail.

### The loop state machine

```
queued ─▶ running ─▶ (blocked | paused) ─▶ running ─▶ … ─▶ { completed | failed | cancelled }
                                                              └────── terminal ──────┘
```

*Formal* (`functions/src/status.ts`): `STATUSES = [queued, running, blocked, paused,
completed, failed, cancelled]`; `TERMINAL = {completed, failed, cancelled}`.

**Invariants** — the load-bearing guarantees:

- **Terminal cascade (backstop).** When a loop reaches a terminal status, the server
  sweeps every non-terminal phase and task under it to the **same** status and nulls
  `currentPhaseId` / `currentTaskId`. No orphaned "running" tasks survive a finished
  loop. `functions/src/services/loops.ts` (upsert) + `functions/src/services/backstop.ts`.
- **`endedAt` is immutable.** Stamped once, on the first terminal transition; never
  overwritten — even if the loop is later re-touched.
- **Derived pointers are never authored.** `currentLoopId` (on the project),
  `currentPhaseId` / `currentTaskId` (on the loop) are recomputed on every write as the
  lowest-`order` non-terminal child. Don't set them by hand.
- **Zombie display rule.** A loop stuck `running` but untouched for **> 3h** renders as
  `paused` in the UI so users know nobody is listening — the *stored* status is left
  untouched; this is pure presentation. `loopView.ts` `STALE_RUNNING_MS = 3 * 3600_000`,
  `displayLoopStatus()`.

---

## 2. Self-learning: how a loop improves

A loop does not learn by adjusting hidden weights. **It learns by emitting durable,
reason-bearing records that the *next* loop reads.** Learning is cross-loop, on the
server, and fully inspectable.

The unifying pattern — call it **autonomous-with-veto**: the loop acts immediately and
records *why* (a `rationale` / `reason` field is the captured learning); the user steers
asynchronously by accepting, rejecting, or reverting. The loop never blocks waiting for
permission, and the user is never locked out.

| Mechanism | What the loop learns | Where it's recorded | User's veto |
|---|---|---|---|
| **Ideas backlog** | "Here's what we should build next." At close, the loop proposes **≥5** improvement ideas, each with a `rationale` and `origin-loop`. The next loop deterministically builds the **first `accepted`, else first `proposed`** idea (never a `rejected` one). | project `ideas` collection; `functions/src/services/ideas.ts`; `SKILL.md` "Ideas" (lines 325–340) | accept / reject / reorder in the dashboard |
| **Vision growth** | "This scenario was missing / this threshold was wrong / this goal is implied." The loop expands the vision via `autoloop vision propose --reason "<learning>"` — **never a bare PUT**. | append-only, revertable `visionChanges` log; `functions/src/services/visionChanges.ts`; schema `visionChangeBody` | reject the proposal (reverts using the recorded prior state) |
| **Independent verification** | "Did the implementation *actually* pass?" A clean-context **verifier subagent** (never saw the code) replays each scenario's recorded test command and emits `confirmed` or `refuted`. | `verifications` events; schema `verificationBody`; `SKILL.md` Step 3a | — (an integrity check, not user-steered) |
| **Revisions** | "Why a scenario is still unmet, and what we'll change." Append-only explanation carrying task changes (`add` / `replace` / `reorder` / `drop`). | `revisions` events; schema `revisionBody` | — |
| **Bugs** | Defects found, with an `open → fixed` lifecycle, linked to scenario / task / commit. | `bugs` collection; schema `bugBody` | — |
| **Trends + preview** | "Is the output *actually* getting better?" `previewUrl` + client-derived sparklines: `metCount/total`, `avgComposite`, `bugsOpened` vs `bugsFixed`, `tokensTotal` over the last 20 loops. | `loop.previewUrl`; derived in the dashboard | — |
| **Product map** | "What have we built?" A living DAG of goals / scenarios / bugs with growth-replay over time. | derived map view | — |

> **`refuted` ⇒ unmet, regardless of score.** Verification can override an optimistic
> self-score — this is the loop's defense against marking its own homework.

---

## 3. Guidance: what a user can tell a loop

A user steers a loop on three **timescales**. Across all of them, **the user always wins
on conflict** — a message, a rejection, or a veto overrides the loop's autonomy.

### Vision-time — *"what good looks like"* (before / around the loop)

Author `vision.json` via `/autoloop-vision`: **goals, scenarios, rubrics, thresholds, and
test commands.** This is the strongest form of guidance — it defines the target the loop
optimizes toward and the bar it must clear.

### Mid-run — *synchronous steering* (the message channel)

The user sends free text — `autoloop messages send --text "…"` or the dashboard Messages
tab (`messageBody`: text, 1–8192 chars). The driver **drains pending messages at natural
boundaries**, oldest-first, acting on each then acknowledging it:

- **after each task** — 3 polls × 15s ≈ **45s** window (`SKILL.md` Step 2e, line 210)
- **between loops** — 6 polls × 30s = **3 min** window (line 312)
- **while paused** — 4 polls × 30s = **2 min** short window (line 392)

Handling rules (`SKILL.md`):

| Message | Effect |
|---|---|
| `stop` / `pause` | finish the current task, then enter `paused` |
| `continue` / `resume` | proceed |
| scope / plan change | adjust the remaining tasks **now** |
| anything else | treat as a fresh user instruction |

### Cross-loop — *steering the trajectory* (durable, asynchronous)

Between iterations, the user shapes *where the product goes* without touching a running
session:

- **Ideas backlog:** accept / reject / reorder — picks the next loop's goal.
- **Vision-change veto:** reject a proposed scenario/goal (reverts it).
- **Trends & preview review:** judge whether output is actually improving.

### Configuration

Direct field edits via `autoloop … set`: `order`, `status`, `previewUrl`, `name` on
loops/phases/tasks (`loopBody` and the phase/task equivalents). `order` is how the user
re-sequences work (it recomputes the `current*` pointers).

---

## 4. Self-fixing: how a loop recovers

"Fixes itself" is **two distinct mechanisms**. Keep them apart.

### Self-correction — *getting the work right* (quality, within scope)

The met/unmet convergence cycle (`SKILL.md` Steps 2–3):

```
task → commit → test-run → score → independent verification (may refute)
     → revision (adjust tasks, with a reason)  → bug (track a defect)  → re-implement
```

The loop drives each scenario to **met**, or records **why it can't** (a revision). A
`refuted` verification or a `composite < threshold` keeps the scenario unmet and feeds the
next decision. Honest scoring is a rule, not a nicety — an unmet scenario that *triggers a
revision* is the loop working correctly, not failing.

### Self-recovery — *staying alive* (liveness, durability)

Keeping a loop progressing across crashed sessions, machine sleeps, and pauses:

- **Resume.** `autoloop loop resume` returns a **state bundle** — loop, project, phases,
  tasks, scenarios, open bugs, pending messages — so a fresh session rebuilds its exact
  position (next task = first non-terminal by phase order, then task order). The driver
  does this at **Step 0, before any setup**, so it never clobbers an in-flight plan.
  `functions/src/services/loopState.ts`.
- **Relaunch.** When a session ends with a non-terminal, non-paused loop, a SessionEnd
  hook spawns a fresh headless driver. Guarded by `decideSessionEndRelaunch({lockState,
  resumable, backoff})` — blocked if another **live** session holds the lock, if nothing
  is resumable, or if **backoff** trips (≥ `RELAUNCH_MAX` relaunches within
  `RELAUNCH_WINDOW_MS` = 30 min — crash-loop protection). A per-project **lockfile**
  prevents two drivers on one project. `cli/autoloop.mjs` `decideSessionEndRelaunch`,
  `backoffExceeded`, `launchHeadless`.
- **Wake job.** A 5-minute launchd/cron job relaunches a **paused** loop when a user
  message arrives — so a pause costs no tokens, yet the user's next message still wakes
  it. `decideWake({lockState, loopStatus, hasPendingMessages})`: wakes only when no live
  lock, status is `paused`, and there are pending messages.
- **Backstop sweep.** The terminal cascade ([§1 invariants](#the-loop-state-machine))
  closes dangling phases/tasks when a loop finishes — recovery from a driver that forgot
  to tidy up.
- **Zombie handling.** A `running` loop untouched > 3h is surfaced as `paused`
  ([§1](#the-loop-state-machine)) so a dead session doesn't read as live work.

> Relaunch and wake are **best-effort**, and only active when the relaunch machinery is
> installed (`autoloop status` → `relaunchInstalled: true`). Without it, a paused session
> stays alive and polls indefinitely rather than handing off.

---

## Source-of-truth map

| Concern | Files |
|---|---|
| Status & lifecycle | `functions/src/status.ts`, `functions/src/services/{loops,backstop}.ts` |
| Schemas (the contract) | `functions/src/schemas.ts` (`loopBody`, `scenarioBody`, `scoreBody`, `messageBody`, `visionChangeBody`, `revisionBody`, `bugBody`, `verificationBody`, `testRunBody`, `sessionBody`) |
| Resume / learning services | `functions/src/services/{loopState,messages,ideas,visionChanges}.ts` |
| Relaunch / wake / lock | `cli/autoloop.mjs` (`decideSessionEndRelaunch`, `decideWake`, `backoffExceeded`, `launchHeadless`) |
| Display rules | `web/src/dashboard/loopView.ts` (`groupLoopRuns`, `displayLoopStatus`, `STALE_RUNNING_MS`), `web/src/dashboard/types.ts` |
| Driver behavior | `plugins/autoloop/skills/autoloop/SKILL.md`, `plugins/autoloop/skills/autoloop-vision/SKILL.md` |
| Design specs | `docs/superpowers/specs/2026-06-09-*.md` (ideas backlog · vision growth · independent verification · resumable loops · preview & trends · product map) |
