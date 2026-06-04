# Vision-authoring + Loop-driver Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two Claude Code skills that make autoloop's vision-driven loop usable without hand-driving CLI verbs: `/autoloop-vision` (interview → validated `vision.json`) and `/autoloop-loop` (orchestrate the self-evaluating build loop), both in the existing `autoloop-reporting` plugin.

**Architecture:** One dependency-free validator module (`cli/vision-schema.mjs`) guards the `vision.json` interface and is the only unit-tested code. The two skills are `SKILL.md` instruction docs: `/autoloop-vision` authors the vision and validates it before writing/importing; `/autoloop-loop` composes `superpowers:writing-plans` + `superpowers:subagent-driven-development` as its engine and adds a thin vision layer (test → score → evaluate → revise → terminate) that reports through the autoloop CLI verbs shipped in sub-project #1. All reporting is best-effort.

**Tech Stack:** Node 22 ESM (validator, no deps); Vitest + the existing `functions/` harness for the validator's unit tests; Markdown skill docs discovered by Claude Code from the plugin's `skills/` dir; the autoloop CLI (`cli/autoloop.mjs`) verbs from sub-project #1.

**Reference spec:** `docs/superpowers/specs/2026-06-02-vision-loop-skills-design.md`
**Consumes (unchanged):** the merged loop contract — `cli/autoloop.mjs` verbs (`init`, `project set`, `vision import`, `phase start`, `task start`/`task set`, `commit [--task]`, `score`, `test-run`, `revise`) and the zod schemas in `functions/src/schemas.ts`.

---

## Background / conventions (read before Task 1)

- **Plugin layout:** skills live at `plugins/autoloop-reporting/skills/<skill-name>/SKILL.md` and are **auto-discovered** by Claude Code (the existing `autoloop-reporting` skill is not listed in `plugin.json` — no manifest registration is needed for discovery). `${CLAUDE_PLUGIN_ROOT}` resolves to `plugins/autoloop-reporting/` at runtime, so bundled binaries are referenced as `${CLAUDE_PLUGIN_ROOT}/bin/<file>`.
- **Canonical-source + sync pattern:** the CLI's canonical source is `cli/autoloop.mjs`; `scripts/sync-autoloop-cli.sh` copies it to `plugins/autoloop-reporting/bin/autoloop` and `web/public/skill/autoloop.mjs`. The new validator follows the same pattern: canonical at `cli/vision-schema.mjs`, synced to `plugins/autoloop-reporting/bin/vision-schema.mjs`.
- **SKILL.md frontmatter** (mirror the existing one at `plugins/autoloop-reporting/skills/autoloop-reporting/SKILL.md`):
  ```
  ---
  name: <skill-name>
  description: <when to use — triggers>
  ---
  ```
