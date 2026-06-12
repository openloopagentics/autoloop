# Autoloop — Vision growth via auditable diffs design spec

**Date:** 2026-06-09
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** 2 of 6 in the self-evolution batch. Lets the loop **grow the vision**
(new goals, new scenarios, rubric/threshold updates) through recorded, revertable
change events instead of silent upserts — so "started from a seed and kept expanding"
becomes an auditable trail the user can veto from the dashboard.

## Goal

The product's definition — goals and scenarios — only changes today when the user
hand-edits it (web vision editing) or when the loop silently PUTs a goal/scenario with
no record of why. The self-evolving builder needs the loop to expand the vision as it
learns, and the user needs to see *that it happened, why, and what exactly changed*,
with a one-click undo.

**Steering model (user decision): autonomous with veto.** The loop applies its vision
change immediately and keeps building; the change is recorded with a `prior` snapshot,
and the user can **Reject** it later, which reverts the target to that snapshot.

## Architecture

A new **project-level append-only event**, `visionChanges`, written by a single agent
endpoint that **applies the upsert and records the change atomically** in one
transaction — capturing the `prior` state of the target in the same read that the
upsert validates against. This reuses the `applyGoalUpsert` / `applyScenarioUpsert`
inner `(tx, owner)` helpers factored out in the vision-editing sub-project, so apply
semantics (including the `visionOwner: "loop"` stamp) are identical to a plain agent
goal/scenario PUT.

Reverting is a **user** endpoint on the `/v1/u/` subtree that restores `prior` (or
deletes the target if `prior` is null) and marks the change `rejected`. Like the ideas
veto — and unlike normal web vision editing — it deliberately does **not** call
`assertWebEditable`: rejecting must work while the loop owns the vision.

No `firestore.rules` change (recursive member-read covers `visionChanges/{id}`);
rules tests only.

## Domain model

```
teams/{teamId}/projects/{slug}/
  └─ visionChanges/{changeId}   { op, targetId, payload, prior, reason,
                                  originLoopId?, status, createdAt, decidedAt? }   NEW
```

**VisionChange** — one applied (and possibly later rejected) vision edit.
- `changeId`: server-generated ULID (append-only event, like scores/testRuns).
- `op`: enum `upsert-goal | upsert-scenario`. **No deletes** — destructive vision
  edits stay a human action in the web UI (YAGNI; revisit if a real loop needs it).
- `targetId`: the goal/scenario id the op touched (`idPattern`).
- `payload`: the body that was applied (validated with the existing `goalBody` /
  `scenarioBody` zod).
- `prior`: the target's full stored fields **before** the apply, or `null` when the op
  created it. This is what Reject restores.
- `reason` (required): why the loop made this change — the learning behind it.
- `originLoopId?`: free reference to the proposing loop.
- `status`: `applied | rejected`.
- Server-stamped `createdAt`; `decidedAt` stamped when rejected.

## API

**Agent (API key)** — propose-and-apply in one call:
- `POST /v1/teams/:teamId/projects/:slug/vision-changes` — body
  `{ op, targetId, payload, reason, originLoopId? }`. In one transaction: read the
  target (capture `prior`), run the matching `applyXUpsert(tx, "loop")`, write the
  `visionChanges/{ulid}` doc with `status: "applied"`. Response
  `{ ok: true, id: <changeId> }` (event POST shape).
- Validation: payload must satisfy the same create-gates as a direct upsert (e.g. a new
  scenario needs `goalId`/`title`/rubric per the existing service rules); scenario
  payloads referencing a missing goal fail exactly as the plain upsert would.

**User (ID token, member):**
- `POST /v1/u/teams/:teamId/projects/:slug/vision-changes/:changeId/reject` — in one
  transaction: if already `rejected` ⇒ 200 (idempotent); else restore the target to
  `prior` (`null` ⇒ delete the target doc; deleting a goal that scenarios reference is
  impossible here because `op` never deletes goals with `prior: null` unless the loop
  *created* that goal — in that case its scenarios, also loop-created, were separate
  changes the user can reject too), set `status: "rejected"` + `decidedAt`.
  **No `assertWebEditable`.** Response `{ ok: true }`.

**Revert-ordering caveat (documented, accepted):** `prior` is a point-in-time snapshot.
If two applied changes touch the same target, rejecting the older one also discards the
newer one's effect on the overlapping fields. The UI mitigates by listing changes
newest-first and the loop rarely double-edits one target per run; we do not build
operational-transform machinery for this.

## Service layer

