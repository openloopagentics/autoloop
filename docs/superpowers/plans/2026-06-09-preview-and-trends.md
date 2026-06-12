# Preview URLs + cross-loop trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each loop can report a preview URL the user can open from the dashboard, and the Dashboard tab grows four per-loop trend sparklines (scenarios met, avg composite, bugs opened vs fixed, tokens/loop) derived entirely client-side from data the web already reads.

**Architecture:** One additive contract field (`loop.previewUrl`, validated URL, nullable to clear — exactly the `commit.url` precedent; `null` is stored as-is, never `FieldValue.delete()`). Everything else is web-only: a pure `trendView.ts` module derives `TrendPoint[]` from per-loop run data (calling the existing `deriveScenarioState` predicate with loop-scoped subsets — no refactor), a bounded `useLoopTrend` hook fans out listeners for the 4 flat collections over the most recent `TREND_LOOPS_MAX = 20` loops (reusing the `byScope` accumulator pattern of `useAllScores`/`useAllTestRuns`/`useAllBugs`) plus ONE-SHOT `getDocs` reads for nested task commits, and a `TrendsStrip` renders four inline-SVG sparklines (no chart library). The driver skill's Step 3b gains a stack-agnostic deploy-and-report step.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript, Firestore Admin SDK, zod, Vitest + Firestore emulator), dependency-free Node CLI (`cli/autoloop.mjs`), React 18 + Vite + firebase JS SDK (`onSnapshot`/`getDocs`), Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-09-preview-and-trends-design.md` — approved; implement exactly, no redesign.

**Conventions (read before starting):**
- Functions tests: run a single file with the emulator already running (`cd functions && npm run emulators` in another terminal): `cd functions && npm run test:run -- <name>`. The full suite (spins up the emulator itself) is `cd functions && npm test`. Rules tests: `cd functions && npm run test:rules`. Build: `cd functions && npm run build`.
- Web tests: `cd web && npm test` (vitest run); single file: `cd web && npm test -- trendView`. Build (includes `tsc -b`): `cd web && npm run build`.
- The CLI exists in **3 copies**: canonical `cli/autoloop.mjs` → synced to `plugins/autoloop/bin/autoloop` and `web/public/skill/autoloop.mjs` via `bash scripts/sync-autoloop-cli.sh` (the script also syncs the SKILL.md copies to `web/public/skill/`). Edit ONLY the canonical copy, then sync.
- A SKILL.md change requires a **plugin version bump** in `plugins/autoloop/.claude-plugin/plugin.json` (currently `0.10.1`) and a skill-copy sync (same sync script).
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Do not gold-plate: no iframe embedding, no screenshots, no cost-in-dollars, no server-side met history (all explicitly out of scope).

**Design decisions locked by the spec (do not revisit):**
- `null` previewUrl is **stored** (web treats `null` and absent alike and hides the link); omitting the field keeps the stored doc byte-stable.
- `main` (the implicit project-direct loop) participates in trends via the existing `loopArgFor`/`basePath(…, undefined)` convention and orders **first**: it has no `order`, so `buildTrend` synthesizes `MAIN_TREND_ORDER = -1`.
- A loop is judged on what it attempted: `scenarioTotal` counts only scenarios tagged in that loop's `tasks[].scenarioIds`.
- `tokensTotal` comes from **task commits only** (`tasks/{taskId}/commits`) — only `taskCommits.ts` persists `commit.tokens`; missing `tokens` ⇒ 0.
- Task commits are fetched with one-shot `getDocs` keyed on each loop's tasks snapshot — NOT listeners (bounds listeners at 20 × 4; token totals refresh on tasks changes, not live).
- The strip is hidden under 2 loops and captioned "last N loops" (no silent truncation).
- One non-spec'd seam, resolved here: `useLoopTrend` takes a third arg `includeMain: boolean` — `ProjectDetail` already computes `hasProjectDirectData` for `buildLoopList`, and duplicating that detection inside the hook would add an extra listener and a second source of truth (DRY). The pure window logic (`trendWindow`) lives in `trendView.ts` so it's unit-testable and reusable by the later product-map plan.

---

### Task 1: Contract — `loopBody.previewUrl` + service + API tests

**Files:**
- Modify: `functions/src/schemas.ts` (`loopBody`, ~line 141-147)
- Modify: `functions/src/services/loops.ts` (`upsertLoop`, after the `body.status` line ~31)
- Test: `functions/test/loops.test.ts` (new describe block)

- [ ] **Step 1: Write the failing API tests**

Append to `functions/test/loops.test.ts` (the file already imports `request`, `authHeader`, `app`, `db`, and defines `createProject`):

```ts
describe("loop.previewUrl", () => {
  async function createLoop(loopId = "l1") {
    await createProject();
    await request(app).put(`/v1/teams/team1/projects/acme/loops/${loopId}`).set(authHeader())
      .send({ goal: "g", order: 1, status: "running" });
  }

  it("stores a valid preview URL", async () => {
    await createLoop();
    const res = await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader())
      .send({ previewUrl: "https://app--l1-abc.web.app" });
    expect(res.status).toBe(200);
    expect((await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!.previewUrl)
      .toBe("https://app--l1-abc.web.app");
  });

  it("stores null on clear (null is stored, not deleted)", async () => {
    await createLoop();
    await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader())
      .send({ previewUrl: "https://app--l1-abc.web.app" });
    const res = await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader())
      .send({ previewUrl: null });
    expect(res.status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect("previewUrl" in d).toBe(true);
    expect(d.previewUrl).toBeNull();
  });

  it("400s on an invalid URL", async () => {
    await createLoop();
    const res = await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader())
      .send({ previewUrl: "not a url" });
    expect(res.status).toBe(400);
  });

  it("omits the key entirely when not provided (byte-stable)", async () => {
    await createLoop();
    // an unrelated update must not introduce the key
    await request(app).put("/v1/teams/team1/projects/acme/loops/l1").set(authHeader())
      .send({ status: "paused" });
    const d = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect("previewUrl" in d).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- loops` (emulator running)