- **CLI verb shapes the skills must emit (from sub-project #1 — exact):**
  - `autoloop init --team <t> --project <slug>`
  - `autoloop project set --title "<t>" --status running [--design-file <path>|--design-url <url>]`
  - `autoloop vision import --file vision.json`
  - `autoloop phase start <id> --name "<n>" --order <k>` (— `--name` and `--order` REQUIRED)
  - `autoloop task start <id> --phase <p> --name "<n>" --order <k> --scenarios a,b` (`--name`/`--order` REQUIRED)
  - `autoloop task set <id> --status completed`
  - `autoloop commit [--task <id>]`
  - `autoloop score <scenarioId> --task <t> --criterion id=val [--criterion ...] --composite <0..100> [--commit <sha>] [--note "..."]`
  - `autoloop test-run <scenarioId> --task <t> --passed <n> --failed <m> [--issue "..." ...]`
  - `autoloop revise --scenario <s> --reason "..." --change op:<taskId> [--change ...]` (op ∈ add|replace|reorder|drop)
- **Status enum:** `queued|running|blocked|paused|completed|failed|cancelled`. IDs match `^[a-z0-9._-]+$`.
- **Best-effort:** the CLI exits 0 on a reporting failure (warns) unless `--strict`/`AUTOLOOP_STRICT=1`. The loop notes the warning and continues — reporting never blocks dev work.
- **Commands:** validator unit tests run standalone (no emulator): `cd functions && npm run test:run -- vision-schema`. Full suite stays green: `cd functions && npm test`. Do NOT `git add -A` (pre-existing untracked `.DS_Store`/`prototype/`).
- Skills are Markdown instructions, not executable code — they are validated by structure (valid frontmatter, real verbs, a worked dry-run) + review, not unit tests. Only `cli/vision-schema.mjs` is unit-tested.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `cli/vision-schema.mjs` | `validateVision(obj)` (field rules + dangling-goalId check), `stripForImport(scenario)` (drop loop-local `test`), and a CLI entry (`node vision-schema.mjs <file>`) | 1 |
| `functions/test/vision-schema.test.ts` | Vitest unit tests for the validator (valid + each failure mode + stripForImport) | 1 |
| `scripts/sync-autoloop-cli.sh` | extend to also sync `cli/vision-schema.mjs` → plugin `bin/` | 2 |
| `plugins/autoloop-reporting/bin/vision-schema.mjs` | synced copy (generated by the sync script) | 2 |
| `plugins/autoloop-reporting/skills/autoloop-vision/SKILL.md` | the vision-authoring skill | 3 |
| `plugins/autoloop-reporting/skills/autoloop-loop/SKILL.md` | the loop-driver skill | 4 |
| `plugins/autoloop-reporting/README.md`, `plugins/autoloop-reporting/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | register/describe the two new skills; bump plugin version | 5 |
| — (verification only) | validator tests + full suite + structural checks green | 6 |

---

## Task 1: `vision.json` validator + unit tests

**Files:**
- Create: `cli/vision-schema.mjs`
- Test: `functions/test/vision-schema.test.ts`

- [ ] **Step 1: Write the failing test** (`functions/test/vision-schema.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
// @ts-ignore - untyped .mjs imported for runtime test
import { validateVision, stripForImport } from "../../cli/vision-schema.mjs";

const goodCriterion = { id: "correctness", name: "Correctness", weight: 3, max: 5 };
const goodVision = {
  goals: [{ id: "g1", title: "Sign in", order: 1 }],
  scenarios: [{
    id: "login-works", goalId: "g1", title: "Login succeeds", order: 1, threshold: 80,
    rubric: { criteria: [goodCriterion] }, test: { command: "npm test -- login" },
  }],
  documents: [{ id: "vision", kind: "vision", title: "V", format: "markdown", content: "# V" }],
};

describe("validateVision", () => {
  it("accepts a well-formed vision", () => {
    expect(validateVision(goodVision)).toEqual({ ok: true });
  });
  it("rejects a scenario whose goalId has no matching goal", () => {
    const v = { ...goodVision, scenarios: [{ ...goodVision.scenarios[0], goalId: "ghost" }] };
    const r = validateVision(v);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/goalId 'ghost' has no matching goal/);
  });
  it("rejects bad ids, empty rubric, weight<=0, max<1, threshold>100, bad format", () => {
    expect(validateVision({ goals: [{ id: "Bad Id", title: "x" }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", rubric: { criteria: [] } }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", rubric: { criteria: [{ id: "c", name: "C", weight: 0, max: 5 }] } }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", rubric: { criteria: [{ id: "c", name: "C", weight: 1, max: 0 }] } }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", threshold: 150, rubric: { criteria: [goodCriterion] } }] }).ok).toBe(false);
    expect(validateVision({ documents: [{ id: "d1", kind: "k", title: "t", format: "pdf", content: "x" }] }).ok).toBe(false);
  });
  it("requires a string test.command when test is present", () => {
    const v = { ...goodVision, scenarios: [{ ...goodVision.scenarios[0], test: { command: 5 } }] };
    expect(validateVision(v).ok).toBe(false);
  });
  it("rejects a non-integer order (zod requires int)", () => {
    expect(validateVision({ goals: [{ id: "g1", title: "x", order: 1.5 }] }).ok).toBe(false);
    expect(validateVision({ goals: [{ id: "g1", title: "x" }], scenarios: [{ id: "s1", goalId: "g1", title: "t", order: "1", rubric: { criteria: [goodCriterion] } }] }).ok).toBe(false);
  });
  it("treats missing goals/scenarios/documents as empty (valid)", () => {
    expect(validateVision({})).toEqual({ ok: true });
  });
});

