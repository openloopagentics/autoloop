# Autoloop — Independent verification + deterministic backstop design spec

**Date:** 2026-06-09
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** 3 of 6 in the self-evolution batch. Closes the two integrity gaps in
the loop: (a) task/phase statuses depend on the LLM remembering SKILL.md prose — build
the **deterministic server backstop** agreed during the task-status-hygiene incident;
(b) scores and pass/fail counts are self-reported by the same agent that wrote the
code — add an independent **verifier** pass (clean-context subagent replaying the
recorded test commands) recorded as a new append-only `verification` event, surfaced as
a Verified badge in the UI.

## Goal

Trust, but verify. The dashboard should distinguish "the building agent says the test
passes" from "an independent replay confirmed it", and a closed loop should never leave
tasks dangling `running` regardless of what the driver forgot.

**Mechanism (user decision): verifier subagent** — dispatched by the driver with a
clean context; replays each scenario's recorded test command. CI replay (GitHub
Actions) is explicitly future work, not in this spec.

## Architecture

Two independent parts:

1. **Backstop (server, deterministic).** When a loop transitions to a terminal status
   (`completed | failed | cancelled` — `isTerminal` in `status.ts`), the loops service
   sweeps that loop's phases and tasks and sets every non-terminal one to the **same
   terminal status as the loop**. Honest semantics: a completed loop's leftover
   `running`/`queued` tasks become `completed`; a cancelled loop's become `cancelled`.
   This exactly covers the real incident (driver closed the loop, forgot per-task
   closes) without inventing per-task truth the server doesn't have.
2. **Verification (new append-only event).** `verifications` joins
   `scores`/`testRuns`/`revisions` as base-path-aware run data: server-ULID id, append
   POST, loop-scoped or project-direct via `resolveBase`. A verification points at the
   test-run it replayed (`testRunId`) and carries a `verdict`. **The met-state
   derivation is unchanged** (back-compat; verification is evidence, not a gate) — the
   UI adds a badge layer on top.

No `firestore.rules` change; rules tests only.

## Domain model

```
loops/{loopId}            (or project-direct = main loop)
  └─ verifications/{ulid}   { scenarioId, taskId?, testRunId, verdict,
                              summary?, by, createdAt }   NEW
```