**`functions/src/services/visionChanges.ts` (NEW)** —
`applyVisionChange(teamId, slug, body)` and `rejectVisionChange(teamId, slug, changeId)`,
both transactional as above. The apply path does its own `tx.get(targetRef)` to capture
`prior` **before** dispatching on `op` to the existing inner upsert helpers in
`goals.ts` / `scenarios.ts` (already exported with the `(tx, …, owner)` shape; behavior
unchanged). The helpers re-read the target inside the same transaction — a duplicate
read is fine (Firestore transactions are snapshot-consistent and both reads precede all
writes); we deliberately do **not** refactor the helpers to accept a pre-read snapshot.
Restore-on-reject writes `prior` wholesale with `set` (no merge) so fields added by the
change are removed, then re-stamps `updatedAt`. Note `prior` round-trips Firestore
`Timestamp` values (`createdAt` etc.) through the change doc — the admin SDK handles
this, and tests cover the round-trip. Reject does **not** touch `visionOwner`: the
project stays loop-owned (the apply stamped it); nobody "helpfully" resets ownership on
reject.

## Validation (`functions/src/schemas.ts`)

```ts
export const visionChangeBody = z.object({
  op: z.enum(["upsert-goal", "upsert-scenario"]),
  targetId: id,
  payload: z.record(z.string(), z.unknown()),  // re-validated per-op in the service
  reason: z.string().min(1),
  originLoopId: id.optional(),
});
export type VisionChangeBody = z.infer<typeof visionChangeBody>;
```

The service parses `payload` with `goalBody`/`scenarioBody` per `op` (so error messages
match direct upserts).

## CLI (`autoloop`)

- `autoloop vision propose --op upsert-scenario --target <id> --file payload.json
  --reason "<why>" [--origin-loop <loopId>]` — POSTs the change (reads payload JSON
  from `--file`, like `vision import`). Project-level (no `loopSeg`).
- Two-word verb (`vision propose`) joining the existing `vision import` group. Sync
  the three CLI copies.

## Web

A **Changes feed** inside the existing Vision tab (collapsible section under the
goals/scenarios, newest first): `useVisionChanges` listener hook + `VisionChangeCard` —
op + target title, reason, relative time, `Applied`/`Rejected` chip, and a **Reject**
button (members, with a confirm) calling `rejectVisionChange(...)` in `dashboard/api.ts`.
Rejected cards render struck-through with `decidedAt`. A small "vision grew: +N
scenarios this loop" count can ride `RollupStrip` later (out of scope).

## Driver skill

New rule + Step 2e/3a addition: when a loop's learnings warrant expanding or tightening
the vision (a new scenario discovered while testing, a threshold that proved wrong, a
new goal implied by user messages), the loop MUST go through
`autoloop vision propose --reason "<the learning>"` — **never** bare
`goal`/`scenario` PUTs (those remain for `vision import` at setup). After proposing, it
continues building immediately (autonomous-with-veto); newly added scenarios join the
loop's plan as tasks tagged to them. Plugin bump; sync skill copies.

## Testing

- **API:** apply — creates goal/scenario exactly like a direct upsert (`visionOwner`
  stamped `"loop"`), records `prior: null` on create and the full prior doc on update,
  payload validation errors match direct-upsert errors, 404 on missing project/target
  goal. Reject — restores prior wholesale (added fields removed), deletes on
  `prior: null`, idempotent re-reject, member-only, works while
  `visionOwner === "loop"`. ULID ids ascend.
- **Rules:** member-read / client-write-deny on `visionChanges/{id}`.
- **CLI:** `vision propose` URL/body, `--file` parsing, missing `--reason` error.
- **Web:** feed ordering, Reject calls the API + optimistic chip flip, struck-through
  rejected render.

## Back-compat

Additive. Existing goal/scenario PUT routes are untouched (still used by
`vision import`); projects with no changes render no feed. The web vision-editing
ownership rules (`assertWebEditable`) are unchanged for normal edits.

## Out of scope

- Delete ops; multi-target batch changes; operational-transform conflict handling.
- A "proposed but not yet applied" state (the user chose autonomous-with-veto; a hard
  gate would add `status: proposed` + an apply endpoint later without schema breakage).
- Notifications on vision change (notifier extension — future).

## Success criteria

- A loop can grow the vision in one CLI call with a recorded reason; the dashboard
  shows the diff trail; the user can revert any change with one click even mid-loop.
- Rejected changes restore the exact prior state (or delete loop-created targets).
- All suites green; three CLI copies and skill copies synced; no rules change.