describe("stripForImport", () => {
  it("drops the loop-local `test` field, keeps the rest", () => {
    const out = stripForImport(goodVision.scenarios[0]);
    expect(out.test).toBeUndefined();
    expect(out).toMatchObject({ id: "login-works", goalId: "g1", rubric: { criteria: [goodCriterion] } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run test:run -- vision-schema`
Expected: FAIL — cannot find module `../../cli/vision-schema.mjs`.

- [ ] **Step 3: Write the implementation** (`cli/vision-schema.mjs`)

```javascript
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ID_RE = /^[a-z0-9._-]+$/;
const isId = (v) => typeof v === "string" && ID_RE.test(v);
const nonEmpty = (v) => typeof v === "string" && v.length > 0;

/**
 * Validate a vision.json object against the loop-contract field rules (+ a
 * dangling-goalId cross-check). Returns { ok: true } or { ok: false, errors: [...] }.
 * Missing goals/scenarios/documents are treated as empty arrays (a partial vision is valid).
 */
export function validateVision(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, errors: ["vision must be an object"] };
  const errors = [];
  const goals = v.goals ?? [];
  const scenarios = v.scenarios ?? [];
  const documents = v.documents ?? [];
  if (!Array.isArray(goals)) errors.push("goals must be an array");
  if (!Array.isArray(scenarios)) errors.push("scenarios must be an array");
  if (!Array.isArray(documents)) errors.push("documents must be an array");
  if (errors.length) return { ok: false, errors };

  const intOk = (n) => Number.isInteger(n);
  const goalIds = new Set();
  goals.forEach((g, i) => {
    if (!isId(g?.id)) errors.push(`goals[${i}].id must match ${ID_RE}`);
    else goalIds.add(g.id);
    if (!nonEmpty(g?.title)) errors.push(`goals[${i}].title is required`);
    if (g?.order !== undefined && !intOk(g.order)) errors.push(`goals[${i}].order must be an integer`);
  });

  scenarios.forEach((s, i) => {
    if (!isId(s?.id)) errors.push(`scenarios[${i}].id must match ${ID_RE}`);
    if (!isId(s?.goalId)) errors.push(`scenarios[${i}].goalId must match ${ID_RE}`);
    else if (!goalIds.has(s.goalId)) errors.push(`scenarios[${i}].goalId '${s.goalId}' has no matching goal`);
    if (!nonEmpty(s?.title)) errors.push(`scenarios[${i}].title is required`);
    if (s?.order !== undefined && !intOk(s.order)) errors.push(`scenarios[${i}].order must be an integer`);
    if (s?.threshold !== undefined && !(typeof s.threshold === "number" && s.threshold >= 0 && s.threshold <= 100))
      errors.push(`scenarios[${i}].threshold must be a number 0..100`);
    const crit = s?.rubric?.criteria;
    if (!Array.isArray(crit) || crit.length === 0) errors.push(`scenarios[${i}].rubric.criteria must be a non-empty array`);
    else crit.forEach((c, j) => {
      const at = `scenarios[${i}].rubric.criteria[${j}]`;
      if (!isId(c?.id)) errors.push(`${at}.id must match ${ID_RE}`);
      if (!nonEmpty(c?.name)) errors.push(`${at}.name is required`);
      if (!(typeof c?.weight === "number" && c.weight > 0)) errors.push(`${at}.weight must be > 0`);
      if (!(Number.isInteger(c?.max) && c.max >= 1)) errors.push(`${at}.max must be an integer >= 1`);
    });
    if (s?.test !== undefined) {
      if (typeof s.test !== "object" || s.test === null || (s.test.command !== undefined && typeof s.test.command !== "string"))
        errors.push(`scenarios[${i}].test.command must be a string`);
    }
  });

  documents.forEach((d, i) => {
    if (!isId(d?.id)) errors.push(`documents[${i}].id must match ${ID_RE}`);
    if (!nonEmpty(d?.kind)) errors.push(`documents[${i}].kind is required`);
    if (!nonEmpty(d?.title)) errors.push(`documents[${i}].title is required`);
    if (d?.format !== "markdown" && d?.format !== "url") errors.push(`documents[${i}].format must be markdown|url`);
    if (typeof d?.content !== "string") errors.push(`documents[${i}].content is required`);
  });

  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Return an import-safe scenario: the loop-local `test` field removed. */
export function stripForImport(scenario) {
  const { test, ...rest } = scenario;
  return rest;
}

// CLI entry: `node vision-schema.mjs <vision.json>` → prints OK or the errors; exit 0/1.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error("usage: vision-schema.mjs <vision.json>"); process.exit(1); }
  let obj;
  try { obj = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { console.error(`could not read/parse ${file}: ${e.message}`); process.exit(1); }
  const r = validateVision(obj);
  if (r.ok) { console.log(`✓ ${file} is a valid vision`); process.exit(0); }
  console.error(`✗ ${file} has ${r.errors.length} problem(s):`);
  for (const e of r.errors) console.error(`  - ${e}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npm run test:run -- vision-schema`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/vision-schema.mjs functions/test/vision-schema.test.ts
git commit -m "feat(cli): vision.json schema validator (validateVision + stripForImport)"
```

---

## Task 2: Sync the validator into the plugin

**Files:**
- Modify: `scripts/sync-autoloop-cli.sh`
- Generated: `plugins/autoloop-reporting/bin/vision-schema.mjs`

- [ ] **Step 1: Extend the sync script** (`scripts/sync-autoloop-cli.sh`)

Read the current script first. It copies `cli/autoloop.mjs` to two destinations. Add the validator copy alongside the existing `autoloop` copies (canonical → plugin bin only; the validator is not part of the curl installer per the spec). After the existing `cp cli/autoloop.mjs plugins/autoloop-reporting/bin/autoloop` line, add:

```bash
cp cli/vision-schema.mjs plugins/autoloop-reporting/bin/vision-schema.mjs
chmod +x plugins/autoloop-reporting/bin/vision-schema.mjs
```

Update the script's final echo to mention the validator copy too.

- [ ] **Step 2: Run the sync**

Run: `bash scripts/sync-autoloop-cli.sh`
Expected: success message; `plugins/autoloop-reporting/bin/vision-schema.mjs` now exists.

- [ ] **Step 3: Verify byte-identical**

Run: `diff cli/vision-schema.mjs plugins/autoloop-reporting/bin/vision-schema.mjs && echo IDENTICAL`
Expected: `IDENTICAL`.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-autoloop-cli.sh plugins/autoloop-reporting/bin/vision-schema.mjs
git commit -m "build: sync vision-schema validator into the autoloop-reporting plugin"
```

---

## Task 3: `/autoloop-vision` skill

**Files:**
- Create: `plugins/autoloop-reporting/skills/autoloop-vision/SKILL.md`

- [ ] **Step 1: Write the skill** (`plugins/autoloop-reporting/skills/autoloop-vision/SKILL.md`)

```markdown
---
name: autoloop-vision
description: Use to author or extend a project's Autoloop vision — interview the user to produce a validated vision.json (goals, scenarios, scoring rubrics, optional per-scenario test commands). Trigger when the user wants to define what "done" means for a vision-driven loop, set up scenarios/rubrics, or says "author a vision", "/autoloop-vision", or "set up the loop's goals".
---

# Autoloop Vision Authoring

Interview the user to produce a **`vision.json`** — the goals, scenarios, scoring
rubrics, and (optional) per-scenario test commands that the `/autoloop-loop` driver
later builds toward and scores against.

## Output: vision.json

Write `vision.json` in the loop's working directory. Shape (validated before writing):

\```jsonc
{
  "goals":     [{ "id": "g1", "title": "...", "description": "...", "order": 1 }],
  "scenarios": [{
    "id": "login-works", "goalId": "g1", "title": "...", "description": "...",
    "order": 1, "threshold": 80,
    "rubric": { "criteria": [{ "id": "correctness", "name": "Correctness", "weight": 3, "max": 5 }] },
    "test": { "command": "npm test -- login" }   // optional; omit → the loop AI-judges it
  }],
  "documents": [{ "id": "vision", "kind": "vision", "title": "Vision", "format": "markdown", "content": "..." }]
}
\```

- ids match `^[a-z0-9._-]+$` (lowercase kebab/dot/underscore, no spaces).
- every `scenario.goalId` must reference a defined goal.
- rubric `criteria` non-empty; each `{ id, name, weight>0, max≥1 (integer) }`.
- `threshold` optional, `0..100` (global default 80). `document.format` ∈ `markdown|url`.

## Process

1. **Load or start fresh.** If `vision.json` exists in the cwd, read it and offer to
   extend; otherwise start a new one.
2. **Interview one topic at a time** (don't dump a form):
   - Elicit the **goals** (high-level outcomes), in priority order.
   - For each goal, its **scenarios** (the acceptance units — concrete, testable
     "this works" statements).
   - For each scenario: a one-line description; the **rubric criteria** (name +
     integer `max` + relative `weight`); an optional **threshold**; and a **test**:
     ask for a shell command that verifies it (e.g. `npm test -- login`) or "let the
     loop AI-judge it" (then omit `test`).
   - Prefer the user's own words for titles/descriptions. Assign stable kebab-case ids.
3. **Validate before writing.** Run the bundled validator on your assembled object:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs" vision.json` (write a temp file
   or your candidate first). If it reports problems, fix them with the user — **never
   write an invalid vision.json**.
4. **Write** `vision.json` to the cwd.
5. **Offer to push it:** `autoloop vision import --file vision.json` (best-effort).
   Requires `AUTOLOOP_API_KEY` in the env and an initialised `.autoloop.json`. If the dir
   isn't initialised, point the user to `autoloop init --team <t> --project <slug>`
   (and the API-keys page to mint a key). The loop-local `scenario.test` field is
   stripped automatically by import handling — it stays in your local vision.json.

## Boundaries

- You author the **what** (the vision). You do NOT generate the plan, write code, run
  tests, or score anything — that is `/autoloop-loop`'s job. When the vision is ready,
  tell the user they can run `/autoloop-loop` to build toward it.
- Keep scenarios concrete and few; a good first vision is 1–3 goals with 1–3 scenarios
  each. Resist inventing criteria the user didn't ask for (YAGNI).

## Example (abbreviated interview → result)

> "What's the first outcome you want?" → "Users can sign in."
> "How do we know it works?" → "Email+password login succeeds; bad password is rejected."
> "How should I score 'login succeeds' — what matters?" → "Correctness most, then UX."
> "A test command, or AI-judge it?" → "`npm test -- auth`"

Produces a `vision.json` with goal `sign-in`, scenarios `login-succeeds` (test:
`npm test -- auth`) and `bad-password-rejected`, each with a correctness+ux rubric.
```

> **Authoring directive (read carefully):** Do NOT copy-paste the block above verbatim. The SKILL.md body contains its own ``` code fences; they appear escaped (`\``` ) here ONLY so this plan renders without breaking. When you create the file, **author it as a normal Markdown document** with real (unescaped) triple-backtick fences around the JSON and example blocks, balanced open/close. The content above is the specification of what the file must say — reproduce its meaning and structure exactly, with valid fences. Step 2's structural self-check will catch any malformed result.

- [ ] **Step 2: Structural self-check**

Verify the file has valid frontmatter (`name`, `description`), references only real CLI verbs (`autoloop vision import`, `autoloop init`) and the real validator path (`${CLAUDE_PLUGIN_ROOT}/bin/vision-schema.mjs`), and contains no placeholder/TODO text. Confirm the JSON example passes the validator conceptually (ids valid, goalId references a goal, rubric non-empty).

- [ ] **Step 3: Commit**

```bash
git add plugins/autoloop-reporting/skills/autoloop-vision/SKILL.md
git commit -m "feat(skill): autoloop-vision authoring skill"
```

---

## Task 4: `/autoloop-loop` skill

**Files:**
- Create: `plugins/autoloop-reporting/skills/autoloop-loop/SKILL.md`

- [ ] **Step 1: Write the skill** (`plugins/autoloop-reporting/skills/autoloop-loop/SKILL.md`)

```markdown
---
name: autoloop-loop
description: Use to run a vision-driven, self-evaluating development loop from a vision.json — generate a task plan, implement each task, re-test and self-score the scenarios it advances, record revisions when quality is short, and report progress to Autoloop. Trigger when the user wants to "run the loop", "build toward the vision", "/autoloop-loop", or drive a scenario-scored build.
---

# Autoloop Loop Driver

Drive a self-evaluating build loop toward a `vision.json`. You **orchestrate skills
you already have** — `superpowers:writing-plans` to plan, and
`superpowers:subagent-driven-development` (or `superpowers:test-driven-development`
for a single slice) to implement — and add the vision layer: test, score, evaluate,
revise. Every state change is reported via the bundled `autoloop` CLI. **Reporting is
best-effort: a `autoloop` warning is noted, never fatal — it must not derail the work.**

## Preconditions

- A **`vision.json`** in the cwd. If absent, offer to run `/autoloop-vision` first.
- An initialised **`.autoloop.json`** (`autoloop init --team <t> --project <slug>`) and
  `AUTOLOOP_API_KEY` in the env. If missing, set them up (or proceed local-only — the
  loop still runs; reporting just warns).

## Algorithm

1. **Import & plan.**
   - `autoloop vision import --file vision.json` (best-effort).
   - `autoloop project set --title "<project>" --status running`.
   - Invoke `superpowers:writing-plans` to turn the vision into a **phases → tasks**
     plan. Tag **each task with the `scenarioIds` it advances**. Keep tasks small.
   - Report the plan: for each phase `autoloop phase start <id> --name "<n>" --order <k>`;
     for each task `autoloop task start <id> --phase <p> --name "<n>" --order <k> --scenarios <id1>,<id2>`.
     (`--name` and `--order` are REQUIRED on both — omitting them fails the call.)

2. **Iterate per task** (in plan order):
   - Implement the task with `superpowers:subagent-driven-development` (or
     `superpowers:test-driven-development`).
   - `git commit` the work, then `autoloop commit --task <taskId>`.
   - For **each scenario the task advances**:
     - **Test.** If the scenario has `test.command` in vision.json, run it; parse the
       pass/fail counts. Otherwise **AI-judge**: inspect the work against the
       scenario's description and decide pass/fail yourself. Report:
       `autoloop test-run <scenarioId> --task <taskId> --passed <n> --failed <m> [--issue "..."]`.
     - **Score.** Rate **each rubric criterion** `0..max` against the work (be an
       honest judge — cite what's missing). Compute the weighted composite normalised
       to `0..100`: `composite = round(100 * Σ(value_i * weight_i) / Σ(max_i * weight_i))`.
       Report: `autoloop score <scenarioId> --task <taskId> --criterion <id>=<value> [--criterion ...] --composite <n> --commit <sha> [--note "..."]`.

3. **Evaluate & revise.** A scenario is **met** when its latest composite ≥ its
   threshold (default 80) AND its latest test-run `failed == 0`. After a task, if a
   scenario it targeted is **still unmet**, decide a **revision** of the remaining
   task path — add a hardening task, replace/reorder, or drop a dead end — and record
   it: `autoloop revise --scenario <s> --reason "<why>" --change <op>:<taskId> [--change ...]`
   (op ∈ add|replace|reorder|drop). Then actually adjust your remaining plan to match.

4. **Terminate** when ANY of:
   - **All targeted scenarios are met** → success.
   - **A cap is hit** — stop after a sensible max number of total iterations, or after
     **3 revisions on a single scenario** without it becoming met (it's stuck — escalate
     to the user rather than thrash), or an explicit token/budget limit.
   - **The user interrupts.**
   Always finish with a **"N/M scenarios met"** summary: which scenarios are met/unmet,
   the latest composite per scenario, revisions made, and the dashboard URL
   (https://daloop-42b47.web.app). If a cap truncated the work, say so explicitly.

## Rules

- **Best-effort reporting.** If any `autoloop` command warns (bad key, non-member,
  network), note it once and keep building. Never abort the loop over reporting.
- **Honest scoring.** Don't inflate composites to hit the threshold; an unmet scenario
  driving a revision is the loop working as intended.
- **No silent truncation.** If a cap stops the loop, the summary must say which
  scenarios were left unmet and why.
- **Stay in plan order**; respect `cfg.currentTaskId`. One task in flight at a time.

## Example (one task's cycle)

\```
autoloop vision import --file vision.json
autoloop project set --title "Acme Web" --status running
# writing-plans → phase "build", task "login" advancing scenario "login-works"
autoloop phase start build --name "Build" --order 1
autoloop task start login --phase build --name "Login" --order 1 --scenarios login-works
# …implement via subagent-driven-development, git commit…
autoloop commit --task login
autoloop test-run login-works --task login --passed 6 --failed 0
autoloop score login-works --task login --criterion correctness=4 --criterion ux=3 --composite 78 --commit <sha>
# composite 78 < threshold 80 → still unmet → revise
autoloop revise --scenario login-works --reason "UX rough on error states" --change add:login-polish
\```
```

> **Authoring directive (read carefully):** Do NOT copy-paste the block above verbatim. The SKILL.md body contains its own ``` code fences; they appear escaped (`\``` ) here ONLY so this plan renders. When you create the file, **author it as a normal Markdown document** with real (unescaped) triple-backtick fences around the example block, balanced open/close. The content above is the specification of what the file must say — reproduce its meaning and structure exactly, with valid fences. Step 2's structural self-check will catch any malformed result.

- [ ] **Step 2: Structural self-check**

Verify: valid frontmatter; every `autoloop` verb/flag used matches the real CLI (cross-check against `cli/autoloop.mjs` — especially that `phase start`/`task start` include `--name` and `--order`, `score` includes `--composite`, `revise` uses `--change op:taskId`); references `superpowers:writing-plans` and `superpowers:subagent-driven-development` by name; no TODO/placeholder; the composite formula is present; termination caps are explicit.

- [ ] **Step 3: Commit**

```bash
git add plugins/autoloop-reporting/skills/autoloop-loop/SKILL.md
git commit -m "feat(skill): autoloop-loop driver skill"
```

---

## Task 5: Register the skills in the plugin (README, version, marketplace)

**Files:**
- Modify: `plugins/autoloop-reporting/README.md`
- Modify: `plugins/autoloop-reporting/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update the plugin README**

In `plugins/autoloop-reporting/README.md`, update the **Layout** section to list the two new skills and the bundled validator, and add a short "Skills" section describing the three skills (`autoloop-reporting` = report status; `autoloop-vision` = author a vision; `autoloop-loop` = drive the vision loop). No registration step is needed (skills auto-discover), but document the trio.

- [ ] **Step 2: Bump the plugin version + broaden the description**

In `plugins/autoloop-reporting/.claude-plugin/plugin.json`: bump `version` `0.1.0` → `0.2.0`, and broaden `description` to mention authoring + driving the vision loop (not only reporting). Mirror the broadened description in `.claude-plugin/marketplace.json`'s plugin entry.

- [ ] **Step 3: Sanity-check JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/autoloop-reporting/.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`.

- [ ] **Step 4: Commit**

```bash
git add plugins/autoloop-reporting/README.md plugins/autoloop-reporting/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "docs(plugin): register autoloop-vision and autoloop-loop skills; bump to 0.2.0"
```

---

## Task 6: Verification

**Files:** none (verification only).

- [ ] **Step 1: Validator unit tests green**

Run: `cd functions && npm run test:run -- vision-schema`
Expected: PASS (7 tests).

- [ ] **Step 2: Full suite still green (no regressions)**

Run: `cd functions && npm test`
Expected: PASS — the existing 143 tests plus the new vision-schema tests; no regressions.

- [ ] **Step 3: Build clean**

Run: `cd functions && npm run build`
Expected: 0 errors (the new `.mjs` and `.test.ts` are outside the `src` build, so this just confirms nothing else broke).

- [ ] **Step 4: Structural checks for the skills**

- Both `SKILL.md` files have valid frontmatter (first line `---`, `name:` + `description:`, closing `---`).
- Validator copy is byte-identical: `diff cli/vision-schema.mjs plugins/autoloop-reporting/bin/vision-schema.mjs && echo IDENTICAL`.
- Grep the loop skill for the required-flag forms: `grep -q 'task start .*--name .*--order' plugins/autoloop-reporting/skills/autoloop-loop/SKILL.md && grep -q -- '--composite' plugins/autoloop-reporting/skills/autoloop-loop/SKILL.md && echo "verbs OK"`.

- [ ] **Step 5: Confirm success criteria**

By inspection: `/autoloop-vision` produces a vision that passes `validateVision` and (after `stripForImport`) is accepted by `autoloop vision import`; `/autoloop-loop` emits only real CLI verbs, orchestrates writing-plans + subagent-driven-development, scores via the documented composite formula, and has explicit termination caps; reporting is best-effort throughout; both skills are in the plugin and load.

- [ ] **Step 6: Final commit (if any verification fixes)**

```bash
git add -A -- functions cli plugins .claude-plugin scripts docs
git commit -m "chore: vision-loop skills verification (validator + suites green)"
```

---

## Notes for the executor

- **Only `cli/vision-schema.mjs` is TDD code.** The two `SKILL.md` files are Markdown instruction docs — write them carefully and run the structural self-checks; there are no unit tests for them (by design — every CLI verb they invoke is already covered by sub-project #1's 143 tests).
- **Use real verbs only.** If you're unsure of a flag, read `cli/autoloop.mjs` — do not invent flags. `phase start`/`task start` REQUIRE `--name` and `--order`; `score` REQUIRES `--composite`.
- **Keep the validator's canonical copy at `cli/vision-schema.mjs`** and always re-run `scripts/sync-autoloop-cli.sh` after editing it so the plugin copy stays byte-identical.
- **Best-effort is sacred** — the loop skill must never tell the agent to abort real work because a `autoloop` report failed.
- Do NOT `git add -A` broadly (pre-existing untracked `.DS_Store`/`prototype/`); add named paths.
