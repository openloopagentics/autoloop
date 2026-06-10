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

## From plan 2 (ideas backlog)

6. **`idea list` doesn't surface rationales** — output is `[status] order id —
   title` only, but the skill's Pick step says the chosen idea's *rationale*
   seeds the loop plan, and dedup is judged from titles alone. Across session
   death the rationale is unreachable by the agent. Tiny fix: `idea list
   --json` (fetchJson default render) or append truncated rationale per line.
   Spec-level gap, not an implementation defect.
7. **`ideaIdFor` doesn't strip `_`** — `__weird__` yields a Firestore-reserved
   doc id (`__.*__`) that would 500. Extend the strip class to `[-._]+`.
8. **Missing-status band default diverges** server (band 9/last) vs web
   (proposed/band 1) — unreachable via the API; only hand-written docs.
9. **Latency-compensation flicker**: a just-added idea sorts to its band's end
   until serverTimestamp commits (web null-createdAt sorts last). Cosmetic.

## From plan 3 (vision growth)

10. **Idea-seeded vision growth at loop start** — SKILL.md's 2e bullet triggers
    on "this task's work surfaced a learning", but the ideas Pick step (loop
    start) can also imply a new goal/scenario; the general Rules entry covers
    it, but a one-line nudge in the Pick step would remove ambiguity.
11. **Unbounded feed queries** — `useVisionChanges` (like `useIdeas`/
    `useTeamNotifications`) has no `limit()`; long-lived projects load every
    change ever. Codebase-wide pattern; fix together if ever needed.
