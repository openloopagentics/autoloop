# Contract-Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four small, known gaps from prior reviews/specs: (A) ship `daloop-vision` + `daloop-loop` (+ the validator) via the curl `/skill` installer, not just the plugin; (B) have `/daloop-vision` persist the per-scenario test approach as a `test-spec` document; (C) reject empty-`criteria` scores; (D) document the notifier's non-transactional read-modify-write.

**Architecture:** A is shell + file-distribution (sync script, `web/public/skill/`, `install.sh`) + a context-agnostic validator-path line in the vision skill. C is a one-line zod `.refine` + a test. B and D are doc/comment edits. No new deps; bundles into the pending #6/#7 deploy (hosting carries the curl-installer files; functions carries C).

**Tech Stack:** bash, Markdown skill docs, zod (`functions/src/schemas.ts`), Vitest.

**Reference:** prior review notes (#1 Task 10 empty-criteria; #6 concurrency) and the #2/#3 spec deferrals (`docs/superpowers/specs/2026-06-03-vision-loop-skills-design.md` "Out of scope").

---

## Background / conventions
- The plugin already ships `daloop-vision`/`daloop-loop` + `bin/vision-schema.mjs` (auto-updating). The **curl installer** (`web/public/skill/install.sh`, fetched from `https://daloop-42b47.web.app/skill/...`) currently ships ONLY `daloop-reporting` (SKILL.md, CODEX.md, daloop.mjs) into `~/.claude/skills/daloop-reporting/`.
- `scripts/sync-daloop-cli.sh` copies canonical files into the plugin + `web/public/skill/`. Skill SKILL.md files are NOT synced today (they live only under `plugins/...`).
- `daloop-vision/SKILL.md:50` hardcodes `node "${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs"` — `${CLAUDE_PLUGIN_ROOT}` only exists in the plugin runtime, so a curl-installed copy needs a context-agnostic instruction.
- Commands: `cd functions && npm test` / `npm run build`; `bash scripts/sync-daloop-cli.sh`. Do NOT `git add -A`.

---

## Task A1: Make the vision skill's validator reference context-agnostic

**Files:** Modify `plugins/daloop-reporting/skills/daloop-vision/SKILL.md`.

- [ ] **Step 1** — replace the validator line (currently `…run the bundled validator: \`node "${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs" vision.json\`.`) with a context-agnostic instruction:

```
   bundled validator: run `node <vision-schema.mjs> vision.json`, where the validator is
   at `${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs` when installed as a plugin, or
   alongside this skill (`vision-schema.mjs` in the skill's own directory) when installed
   via the curl `/skill` installer. If it isn't found, validate the fields manually
   against the rules above before writing.
```

- [ ] **Step 2: Commit** — `git add plugins/daloop-reporting/skills/daloop-vision/SKILL.md && git commit -m "docs(skill): context-agnostic vision-schema validator path (plugin or curl install)"`.

---

## Task A2: Sync the two skills + validator into web/public/skill, and extend install.sh

**Files:** Modify `scripts/sync-daloop-cli.sh`, `web/public/skill/install.sh`; generated copies under `web/public/skill/`.

- [ ] **Step 1: Extend `scripts/sync-daloop-cli.sh`** — after the existing copies, also stage the new skills + validator for the curl installer:

```bash
# vision + loop skills for the curl installer (plugin already bundles them)
mkdir -p web/public/skill/daloop-vision web/public/skill/daloop-loop
cp plugins/daloop-reporting/skills/daloop-vision/SKILL.md web/public/skill/daloop-vision/SKILL.md
cp plugins/daloop-reporting/skills/daloop-loop/SKILL.md   web/public/skill/daloop-loop/SKILL.md
cp cli/vision-schema.mjs web/public/skill/vision-schema.mjs
```
Update the script's echo to mention the new copies.

- [ ] **Step 2: Update `web/public/skill/install.sh`** — install the two new skills + the validator alongside the reporting skill. The current script installs `daloop-reporting` (SKILL.md, CODEX.md, daloop.mjs) into `$HOME/.claude/skills/daloop-reporting/`. Extend it to also:
  - download `daloop-vision/SKILL.md` → `$HOME/.claude/skills/daloop-vision/SKILL.md` and `vision-schema.mjs` → `$HOME/.claude/skills/daloop-vision/vision-schema.mjs` (so the context-agnostic "alongside this skill" path resolves);
  - download `daloop-loop/SKILL.md` → `$HOME/.claude/skills/daloop-loop/SKILL.md`;
  - keep the existing reporting-skill install + the Node-version check + the final hints (add a line noting the three skills now install).
  Keep `set -euo pipefail` and the existing `BASE`/`curl -fsSL` idiom. Base paths: `$BASE/daloop-vision/SKILL.md`, `$BASE/daloop-loop/SKILL.md`, `$BASE/vision-schema.mjs`.

- [ ] **Step 3: Run the sync** — `bash scripts/sync-daloop-cli.sh`. Verify the files exist:
  `ls web/public/skill/daloop-vision/SKILL.md web/public/skill/daloop-loop/SKILL.md web/public/skill/vision-schema.mjs` and `diff cli/vision-schema.mjs web/public/skill/vision-schema.mjs && echo IDENTICAL`.

- [ ] **Step 4: Commit** — `git add scripts/sync-daloop-cli.sh web/public/skill/ && git commit -m "feat(skill): curl /skill installer ships daloop-vision + daloop-loop + validator"`.

---

## Task B: `/daloop-vision` persists a `test-spec` document

**Files:** Modify `plugins/daloop-reporting/skills/daloop-vision/SKILL.md` (and re-sync to web).

- [ ] **Step 1** — in the Process section (after the validate/write/import steps), add a short instruction: when a scenario has a non-trivial test approach (a command or a described procedure), optionally persist it as a Document of `kind: "test-spec"` — e.g. `daloop doc add --kind test-spec --title "<scenario> tests" --file <notes.md>` (or `--url`) — so the loop and the dashboard have the test definition. Keep it one short paragraph; note it's optional and that the loop reads it.

- [ ] **Step 2: Re-sync** (so the curl copy matches) — `bash scripts/sync-daloop-cli.sh`.

- [ ] **Step 3: Commit** — `git add plugins/daloop-reporting/skills/daloop-vision/SKILL.md web/public/skill/daloop-vision/SKILL.md && git commit -m "docs(skill): daloop-vision can persist a test-spec document"`.

---

## Task C: Reject empty-`criteria` scores

**Files:** Modify `functions/src/schemas.ts`; Test `functions/test/schemas.test.ts`.

- [ ] **Step 1: Write the failing test** (append to the loop-contract schemas describe in `functions/test/schemas.test.ts`)

```typescript
  it("rejects a score with empty criteria", () => {
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: {}, composite: 80 }).success).toBe(false);
    expect(scoreBody.safeParse({ scenarioId: "s1", taskId: "t1", criteria: { c1: 3 }, composite: 80 }).success).toBe(true);
  });
```

- [ ] **Step 2: Run → fail** — `cd functions && npm run test:run -- schemas`.

- [ ] **Step 3: Implement** — in `functions/src/schemas.ts`, change `scoreBody.criteria` to require ≥1 key:

```typescript
  criteria: z.record(z.string(), z.number().int().min(0)).refine((c) => Object.keys(c).length > 0, "criteria must not be empty"),
```

- [ ] **Step 4: Run → pass** — `cd functions && npm run test:run -- schemas`; then `npm test` (full) to confirm no existing score test regressed (they all send non-empty criteria).

- [ ] **Step 5: Commit** — `git add functions/src/schemas.ts functions/test/schemas.test.ts && git commit -m "fix(api): reject score events with empty criteria"`.

---

## Task D: Notifier concurrency comment

**Files:** Modify `functions/src/notify/notifier.ts`.

- [ ] **Step 1** — add a one-line comment above the `lastNotifiedState` read (top of `processScenarioEvent`) noting the non-transactional read-modify-write:

```typescript
  // NOTE: this read-modify-write of lastNotifiedState is retry-safe (a retry re-reads the
  // updated state and no-ops) but NOT concurrency-safe; per-scenario scores are written
  // serially today, so concurrent double-notify is not a concern. Wrap in a transaction
  // if concurrent scoring is ever introduced.
```

- [ ] **Step 2: Build** — `cd functions && npm run build` (clean; comment-only).
- [ ] **Step 3: Commit** — `git add functions/src/notify/notifier.ts && git commit -m "docs(api): note notifier read-modify-write is retry-safe not concurrency-safe"`.

---

## Task E: Verification

- [ ] `cd functions && npm test` (green, incl. the new empty-criteria test) ; `npm run build` clean ; `npm run test:rules` green.
- [ ] `cd web && npm run build` clean (the curl-installer files are static assets; no web tests touch them).
- [ ] Confirm: `web/public/skill/` contains daloop-vision/SKILL.md, daloop-loop/SKILL.md, vision-schema.mjs; install.sh fetches all three skills; `cli/vision-schema.mjs` == `web/public/skill/vision-schema.mjs`; scoreBody rejects empty criteria; notifier has the concurrency note.
- [ ] **Deploy (bundled with #6/#7): functions + firestore:rules + hosting.**

---

## Notes for the executor
- Item A's value is curl-installer parity; the plugin remains the primary auto-updating channel. The validator-path line MUST work in both contexts (don't hardcode `${CLAUDE_PLUGIN_ROOT}` as the only path).
- Re-run `scripts/sync-daloop-cli.sh` after ANY edit to a skill SKILL.md so the plugin and web/public/skill copies stay in step (Task B especially).
- Item C: confirm no existing score test sends empty criteria (they don't) before/after adding the refine.
- No new deps. Do NOT `git add -A`.