Expected: FAIL — "stores a valid preview URL" and "stores null" fail (`previewUrl` is undefined: zod's plain `z.object` drops the unknown key); "400s on an invalid URL" fails (200, key dropped). The "omits the key" test passes already (that's fine — it's the regression guard).

- [ ] **Step 3: Implement**

In `functions/src/schemas.ts`, extend `loopBody` (mirrors `commitBody.url` at line 44):

```ts
export const loopBody = z.object({
  goal: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  order: z.number().int().optional(),
  status: status.optional(),
  previewUrl: z.string().url().nullable().optional(),
});
```

In `functions/src/services/loops.ts`, after `if (body.status !== undefined) data.status = body.status;` add:

```ts
    // null is stored as-is (the web hides the link for null OR absent) — exactly how
    // commits.ts stores commit.url; never FieldValue.delete(). Omitted ⇒ byte-stable doc.
    if (body.previewUrl !== undefined) data.previewUrl = body.previewUrl;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- loops`
Expected: PASS (all four new tests + every pre-existing loops test).

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/src/services/loops.ts functions/test/loops.test.ts
git commit -m "feat(contract): optional nullable loop.previewUrl (commit.url precedent)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: CLI — `loop set --preview-url` + relax the `--status` requirement

`loop set` currently hard-requires `--status` (`UsageError` at `cli/autoloop.mjs:358`). Relax to "at least one settable flag", add `--preview-url` (empty string ⇒ `null` to clear), and preserve the terminal-status side effect (clearing `cfg.currentLoopId`) **only when `--status` was given and is terminal**.

**Files:**
- Modify: `cli/autoloop.mjs` (`case "loop set"`, lines 356-369)
- Modify (generated): `plugins/autoloop/bin/autoloop`, `web/public/skill/autoloop.mjs` (via sync script)
- Test: `functions/test/cli.unit.test.ts` (extend the `"loop start/set + loop-aware URLs"` describe, ~line 299 — reuse its `initDir`/`cap`/`base` helpers)

- [ ] **Step 1: Write the failing tests**

Add inside the `describe("loop start/set + loop-aware URLs", …)` block in `functions/test/cli.unit.test.ts`, after the existing `"loop set PUTs the status"` test:

```ts
  it("loop set --preview-url PUTs previewUrl (no status required)", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "set", "l1", "--preview-url", "https://app--l1-abc.web.app"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/loops/l1");
    expect(c.init.method).toBe("PUT");
    expect(JSON.parse(c.init.body)).toEqual({ previewUrl: "https://app--l1-abc.web.app" });
  });

  it('loop set --preview-url "" sends null (clear)', async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "set", "l1", "--preview-url", ""], base(dir, c))).toBe(0);
    expect(JSON.parse(c.init.body)).toEqual({ previewUrl: null });
  });

  it("loop set with both flags sends both fields", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["loop", "set", "l1", "--status", "running", "--preview-url", "https://x.web.app"], base(dir, c))).toBe(0);
    expect(JSON.parse(c.init.body)).toEqual({ status: "running", previewUrl: "https://x.web.app" });
  });

  it("loop set with no settable flag errors before any network call", async () => {
    const dir = initDir();
    const code = await run(["loop", "set", "l1"], {
      cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {},
      fetchImpl: async () => { throw new Error("should not be called"); },
    });
    expect(code).toBe(1);
  });

  it("terminal --status still clears currentLoopId; --preview-url alone does not", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    await run(["loop", "set", "l1", "--preview-url", "https://x.web.app"], base(dir, c));
    expect(loadConfig(dir).currentLoopId).toBe("l1");          // untouched
    await run(["loop", "set", "l1", "--status", "completed"], base(dir, c));
    expect(loadConfig(dir).currentLoopId).toBeNull();          // side effect preserved
  });
```

> `run`, `loadConfig`, `tmp`, `saveConfig` are already imported at the top of `cli.unit.test.ts`. Note on `parseArgs` (cli/autoloop.mjs:16-32): `--preview-url ""` yields the empty string (only a *missing* next arg or a `--`-prefixed one yields `true`), so the empty-string⇒null contract is parseable.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL — the `--preview-url` tests exit 1 ("loop set requires --status"); the "no settable flag" and "terminal --status" tests pass/fail accordingly (the no-flag test already passes; that's the guard that the relaxation keeps rejecting an empty body).

- [ ] **Step 3: Implement**

Replace the whole `case "loop set"` block in `cli/autoloop.mjs` (lines 356-369) with:

```js
      case "loop set": {
        const loopId = positionals[2]; validateId("loopId", loopId);
        const body = {};
        if (flags.status) {
          validateStatus(flags.status);
          body.status = flags.status;
        }
        if (flags["preview-url"] !== undefined) {
          const v = oneFlag("preview-url", flags["preview-url"]);
          if (typeof v !== "string") throw new UsageError('--preview-url requires a value (use "" to clear)');
          body.previewUrl = v === "" ? null : v; // empty string clears (stored as null)
        }
        if (Object.keys(body).length === 0) throw new UsageError("loop set requires at least one of --status/--preview-url");
        const cfg = loadConfig(cwd);
        const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
        if (flags.status && TERMINAL_STATUSES.includes(flags.status)) {
          cfg.currentLoopId = null;
          saveConfig(cwd, cfg);
        }
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/loops/${loopId}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
```

(Behavior preserved exactly for `--status`-only invocations: same body, same URL, same terminal side effect. `oneFlag` is the existing helper at line 35.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS — all new tests plus the pre-existing `"loop set PUTs the status"` test (body `{ status: "completed" }` unchanged).

- [ ] **Step 5: Sync the three CLI copies and verify identical**

```bash
bash scripts/sync-autoloop-cli.sh
diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && diff cli/autoloop.mjs web/public/skill/autoloop.mjs && echo IDENTICAL
```

Expected: the `✓ synced …` lines, then `IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add cli/autoloop.mjs plugins/autoloop/bin/autoloop web/public/skill/autoloop.mjs
git commit -m "feat(cli): loop set --preview-url; relax --status to at-least-one-flag

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Web — preview link (`Loop.previewUrl` → LoopSnapshot + LoopDetail)

The `Loop` type and `SelectableLoop` gain `previewUrl`; `buildLoopList` passes it through (the synthesized `main` never has one). A tiny shared `PreviewLink` renders the anchor; it appears in `LoopSnapshot` (Dashboard tab) and `LoopDetail` (Loops tab — `LoopRow` is a `<button>`, and an anchor inside a button is invalid interactive nesting, so the Loops-tab link lives in the detail panel rendered beneath the selected row).

**Files:**
- Modify: `web/src/dashboard/types.ts` (`Loop`, line 5-9)
- Modify: `web/src/dashboard/loopView.ts` (`SelectableLoop` + `buildLoopList`)
- Create: `web/src/dashboard/components/PreviewLink.tsx`
- Modify: `web/src/dashboard/components/LoopSnapshot.tsx`
- Modify: `web/src/dashboard/components/LoopDetail.tsx`
- Modify: `web/src/dashboard/tabs/LoopsTab.tsx` (pass `previewUrl` to `LoopDetail`)
- Modify: `web/src/index.css` (one `.preview-link` rule, after `.snapshot-current` ~line 1040)
- Test: `web/src/dashboard/components/dashboard.test.tsx`, `web/src/dashboard/loopView.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/dashboard/components/dashboard.test.tsx`:

```tsx
describe("preview link", () => {
  const empty = { phases: [], tasks: [], scenarios: [], scores: [], testRuns: [] } as any;
  it("LoopSnapshot renders Open preview with target=_blank and rel noopener noreferrer", () => {
    render(<LoopSnapshot loop={{ id: "l1", isMain: false, previewUrl: "https://app--l1.web.app" }} {...empty} />);
    const a = screen.getByRole("link", { name: /open preview/i });
    expect(a).toHaveAttribute("href", "https://app--l1.web.app");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("LoopSnapshot hides the link when previewUrl is absent or null", () => {
    const { rerender } = render(<LoopSnapshot loop={{ id: "l1", isMain: false }} {...empty} />);
    expect(screen.queryByRole("link", { name: /open preview/i })).toBeNull();
    rerender(<LoopSnapshot loop={{ id: "l1", isMain: false, previewUrl: null }} {...empty} />);
    expect(screen.queryByRole("link", { name: /open preview/i })).toBeNull();
  });
});
```

Append to `web/src/dashboard/loopView.test.ts`, inside `describe("buildLoopList", …)`:

```ts
  it("passes previewUrl through to the selectable loop; synthesized main has none", () => {
    const list = buildLoopList(
      [{ id: "l1", order: 1, status: "completed", previewUrl: "https://p.web.app" }], project, true);
    expect(list.find((l) => l.id === "l1")?.previewUrl).toBe("https://p.web.app");
    expect(list.find((l) => l.isMain)?.previewUrl).toBeUndefined();
  });
```

And a `LoopDetail` test — append to `web/src/dashboard/components/loops.test.tsx`:

```tsx
import { LoopDetail } from "./LoopDetail";

describe("LoopDetail preview link", () => {
  const noop = () => null;
  it("renders the preview anchor when previewUrl is set, hides it otherwise", () => {
    const { rerender } = render(
      <LoopDetail phases={[]} tasks={[]} testRuns={[]} revisions={[]} previewUrl="https://app--l1.web.app"
        renderLegacyPhase={noop} renderTask={noop} />);
    expect(screen.getByRole("link", { name: /open preview/i })).toHaveAttribute("rel", "noopener noreferrer");
    rerender(
      <LoopDetail phases={[]} tasks={[]} testRuns={[]} revisions={[]}
        renderLegacyPhase={noop} renderTask={noop} />);
    expect(screen.queryByRole("link", { name: /open preview/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- dashboard.test loops.test loopView.test`
Expected: FAIL — TypeScript/JSX errors (`previewUrl` not on the types / not a `LoopDetail` prop) and missing-link assertions.

- [ ] **Step 3: Implement**

`web/src/dashboard/types.ts` — extend `Loop`:

```ts
export interface Loop {
  id: string; goal?: string; name?: string; order?: number; status?: string;
  startedAt?: unknown; endedAt?: unknown;
  currentPhaseId?: string | null; currentTaskId?: string | null;
  previewUrl?: string | null; // agent-reported preview deploy; null and absent both mean "no link"
}
```

`web/src/dashboard/loopView.ts` — extend `SelectableLoop` and the `buildLoopList` mapping:

```ts
export interface SelectableLoop {
  id: string; isMain: boolean;
  goal?: string; name?: string; status?: string; order?: number;
  currentPhaseId?: string | null; currentTaskId?: string | null;
  previewUrl?: string | null;
}
```

In `buildLoopList`, add `previewUrl: l.previewUrl,` to the explicit-loop `.map()` object (the `main` push stays unchanged — the project doc has no previewUrl).

`web/src/dashboard/components/PreviewLink.tsx` (new):

```tsx
/** "Open preview ↗" anchor for a loop's reported preview deploy.
 *  Hidden when the URL is absent OR null (the contract stores null to clear).
 *  Plain link — no iframe embedding (preview hosts set their own frame policies). */
export function PreviewLink({ url }: { url?: string | null }) {
  if (!url) return null;
  return (
    <a className="preview-link" href={url} target="_blank" rel="noopener noreferrer">
      Open preview ↗
    </a>
  );
}
```

`web/src/dashboard/components/LoopSnapshot.tsx` — import and render it in the head row:

```tsx
import { PreviewLink } from "./PreviewLink";
```

```tsx
      <div className="snapshot-head">
        <span className="snapshot-name">{loop.name ?? loop.goal ?? loop.id}</span>
        {loop.status && <StatusBadge status={loop.status} />}
        <PreviewLink url={loop.previewUrl} />
      </div>
```

`web/src/dashboard/components/LoopDetail.tsx` — add the prop and render it first:

```tsx
import type { ReactNode } from "react";
import type { Phase, Task, TestRun, Revision } from "../types";
import { PlanSection } from "./PlanSection";
import { TestRunsSection } from "./TestRunsSection";
import { RevisionTimeline } from "./RevisionTimeline";
import { PreviewLink } from "./PreviewLink";

export function LoopDetail({ phases, tasks, testRuns, revisions, currentTaskId, previewUrl, renderLegacyPhase, renderTask }: {
  phases: Phase[]; tasks: Task[]; testRuns: TestRun[]; revisions: Revision[]; currentTaskId?: string | null;
  previewUrl?: string | null;
  renderLegacyPhase: (phase: Phase) => ReactNode; renderTask: (task: Task, isCurrent: boolean) => ReactNode;
}) {
  return (
    <>
      <PreviewLink url={previewUrl} />
      <PlanSection phases={phases} tasks={tasks} currentTaskId={currentTaskId} renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />
      <TestRunsSection testRuns={testRuns} />
      <RevisionTimeline revisions={revisions} />
    </>
  );
}
```

`web/src/dashboard/tabs/LoopsTab.tsx` — pass it through (one-line change inside the `detail={…}` expression):

```tsx
      detail={selected && <LoopDetail phases={phases} tasks={tasks} testRuns={testRuns} revisions={revisions}
        currentTaskId={selected.currentTaskId} previewUrl={selected.previewUrl}
        renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />} />
```

`web/src/index.css` — after the `.snapshot-current` rule (~line 1040):

```css
.preview-link { font-size: 12.5px; color: var(--accent); text-decoration: none; white-space: nowrap; margin-left: auto; }
.preview-link:hover { text-decoration: underline; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- dashboard.test loops.test loopView.test`
Expected: PASS (new tests + every pre-existing test in those files).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/loopView.ts web/src/dashboard/components/PreviewLink.tsx \
  web/src/dashboard/components/LoopSnapshot.tsx web/src/dashboard/components/LoopDetail.tsx \
  web/src/dashboard/tabs/LoopsTab.tsx web/src/index.css \
  web/src/dashboard/components/dashboard.test.tsx web/src/dashboard/components/loops.test.tsx web/src/dashboard/loopView.test.ts
git commit -m "feat(web): Open preview link on LoopSnapshot + LoopDetail (loop.previewUrl)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Web — pure `trendView.ts` (fully unit-tested)

Pure derivation module: `buildTrend` (per-loop met via `deriveScenarioState` over loop-scoped subsets), `trendWindow` (the 20-loop cap with `main` first), `polylinePoints` (SVG math for Task 6). No Firebase imports — fully unit-testable.

**Files:**
- Create: `web/src/dashboard/trendView.ts`
- Test: `web/src/dashboard/trendView.test.ts`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/trendView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTrend, trendWindow, polylinePoints, MAIN_TREND_ORDER, TREND_LOOPS_MAX, type LoopRunData } from "./trendView";
import type { Loop, Scenario } from "./types";

const scenarios = [
  { id: "s1", threshold: 80 },
  { id: "s2", threshold: 80 },
  { id: "s3", threshold: 80 },
] as Scenario[];

function runData(over: Partial<LoopRunData> & { loop: Loop }): LoopRunData {
  return { scores: [], testRuns: [], bugs: [], taskCommits: [], tasks: [], ...over };
}

describe("buildTrend", () => {
  it("counts met via deriveScenarioState over THIS loop's events only (latest by id)", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      tasks: [{ id: "t1", scenarioIds: ["s1", "s2"] }],
      scores: [
        { id: "01A", scenarioId: "s1", composite: 90 },  // older
        { id: "01B", scenarioId: "s1", composite: 70 },  // latest s1 → below threshold
        { id: "01C", scenarioId: "s2", composite: 85 },  // latest s2 → met (test passes)
      ],
      testRuns: [
        { id: "01D", scenarioId: "s1", passed: 1, failed: 0 },
        { id: "01E", scenarioId: "s2", passed: 2, failed: 0 },
      ],
    });
    const [p] = buildTrend([d], scenarios);
    expect(p.metCount).toBe(1);          // only s2: s1's LATEST composite (70) is below threshold
    expect(p.scenarioTotal).toBe(2);     // s3 not tagged in this loop's tasks
    expect(p.avgComposite).toBe(77.5);   // mean of latest composites: (70 + 85) / 2
  });

  it("met requires BOTH a passing latest test-run and composite >= threshold in the loop", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      tasks: [{ id: "t1", scenarioIds: ["s1"] }],
      scores: [{ id: "01A", scenarioId: "s1", composite: 95 }],
      testRuns: [{ id: "01B", scenarioId: "s1", passed: 3, failed: 1 }], // failing → unmet
    });
    expect(buildTrend([d], scenarios)[0].metCount).toBe(0);
  });

  it("scenarioTotal is the union of tasks[].scenarioIds (deduped, only existing scenarios)", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      tasks: [
        { id: "t1", scenarioIds: ["s1", "s2"] },
        { id: "t2", scenarioIds: ["s2", "ghost"] }, // dupe + unknown id
        { id: "t3" },                               // no scenarioIds
      ],
    });
    expect(buildTrend([d], scenarios)[0].scenarioTotal).toBe(2);
  });

  it("avgComposite is null when no tagged scenario has a score", () => {
    const d = runData({ loop: { id: "l1", order: 1 }, tasks: [{ id: "t1", scenarioIds: ["s1"] }] });
    expect(buildTrend([d], scenarios)[0].avgComposite).toBeNull();
  });

  it("bugsOpened counts all bugs in the loop; bugsFixed counts status=fixed", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      bugs: [{ id: "b1", status: "open" }, { id: "b2", status: "fixed" }, { id: "b3", status: "fixed" }],
    });
    const [p] = buildTrend([d], scenarios);
    expect(p.bugsOpened).toBe(3);
    expect(p.bugsFixed).toBe(2);
  });

  it("tokensTotal sums taskCommit.tokens.total, missing tokens ⇒ 0", () => {
    const d = runData({
      loop: { id: "l1", order: 1 },
      taskCommits: [
        { sha: "a", tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 1000 } },
        { sha: "b" }, // legacy commit without tokens
        { sha: "c", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 250 } },
      ],
    });
    expect(buildTrend([d], scenarios)[0].tokensTotal).toBe(1250);
  });

  it("orders ascending by loop.order with the orderless main FIRST (MAIN_TREND_ORDER)", () => {
    const points = buildTrend([
      runData({ loop: { id: "l2", order: 2 } }),
      runData({ loop: { id: "main" } }),            // synthesized: no order
      runData({ loop: { id: "l1", order: 1 } }),
    ], scenarios);
    expect(points.map((p) => p.loopId)).toEqual(["main", "l1", "l2"]);
    expect(points[0].order).toBe(MAIN_TREND_ORDER);
  });
});

describe("trendWindow", () => {
  const mkLoops = (n: number): Loop[] => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, order: i + 1 }));
  it("prepends main when includeMain and keeps ascending order", () => {
    expect(trendWindow(mkLoops(2), true).map((l) => l.id)).toEqual(["main", "l1", "l2"]);
    expect(trendWindow(mkLoops(2), false).map((l) => l.id)).toEqual(["l1", "l2"]);
  });
  it("caps at TREND_LOOPS_MAX keeping the MOST RECENT loops (main falls out first)", () => {
    const w = trendWindow(mkLoops(25), true);
    expect(w).toHaveLength(TREND_LOOPS_MAX);
    expect(w[0].id).toBe("l6");                  // main + l1..l5 dropped
    expect(w[w.length - 1].id).toBe("l25");
  });
});

describe("polylinePoints", () => {
  it("maps a series into pad-inset svg coordinates, min at bottom, max at top", () => {
    const pts = polylinePoints([0, 10], 100, 40); // pad = 2
    expect(pts).toBe("2.0,38.0 98.0,2.0");
  });
  it("renders a flat series at mid-height", () => {
    expect(polylinePoints([5, 5, 5], 100, 40)).toBe("2.0,20.0 50.0,20.0 98.0,20.0");
  });
  it("skips nulls (gap points dropped, x positions preserved)", () => {
    expect(polylinePoints([0, null, 10], 100, 40)).toBe("2.0,38.0 98.0,2.0");
  });
  it("is empty for an all-null or empty series", () => {
    expect(polylinePoints([], 100, 40)).toBe("");
    expect(polylinePoints([null, null], 100, 40)).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- trendView`
Expected: FAIL — `./trendView` does not exist.

- [ ] **Step 3: Implement**

`web/src/dashboard/trendView.ts`:

```ts
import type { Bug, Commit, Loop, Scenario, Score, Task, TestRun } from "./types";
import { deriveScenarioState, latestById } from "./scenarioState";
import { MAIN_ID } from "./loopView";

/** The implicit `main` loop predates loop-level adoption and has no `order` —
 *  it always sorts FIRST in a trend (oldest). */
export const MAIN_TREND_ORDER = -1;

/** Trend fan-out cap. Older loops fall silently outside the window; the strip
 *  labels the window ("last N loops") per the no-silent-truncation rule. */
export const TREND_LOOPS_MAX = 20;

export interface LoopRunData {
  loop: Loop;
  scores: Score[];
  testRuns: TestRun[];
  bugs: Bug[];
  taskCommits: Commit[];
  tasks: Task[];
}

export interface TrendPoint {
  loopId: string;
  order: number;
  metCount: number;
  scenarioTotal: number;        // scenarios tagged in this loop's tasks[].scenarioIds
  avgComposite: number | null;  // mean of latest composite per tagged scenario
  bugsOpened: number;
  bugsFixed: number;
  tokensTotal: number;          // Σ taskCommit.tokens.total (missing ⇒ 0)
}

/** The trend window: implicit `main` first (when the project has project-direct data),
 *  then explicit loops ascending by order — capped to the most recent TREND_LOOPS_MAX.
 *  `loops` must already be ascending by order (useLoops queries orderBy("order")). */
export function trendWindow(loops: Loop[], includeMain: boolean): Loop[] {
  const combined = includeMain ? [{ id: MAIN_ID } as Loop, ...loops] : [...loops];
  return combined.slice(-TREND_LOOPS_MAX);
}

/** Per-loop trend series, ascending by order (main first). A loop is judged on what it
 *  attempted: only scenarios tagged in ITS tasks count, and met-state is derived from
 *  ITS loop-scoped events via the existing deriveScenarioState predicate (no refactor). */
export function buildTrend(loops: LoopRunData[], scenarios: Scenario[]): TrendPoint[] {
  const points = loops.map((d) => {
    const tagged = new Set(d.tasks.flatMap((t) => t.scenarioIds ?? []));
    const taggedScenarios = scenarios.filter((s) => tagged.has(s.id));
    let metCount = 0;
    const composites: number[] = [];
    for (const s of taggedScenarios) {
      if (deriveScenarioState(s, d.scores, d.testRuns).state === "met") metCount++;
      const latest = latestById(d.scores.filter((sc) => sc.scenarioId === s.id));
      if (latest?.composite !== undefined) composites.push(latest.composite);
    }
    return {
      loopId: d.loop.id,
      order: d.loop.order ?? MAIN_TREND_ORDER,
      metCount,
      scenarioTotal: taggedScenarios.length,
      avgComposite: composites.length ? composites.reduce((a, b) => a + b, 0) / composites.length : null,
      bugsOpened: d.bugs.length, // every bug recorded in L was opened there
      bugsFixed: d.bugs.filter((b) => b.status === "fixed").length,
      tokensTotal: d.taskCommits.reduce((sum, c) => sum + (c.tokens?.total ?? 0), 0),
    };
  });
  return points.sort((a, b) => a.order - b.order || a.loopId.localeCompare(b.loopId));
}

/** SVG polyline `points` attribute for a series. X advances by index across the full
 *  width; nulls are skipped (the line connects across the gap). A flat series renders
 *  at mid-height. Returns "" when there is nothing to plot. */
export function polylinePoints(values: (number | null)[], width: number, height: number, pad = 2): string {
  const pts: Array<[number, number]> = [];
  values.forEach((v, i) => { if (v !== null) pts.push([i, v]); });
  if (pts.length === 0) return "";
  const lastX = values.length - 1 || 1;
  const nums = pts.map(([, v]) => v);
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min;
  return pts
    .map(([i, v]) => {
      const x = pad + (i / lastX) * (width - 2 * pad);
      const y = span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- trendView`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/trendView.ts web/src/dashboard/trendView.test.ts
git commit -m "feat(web): pure trendView — buildTrend/trendWindow/polylinePoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Web — `useLoopTrend` hook (bounded fan-out + one-shot task commits)

The data layer for trends (and, later, the product-map plan — keep every export public and the file self-contained). Listeners for the 4 flat collections per loop in the window (≤ 20 × 4, reusing the `byScope` accumulator + stale-scope pattern of `useAllScores`/`useAllTestRuns`/`useAllBugs` in `hooks.ts`); nested task commits via one-shot `getDocs` keyed on each loop's tasks snapshot.

**Files:**
- Create: `web/src/dashboard/useLoopTrend.ts`

No direct unit test for this file — it imports `../firebase` (live SDK init), and the spec's web-test list covers the pure derivation (`trendView`, Task 4) and the components (Task 6); existing hooks in `hooks.ts` are likewise untested. The window/cap/main logic it delegates to (`trendWindow`) IS unit-tested.

- [ ] **Step 1: Implement the hook**

`web/src/dashboard/useLoopTrend.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { collection, documentId, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { basePath, MAIN_ID } from "./loopView";
import { useLoops } from "./hooks";
import { trendWindow, type LoopRunData } from "./trendView";
import type { Bug, Commit, Score, Task, TestRun } from "./types";

interface Slice { scores?: Score[]; testRuns?: TestRun[]; bugs?: Bug[]; tasks?: Task[]; taskCommits?: Commit[]; }

/** The 4 flat run-data collections listened to per loop (4 × ≤20 listeners). */
const FLAT_COLLECTIONS = ["scores", "testRuns", "bugs", "tasks"] as const;

/**
 * Run data for the most recent TREND_LOOPS_MAX loops (incl. the implicit `main` when
 * includeMain — pass ProjectDetail's hasProjectDirectData). Flat collections are live
 * listeners; task COMMITS (nested under tasks/{id}/commits, the only place tokens are
 * persisted) are one-shot getDocs reads re-fetched when a loop's tasks snapshot changes
 * — trends don't need realtime token movement. Loading until every loop's 4 flat
 * slices have arrived. Exported as the trend data layer (reused by the product map).
 */
export function useLoopTrend(teamId: string, slug: string, includeMain: boolean):
  { data: LoopRunData[]; loading: boolean; error: string | null } {
  const { data: loops, loading: loopsLoading, error: loopsError } = useLoops(teamId, slug);
  const window = trendWindow(loops, includeMain);
  const loopKey = window.map((l) => l.id).join(",");
  const [byScope, setByScope] = useState<Record<string, Slice>>({});
  const [error, setError] = useState<string | null>(null);

  // Live listeners: 4 flat collections per loop in the window. `main` maps to the
  // project-direct base via basePath(…, undefined) — the loopArgFor convention.
  useEffect(() => {
    const ids = loopKey.split(",").filter(Boolean);
    const unsubs = ids.flatMap((id) => {
      const loopArg = id === MAIN_ID ? undefined : id;
      return FLAT_COLLECTIONS.map((coll) =>
        onSnapshot(query(collection(db, ...basePath(teamId, slug, loopArg), coll), orderBy(documentId())),
          (snap) => {
            const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
            setByScope((prev) => ({ ...prev, [id]: { ...prev[id], [coll]: docs } }));
          },
          (e) => setError(e.message)));
    });
    return () => unsubs.forEach((u) => u());
  }, [teamId, slug, loopKey]);

  // One-shot task-commit reads, keyed on each loop's tasks snapshot (task-id sets):
  // re-fetched when tasks change, NOT live — bounds listener count at 20 × 4.
  const byScopeRef = useRef(byScope);
  byScopeRef.current = byScope;
  const tasksKey = window.map((l) => `${l.id}:${(byScope[l.id]?.tasks ?? []).map((t) => t.id).join("+")}`).join("|");
  useEffect(() => {
    let cancelled = false;
    for (const part of tasksKey.split("|").filter(Boolean)) {
      const id = part.slice(0, part.indexOf(":"));
      const loopArg = id === MAIN_ID ? undefined : id;
      const tasks = byScopeRef.current[id]?.tasks ?? [];
      Promise.all(tasks.map(async (t) => {
        const snap = await getDocs(collection(db, ...basePath(teamId, slug, loopArg), "tasks", t.id, "commits"));
        return snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[];
      })).then((perTask) => {
        if (!cancelled) setByScope((prev) => ({ ...prev, [id]: { ...prev[id], taskCommits: perTask.flat() } }));
      }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    }
    return () => { cancelled = true; };
  }, [teamId, slug, tasksKey]);

  // Assemble in window order; only current scopes are read (a removed loop's stale
  // slice lingers in state but is never emitted — same stance as useAllScores).
  const ready = (id: string) => FLAT_COLLECTIONS.every((c) => byScope[id]?.[c] !== undefined);
  const loading = loopsLoading || window.some((l) => !ready(l.id));
  const data: LoopRunData[] = window.map((l) => ({
    loop: l,
    scores: byScope[l.id]?.scores ?? [],
    testRuns: byScope[l.id]?.testRuns ?? [],
    bugs: byScope[l.id]?.bugs ?? [],
    tasks: byScope[l.id]?.tasks ?? [],
    taskCommits: byScope[l.id]?.taskCommits ?? [],
  }));
  return { data, loading, error: loopsError || error };
}
```

> Why `tasksKey` carries the ids: the commits effect must re-run when a task is added/removed in any window loop, but NOT on every score/testRun snapshot. Reading the tasks through `byScopeRef` (not a dep) keeps the effect keyed purely on that string. Note `tasks` here are ordered by `documentId()` (not `order`) — trends only use `scenarioIds`, so ordering is irrelevant, and it keeps the 4 listeners uniform.

- [ ] **Step 2: Type-check the web app**

Run: `cd web && npm run build`
Expected: clean (`tsc -b` passes; vite build succeeds). The hook is not wired anywhere yet — that's Task 6.

- [ ] **Step 3: Commit**

```bash
git add web/src/dashboard/useLoopTrend.ts
git commit -m "feat(web): useLoopTrend — bounded 20-loop fan-out + one-shot task-commit reads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Web — `TrendsStrip` + Dashboard wiring

Four labeled inline-SVG sparklines under `RollupStrip`: *Scenarios met*, *Avg composite*, *Bugs* (opened vs fixed, two strokes), *Tokens/loop* — each with min/max labels and the latest value. Hidden entirely under 2 points; caption "last N loops". `DashboardTab` stays a pure component (`ProjectDetail` runs the hook + `buildTrend` and passes points down), so the strip is fully testable without Firebase.

**Files:**
- Create: `web/src/dashboard/components/TrendsStrip.tsx`
- Modify: `web/src/dashboard/tabs/DashboardTab.tsx` (new `trendPoints` prop + render)
- Modify: `web/src/dashboard/ProjectDetail.tsx` (run hook, derive points, pass down, surface error)
- Modify: `web/src/index.css` (`.trends` block after `.rollup-status` ~line 1023)
- Test: `web/src/dashboard/components/trends.test.tsx`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/trends.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendsStrip } from "./TrendsStrip";
import type { TrendPoint } from "../trendView";

const pt = (i: number, over: Partial<TrendPoint> = {}): TrendPoint => ({
  loopId: `l${i}`, order: i, metCount: i, scenarioTotal: 4, avgComposite: 70 + i,
  bugsOpened: 2, bugsFixed: 1, tokensTotal: 100000 * i, ...over,
});

describe("TrendsStrip", () => {
  it("renders nothing with fewer than 2 points (no trend from one point)", () => {
    expect(render(<TrendsStrip points={[]} />).container.firstChild).toBeNull();
    expect(render(<TrendsStrip points={[pt(1)]} />).container.firstChild).toBeNull();
  });

  it("renders the 4 labeled sparklines (5 polylines: bugs has two strokes)", () => {
    const { container } = render(<TrendsStrip points={[pt(1), pt(2), pt(3)]} />);
    expect(container.querySelectorAll("svg")).toHaveLength(4);
    expect(container.querySelectorAll("polyline")).toHaveLength(5);
    expect(screen.getByText("Scenarios met")).toBeInTheDocument();
    expect(screen.getByText("Avg composite")).toBeInTheDocument();
    expect(screen.getByText("Bugs")).toBeInTheDocument();
    expect(screen.getByText("Tokens/loop")).toBeInTheDocument();
  });

  it("labels the window size and shows latest values (met as N/M, tokens compact)", () => {
    render(<TrendsStrip points={[pt(1), pt(2), pt(3)]} />);
    expect(screen.getByText("last 3 loops")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();      // latest metCount/scenarioTotal
    expect(screen.getByText("300.0k")).toBeInTheDocument();   // latest tokensTotal, compact
  });

  it("shows a dash for a null latest avgComposite", () => {
    render(<TrendsStrip points={[pt(1), pt(2, { avgComposite: null })]} />);
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- trends.test`
Expected: FAIL — `./TrendsStrip` does not exist.

- [ ] **Step 3: Implement the component**

`web/src/dashboard/components/TrendsStrip.tsx`:

```tsx
import type { TrendPoint } from "../trendView";
import { polylinePoints } from "../trendView";

const W = 120, H = 32;

/** Compact number label: 1234 → "1.2k", 2500000 → "2.5M". */
function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Sparkline({ label, series, latest, series2 }: {
  label: string; series: (number | null)[]; latest: string; series2?: (number | null)[];
}) {
  const nums = [...series, ...(series2 ?? [])].filter((v): v is number => v !== null);
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 0;
  return (
    <div className="trend">
      <span className="trend-label">{label}</span>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <polyline points={polylinePoints(series, W, H)} fill="none" strokeWidth="1.5" className="trend-line" />
        {series2 && <polyline points={polylinePoints(series2, W, H)} fill="none" strokeWidth="1.5" className="trend-line trend-line--alt" />}
      </svg>
      <span className="trend-minmax tnum dim">{fmt(min)}–{fmt(max)}</span>
      <span className="trend-latest tnum">{latest}</span>
    </div>
  );
}

/** Cross-loop trend sparklines. Hidden entirely under 2 points (no trend from one
 *  point); the caption labels the bounded window ("last N loops"). */
export function TrendsStrip({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  return (
    <section className="trends card">
      <div className="trends-row">
        <Sparkline label="Scenarios met" series={points.map((p) => p.metCount)}
          latest={`${latest.metCount}/${latest.scenarioTotal}`} />
        <Sparkline label="Avg composite" series={points.map((p) => p.avgComposite)}
          latest={latest.avgComposite === null ? "–" : fmt(latest.avgComposite)} />
        <Sparkline label="Bugs" series={points.map((p) => p.bugsOpened)} series2={points.map((p) => p.bugsFixed)}
          latest={`${latest.bugsOpened} open · ${latest.bugsFixed} fixed`} />
        <Sparkline label="Tokens/loop" series={points.map((p) => p.tokensTotal)}
          latest={fmt(latest.tokensTotal)} />
      </div>
      <div className="trends-caption dim">last {points.length} loops</div>
    </section>
  );
}
```

> The "3/4" assertion in Step 1 matches the met latest label; "Bugs" two-stroke latest renders as "2 open · 1 fixed" (a single text node, so it never collides with other numbers in getByText).

- [ ] **Step 4: Run the component tests**

Run: `cd web && npm test -- trends.test`
Expected: PASS.

- [ ] **Step 5: Wire into DashboardTab + ProjectDetail**

`web/src/dashboard/tabs/DashboardTab.tsx` — full new contents:

```tsx
import { RollupStrip } from "../components/RollupStrip";
import { LoopSnapshot } from "../components/LoopSnapshot";
import { TrendsStrip } from "../components/TrendsStrip";
import type { SelectableLoop } from "../loopView";
import type { TrendPoint } from "../trendView";
import type { Phase, Task, Scenario, Score, TestRun } from "../types";

export function DashboardTab({ loops, selected, status, phases, tasks, scenarios, scores, testRuns, trendPoints }: {
  loops: SelectableLoop[]; selected: SelectableLoop | undefined; status?: string;
  phases: Phase[]; tasks: Task[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[];
  trendPoints: TrendPoint[];
}) {
  return (
    <>
      <RollupStrip loops={loops} status={status} />
      <TrendsStrip points={trendPoints} />
      {selected && <LoopSnapshot loop={selected} phases={phases} tasks={tasks} scenarios={scenarios} scores={scores} testRuns={testRuns} />}
    </>
  );
}
```

`web/src/dashboard/ProjectDetail.tsx` — three edits:

1. Imports (add to the existing import block):

```tsx
import { useLoopTrend } from "./useLoopTrend";
import { buildTrend } from "./trendView";
```

2. After the `const allTestRuns = useAllTestRuns(teamId, slug);` line:

```tsx
  const trend = useLoopTrend(teamId, slug, hasProjectDirectData);
  // Empty until every slice arrives — TrendsStrip hides itself below 2 points,
  // so partial fan-out data never renders a misleading half-trend.
  const trendPoints = trend.loading ? [] : buildTrend(trend.data, scenarios.data);
```

3. Surface its error (extend the `dataError` chain) and pass the points down:

```tsx
  const dataError = loops.error || phases.error || tasks.error || scores.error || testRuns.error
    || revisions.error || bugs.error || allTestRuns.error || goals.error || scenarios.error || documents.error
    || trend.error || null;
```

```tsx
                {tab === "dashboard" && (
                  <DashboardTab loops={loopList} selected={selected} status={projStatus}
                    phases={phases.data} tasks={tasks.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data}
                    trendPoints={trendPoints} />
                )}
```

(Do NOT add trend loading to `tabLoading` — the dashboard must not block on the fan-out; the strip simply appears when ready.)

`web/src/index.css` — after the `.rollup-status` rule (~line 1023):

```css
.trends { display: flex; flex-direction: column; gap: 8px; }
.trends-row { display: flex; flex-wrap: wrap; gap: 20px; }
.trend { display: flex; flex-direction: column; gap: 2px; }
.trend-label { font-size: 11px; color: var(--fg-meta); text-transform: uppercase; letter-spacing: .08em; }
.trend-line { stroke: var(--accent); }
.trend-line--alt { stroke: var(--fg-meta); }
.trend-minmax { font-size: 11px; }
.trend-latest { font-size: 13px; color: var(--fg); font-weight: 600; }
.trends-caption { font-size: 11px; }
```

- [ ] **Step 6: Full web suite + build**

Run: `cd web && npm test && npm run build`
Expected: ALL web tests green (any pre-existing `DashboardTab` usage in tests must compile — if a test renders `DashboardTab` directly, add `trendPoints={[]}`; as of writing, no test does) and a clean build.

- [ ] **Step 7: Commit**

```bash
git add web/src/dashboard/components/TrendsStrip.tsx web/src/dashboard/components/trends.test.tsx \
  web/src/dashboard/tabs/DashboardTab.tsx web/src/dashboard/ProjectDetail.tsx web/src/index.css
git commit -m "feat(web): TrendsStrip — 4 cross-loop sparklines on the Dashboard tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Driver skill — Step 3b deploy-and-report + plugin bump + skill sync

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md` (Step 3b, between the close-the-loop bash block ending at line 189 and the "Print a brief…" paragraph at line 191)
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` (version `0.10.1` → `0.11.0`)
- Modify (generated): `web/public/skill/autoloop/SKILL.md` (via sync script)

- [ ] **Step 1: Add the deploy-and-report step to Step 3b**

In `plugins/autoloop/skills/autoloop/SKILL.md`, insert between the closing ` ``` ` of the "Close the loop" bash block (line 189) and the "Print a brief **"N/M scenarios met"** summary" paragraph (line 191):

````markdown
**Deploy a preview and report its URL** (best-effort, before the summary).
Deploy however **this project** deploys — do not assume a stack:

- Firebase-hosted project → the documented recipe is a preview channel:
  `firebase hosting:channel:deploy <loopId>` — copy the channel URL it prints.
- Anything else → use the project's own deploy/preview story (npm script, CI
  preview, static host, …).

```bash
autoloop loop set <loopId> --preview-url "<url>"   # the URL the deploy PRINTED
```

If the project has **no deploy story**, skip this step and say so in the
summary. **Never fabricate a URL** — only report a URL an actual deploy
printed. (`--preview-url ""` clears a stale link.)
````

- [ ] **Step 2: Bump the plugin version**

In `plugins/autoloop/.claude-plugin/plugin.json`: `"version": "0.10.1"` → `"version": "0.11.0"` (new skill behavior + new CLI flag = minor bump).

- [ ] **Step 3: Sync the skill copies and verify**

```bash
bash scripts/sync-autoloop-cli.sh
diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && echo SKILL-IDENTICAL
```

Expected: `✓ synced …` lines, then `SKILL-IDENTICAL`.

- [ ] **Step 4: Commit**

```bash
git add plugins/autoloop/skills/autoloop/SKILL.md plugins/autoloop/.claude-plugin/plugin.json web/public/skill/autoloop/SKILL.md
git commit -m "feat(skill): Step 3b deploys a preview and reports --preview-url; bump plugin to 0.11.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full gates

Everything green, every copy in sync, zero regression.

**Files:** none (verification only; commit anything the gates surface).

- [ ] **Step 1: Functions — build + full suite + rules**

```bash
cd functions && npm run build && npm test && npm run test:rules
```

Expected: build clean; ALL main-suite tests green (incl. `loops` and `cli.unit` from Tasks 1-2 and every pre-existing suite); rules suite green (no rules change in this feature — the loop doc was already member-readable).

- [ ] **Step 2: Web — full suite + build**

```bash
cd web && npm test && npm run build
```

Expected: ALL web tests green (trendView, trends.test, dashboard.test, loops.test, loopView.test + pre-existing); `tsc -b` + vite build clean.

- [ ] **Step 3: Copy-sync verification**

```bash
diff cli/autoloop.mjs plugins/autoloop/bin/autoloop \
  && diff cli/autoloop.mjs web/public/skill/autoloop.mjs \
  && diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md \
  && echo ALL-IN-SYNC
```

Expected: `ALL-IN-SYNC`.

- [ ] **Step 4: Working tree clean**

Run: `git status`
Expected: clean (everything committed in Tasks 1-7). If the gates required fixes, commit them:

```bash
git add -A
git commit -m "fix: gate fixes for preview-urls + trends

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Definition of done

- A loop can report a preview URL (`PUT …/loops/:loopId` with `previewUrl`; `autoloop loop set <id> --preview-url <url>`, `""` ⇒ null clear); invalid URLs 400; omitted field keeps docs byte-stable; `loop set` no longer requires `--status` and its terminal-status side effect (clearing `cfg.currentLoopId`) is unchanged.
- The Dashboard tab (LoopSnapshot) and Loops tab (LoopDetail) show "Open preview ↗" (`target="_blank" rel="noopener noreferrer"`), hidden when absent/null.
- With ≥2 loops, the Dashboard shows four trend sparklines (scenarios met, avg composite, bugs opened vs fixed, tokens/loop) derived per the spec rules — `deriveScenarioState` over loop-scoped subsets, tagged-scenario totals, task-commit token sums, `main` first — capped and labeled at 20 loops, hidden under 2 loops.
- `useLoopTrend`'s data layer (`LoopRunData` fan-out, `trendWindow`, one-shot task-commit reads) is cleanly exported for the product-map plan to reuse.
- The driver skill's Step 3b deploys a preview (stack-agnostic; Firebase channel deploy as the documented recipe), reports the URL, never fabricates one; plugin bumped to 0.11.0.
- Three CLI copies and the SKILL.md copies identical; functions build + full + rules suites green; web suite + build green; no rules change; no new collections.

## Out of scope (per spec)

- Screenshots / visual evidence on test-runs (needs Firebase Storage; future spec).
- Iframe embedding; preview lifecycle/expiry management.
- Cost-in-dollars conversion (token counts only).
- Server-side per-loop met history (derivation stays client-side; revisit only if the 20-loop fan-out becomes a measured problem).
- The other five batch plans (verification, ideas, vision-growth, product-map, resumable) — no dependency on them.
