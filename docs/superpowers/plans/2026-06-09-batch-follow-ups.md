# Self-evolution batch — accumulated fast-follow items

Non-blocking findings from per-plan final reviews. Each is deliberate scope
(documented in its plan/spec) or inherited pattern — captured here so they
aren't lost when the batch ships.

## From plan 1 (independent verification)

1. **Tests tab lacks verification badges.** `web/src/dashboard/tabs/TestsTab.tsx`
   renders per-scenario runs (from `useAllTestRuns`) without the
   Verified/Refuted layer. Companion to #2.
2. **Cross-loop Vision badges.** Vision tab's test-runs are cross-loop
   (`useAllTestRuns`) but verifications are selected-loop scope — a
   verification in another loop won't badge. Fix = `useAllVerifications`
   aggregator (spec deliberately excluded it).
3. **Web-initiated project close never sweeps.** `routes/userProjects.ts`
   discards `applyProjectUpsert`'s terminal-transition return; a *web-owned*
   project with agent-written project-direct phases/tasks closed from the
   dashboard leaves them unswept. Agent path is the documented sole trigger.
4. **Legacy `upsertPhase` doesn't stamp `visionOwner: "loop"`** (unlike
   `upsertTask`), so a phases-only project-direct project stays web-editable;
   web terminal-close then skips the sweep (cosmetic stale `currentPhaseId`).
   One-line consistency fix candidate.
5. **CLI bare-flag leniency on `--summary`/`--task`** (verify + the
   pre-existing score/test-run pattern): bare flags leak booleans to the
   server (400) instead of a local UsageError. Inherited inconsistency.