- `scenarioId` (required): the scenario whose evidence was replayed (free reference,
  unvalidated — same rationale as `testRun`'s; format `idPattern`-checked).
- `taskId?`: free reference.
- `testRunId` (required): the ULID of the test-run whose recorded command was replayed.
  Free reference (not existence-checked: same loop-write trust model as every event).
- `verdict` (required): enum `confirmed | refuted`.
- `summary?`: the replayed command + actual observed output/counts (capped at the
  shared 100KB like `testRun.summary`).
- `by`: defaults `"verifier"` (string, like `score.by`).
- Server-stamped `createdAt`; id is a server ULID.

## API

- `POST /v1/teams/:teamId/projects/:slug/verifications` and
  `POST …/loops/:loopId/verifications` (same router via `mergeParams`, mounted with the
  other event mounts). Response `{ ok: true, id }`.

**Backstop** rides the existing `PUT …/loops/:loopId` — no new route.

## Service layer

**`events.ts`** — `appendVerification(teamId, slug, body, loopId?)`: `resolveBase`,
ULID id, conditional `summary`/`taskId` keys, no transaction (append-only, no derived
fields).

**`loops.ts`** — in `upsertLoop`, when the write transitions the loop **into** a
terminal status (was non-terminal or absent-status before, terminal after — compare
inside the existing read; the transition flag must be carried **out** of the
transaction, since the sweep runs after it and `upsertLoop` currently returns `void`):
after the loop merge-set, query the loop's `phases` and `tasks` collections, and for
each doc with a non-terminal `status`, batch-update `status` to the loop's terminal
status, stamping `updatedAt` (and `endedAt` on **phases only** — tasks have no
`endedAt` field; reuse the phase service's stamping helper rather than duplicating it).
Implementation notes:
- **The sweep also nulls the derived pointers**: set `currentPhaseId` and
  `currentTaskId` to `null` on the loop doc (and on the project doc for the
  project-direct variant below). The well-behaved close path ends with both pointers
  null via the per-task/phase recomputes in `derive.ts`; the sweep must land in the
  same end state, otherwise `LoopSnapshot`/`PlanSection`/`ProjectCard` keep rendering
  a now-terminal task/phase as current — the very symptom the backstop exists to kill.
- Runs **after** the loop doc write, as a best-effort batched sweep (batches of ≤500);
  the loop close itself never fails because the sweep failed — log and continue
  (consistent with the API's write-only, agent-trusting posture).
- Sweep applies to the loop's own subcollections only. For the implicit `main` loop
  (project-direct data) the sweep triggers on **project** terminal transition instead —
  same logic hung off `upsertProject` for project-direct phases/tasks. (This keeps
  legacy single-loop projects covered.) `upsertProject` is the only hook needed: the
  web's user project route cannot terminal-close a loop-owned project
  (`assertWebEditable` blocks it), so the agent PUT path is the sole writer that can
  trigger the project-direct sweep.
- Idempotent: re-PUTting `completed` finds nothing non-terminal and writes nothing
  (and the pointers are already null).

## Validation (`functions/src/schemas.ts`)

```ts
export const verificationBody = z.object({
  scenarioId: id,
  taskId: id.optional(),
  testRunId: z.string().min(1),          // server ULIDs are uppercase — NOT idPattern
  verdict: z.enum(["confirmed", "refuted"]),
  summary: z.string().max(CONTENT_MAX_BYTES, "verification.summary exceeds 100KB").optional(),
  by: z.string().min(1).optional(),
});
export type VerificationBody = z.infer<typeof verificationBody>;
```

(`testRunId` deliberately escapes `idPattern` — the same lesson as `messages ack`:
ULIDs are uppercase.)

## CLI (`autoloop`)

- `autoloop verify <scenarioId> --test-run <testRunId> --verdict confirmed|refuted
  [--task <taskId>] [--summary "<cmd + actual result>"|--summary-file <p>]` — POST,
  loop-aware via `loopSeg`. One-word verb (`verify`), like `score`/`test-run`.
- Sync the three CLI copies.

## Web

- `useVerifications` loop-aware hook (like `useTestRuns`).
- Pure `verificationView.ts`: `verdictForTestRun(testRunId, verifications)` →
  `confirmed | refuted | undefined` (latest verification for that run wins, by id
  order), and `scenarioVerification(scenarioId, latestTestRunId, verifications)` for
  the scenario-level badge.
- **Badges:** `TestRunsSection` rows get ✓ Verified / ✗ Refuted (nothing when
  unverified); `ScenarioCard`/`ScenarioTable` show a small ✓ when the scenario's
  *latest* test-run is confirmed, ⚠ Unverified otherwise, ✗ when refuted. Met-state
  text/derivation (`scenarioState.ts`) unchanged.

## Driver skill

Extend **Step 3a (scenario verification sweep)**:
1. Collect each loop-scenario's latest test-run id + its recorded command/file/test
   names (mandatory in summaries since driver-hygiene).
2. Dispatch **one verifier subagent** — clean context, prompt contains ONLY the list of
   `{scenarioId, testRunId, command, expected pass/fail}` plus repo access. It replays
   each command and reports actual counts per scenario. It does not see the
   implementation conversation and calls no `autoloop` commands.
3. For each scenario the driver submits `autoloop verify <scenarioId> --test-run <id>
   --verdict … --summary "<cmd> → <actual>"`. A `refuted` verdict means the scenario is
   **unmet** regardless of its score — record a revision (existing unmet path) and do
   not count it met in the closing summary.
4. New Rule: "**Verification is independent.** The verifier subagent never implements
   code and the implementer never verifies; refuted = unmet."

Plugin bump; sync skill copies.

## Testing

- **API:** verification append (project-direct + loop-scoped, 404 on missing
  loop/project), verdict enum rejection, uppercase `testRunId` accepted, conditional
  `summary` key absent when omitted. Backstop: closing a loop completes its
  `running`/`queued`/`blocked`/`paused` phases+tasks with the loop's terminal status,
  stamps `updatedAt` (and `endedAt` on phases only), **nulls the loop's
  `currentPhaseId`/`currentTaskId`** (project's, for project-direct), leaves
  already-terminal docs byte-stable (`failed` task under a `completed` loop stays
  `failed`), idempotent re-close, cancelled→cancelled mapping; project-terminal sweep
  covers project-direct data; non-terminal loop writes sweep nothing.
- **Rules:** member-read / client-write-deny on both verification paths.
- **CLI:** `verify` URL/body construction, loop-aware, `--summary-file`.
- **Web:** `verificationView` verdict resolution (latest wins), badges render per
  verdict, scenarioState snapshots unchanged.

## Back-compat

Additive routes/collections; loops that never verify look exactly like today
(badge absent). The backstop changes observable behavior **only** for loops closed with
dangling non-terminal tasks — which is precisely the defect class, and matches the
skill's existing mandatory reconciliation sweep (now guaranteed server-side).

## Out of scope

- CI replay (GitHub Actions posting verifications with an API key) — future; the event
  shape already supports it (`by: "ci"`).
- Gating met-state on verification (would change derived semantics; revisit once
  verification coverage is routine).
- Verifying scores/rubric judgments (only test-runs are mechanically replayable).

## Success criteria

- Closing a loop can no longer leave its tasks/phases non-terminal (tested).
- A verifier replay lands as a `verification` event; the dashboard shows
  Verified/Unverified/Refuted on test-runs and scenarios; met-state semantics
  unchanged.
- All suites green; three CLI copies + skill copies synced; no rules change.
