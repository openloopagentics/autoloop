# Living Vision Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat vision list with a loop-authored wiki (`vision/` markdown pages with embedded goal/scenario blocks) synced to Firestore by the CLI, rendered in the dashboard Vision tab, with text-selection-anchored steering comments (advisory/blocking).

**Architecture:** Git is the source of truth: the loop writes `vision/**/*.md`; `autoloop vision sync` parses/validates locally (shared parser `cli/vision-pages.mjs`, mirrored like `vision-schema.mjs`), diffs by content hash, and upserts pages + extracted goals/scenarios through the existing REST import path. Comments live in a flat per-project Firestore `comments` collection (pageId field); users create them via the `/v1/u` ID-token API, the loop pulls/replies/resolves via the API-key CLI verbs. Scenario "met" suppression for blocking comments happens in the existing client-side derivation (`scenarioState.ts`/`whyModel.ts`).

**Tech Stack:** Node ESM (dependency-free CLI), Express + zod (functions), Firestore, React + react-markdown (web), vitest everywhere, mermaid (new web dep).

**Spec:** `docs/superpowers/specs/2026-07-08-living-vision-pages-design.md` — read it first.

**Conventions used throughout (read once):**
- Backend route/service/test patterns: clone from `functions/src/routes/goals.ts`, `functions/src/services/goals.ts` (check exact export names there), `functions/test/goals.test.ts`.
- CLI verb pattern: the `switch` in `cli/autoloop.mjs` `run()` — see `case "vision import"` (~line 1210) and `case "messages pull"` (~line 1260). Helpers: `loadConfig`, `resolveApiUrl`, `report`, `getJson`, `fetchJson`, `validateId`, `UsageError`, `oneFlag`.
- After ANY edit to `cli/autoloop.mjs` or `cli/vision-pages.mjs`: run `scripts/sync-autoloop-cli.sh` (and add the new file to that script in Task 1).
- Test commands: `cd functions && npx vitest run test/<file>` ; `cd web && npx vitest run src/<path>`.
- All new server ids are ULIDs via `functions/src/ulid.ts`; all client-supplied ids match `idPattern` in `functions/src/schemas.ts`.
- Firestore rules need **no change**: `match /projects/{slug} { match /{document=**} { allow read: if isMember(teamId); allow write: if false; } }` already covers `pages` and `comments` (reads for members, writes API-only).

---

### Task 1: Shared parser `cli/vision-pages.mjs`

The single novel-logic module: parse a set of markdown files into pages + extracted goals/scenarios, with local validation. Reuses `validateVision` from `cli/vision-schema.mjs` for block semantics (DRY).

**Files:**
- Create: `cli/vision-pages.mjs`
- Test: `functions/test/vision-pages.test.ts` (mirror the import style of `functions/test/vision-schema.test.ts`, which imports the module from `../../cli/`)
- Modify: `scripts/sync-autoloop-cli.sh` (mirror the new file next to the `vision-schema.mjs` cp lines: to `plugins/autoloop/bin/vision-pages.mjs` and `web/public/skill/vision-pages.mjs`)

**Public API (lock this exactly):**

```js
/** files: [{ path: "overview.md" | "auth/passkeys.md", text: string }]
 *  Returns { ok:true, pages, goals, scenarios } or { ok:false, errors:[{file,line,message}] }.
 *  pages: [{ id, path, title, order, markdown, contentHash, goalIds, scenarioIds }]
 *  goals/scenarios: exactly the shapes vision-schema.mjs validates (scenario keeps `test` — callers strip it before upload, same as `vision import`). */
export function parsePages(files) { ... }

/** Body text of a fenced block: JSON.parse first; on failure, restricted YAML subset. */
export function parseBlockBody(text) { ... }
```

**Parsing rules (implement exactly):**
- Frontmatter: file starts with `---\n`, ends at next `---` line. Keys `id` (required, must match `ID_RE` from vision-schema — import it or re-declare `/^[a-z0-9._-]+$/`), `title` (required non-empty), `order` (optional integer, default 0). Parsed with the same subset parser.
- `markdown` = everything after frontmatter, verbatim (fenced blocks stay in it — the dashboard renders them as cards).
- Fenced blocks: a line ` ```goal ` or ` ```scenario ` (allow trailing whitespace) opens; the next ` ``` ` line closes. Unclosed fence ⇒ error at the opening line.
- YAML subset (documented in the module header): `key: value` maps; nesting by 2-space indent; `- ` list items (scalar or inline JSON); scalar coercion: `true/false`, integers, floats, else string (strip matching quotes); inline `{...}`/`[...]` values parsed as JSON. That covers every shape in the spec's example. Anything else ⇒ parse error with line number. JSON bodies short-circuit via `JSON.parse`.
- Validation (all collected, not first-fail): duplicate page ids across files; page markdown > `100 * 1024` bytes ("page exceeds 100KB — split it"); then assemble `{goals, scenarios}` from all blocks and run `validateVision` from `./vision-schema.mjs`, mapping each error to the file+line of the offending block (keep a blockIndex→{file,line} map; `validateVision` errors are indexed like `scenarios[2].goalId ...` — parse the index out with a regex).
- `contentHash`: `createHash("sha256").update(markdown).digest("hex")` from `node:crypto`.
- `goalIds`/`scenarioIds`: ids of blocks in that page (page-wide blocking comments resolve against `scenarioIds` — see Task 3/7).

**Steps:**

- [ ] **Step 1: Write failing tests** in `functions/test/vision-pages.test.ts`. Cases (one `it` each): valid page with frontmatter + one goal + one scenario (JSON body) → correct page fields, hash stable, goalIds/scenarioIds extracted; YAML body variant of the same scenario (nested `rubric.criteria` with inline-JSON list items) parses identically to the JSON body; missing frontmatter `id` → error with file+line 1; duplicate page id across two files → error naming both files; duplicate scenario id across two pages → error; dangling `goalId` → error (from validateVision) mapped to the block's file+line; unclosed fence → error at opening line; >100KB page → error; `order` defaults to 0; `parseBlockBody` scalar coercion (true/42/quoted string).
- [ ] **Step 2: Run tests, verify failure** — `cd functions && npx vitest run test/vision-pages.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `cli/vision-pages.mjs`** per the rules above. Keep it dependency-free (node builtins only), single file, ~250 lines.
- [ ] **Step 4: Run tests, verify pass.** Also run `npx vitest run test/vision-schema.test.ts` (untouched, must still pass).
- [ ] **Step 5: Add the mirror lines to `scripts/sync-autoloop-cli.sh`** (cp to `plugins/autoloop/bin/` and `web/public/skill/`), run it, confirm the two copies exist.
- [ ] **Step 6: Commit** — `feat(cli): vision-pages parser (wiki pages + embedded goal/scenario blocks)`

---

### Task 2: Backend — `pages` resource

**Files:**
- Create: `functions/src/services/pages.ts`, `functions/src/routes/pages.ts`
- Modify: `functions/src/schemas.ts` (add `pageBody`), `functions/src/app.ts` (mount `teamRouter.use("/:slug/pages", pagesRouter)` next to the `documents` mount, line ~52)
- Test: `functions/test/pages.test.ts` (clone the harness from `functions/test/documents.test.ts`)

**Contract:**
- `PUT /v1/teams/:teamId/projects/:slug/pages/:pageId` body `{ path, title, order, markdown, contentHash, goalIds, scenarioIds }` — zod: `path`/`title` non-empty strings, `order` int, `markdown` string ≤ `CONTENT_MAX_BYTES` (reuse the existing constant in `schemas.ts:11`), `contentHash` `/^[a-f0-9]{64}$/`, `goalIds`/`scenarioIds` arrays of `idPattern` strings. Upsert with `updatedAt: FieldValue.serverTimestamp()`. Doc path `teams/{t}/projects/{s}/pages/{pageId}`.
- `GET /v1/teams/:teamId/projects/:slug/pages` → `{ ok, pages: [{ id, contentHash }] }` (the sync diff endpoint — deliberately minimal).
- `DELETE /v1/teams/:teamId/projects/:slug/pages/:pageId` → deletes the doc only (comments live in the project-level `comments` collection and survive; Task 3).
- No `assertWebEditable` anywhere — pages are always loop-owned by design.

**Steps:**

- [ ] **Step 1: Failing tests** in `pages.test.ts`: PUT creates doc with all fields + timestamp; PUT again updates; GET lists `{id, contentHash}` only; DELETE removes; validation 400s (bad hash, oversized markdown, bad id in `scenarioIds`); wrong-team API key → the same 403 the documents tests assert.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** schema + service + route + app.ts mount, cloning documents' structure.
- [ ] **Step 4: Run `pages.test.ts` + `npx vitest run test/app-init.test.ts` → PASS.**
- [ ] **Step 5: Commit** — `feat(functions): pages resource (wiki page upsert/list/delete)`

---

### Task 3: Backend — `comments` resource (agent + user halves)

**Files:**
- Create: `functions/src/services/comments.ts`, `functions/src/routes/comments.ts`
- Modify: `functions/src/schemas.ts` (`commentBody`, `commentReplyBody`, `commentResolveBody`), `functions/src/app.ts` (mount `teamRouter.use("/:slug/comments", commentsRouter)`), `functions/src/routes/userProjects.ts` (user create + accept)
- Test: `functions/test/comments.test.ts`

**Data model** — flat collection `teams/{t}/projects/{s}/comments/{ulid}`:

```ts
{ pageId: string, anchor: { exact: string, prefix: string, suffix: string },
  targetScenarioId?: string,            // stamped by the web client at creation; immutable
  body: string, author: string,          // uid
  severity: "advisory" | "blocking",
  status: "open" | "resolved" | "declined",
  accepted?: boolean,                    // blocking only; set by accept endpoint
  thread: Array<{ by: "user" | "agent", text: string, at: Timestamp }>,
  createdAt, resolvedAt?, acceptedBy? }
```

**Blocking rule (single source of truth, used by Task 7):** a scenario is *blocked* iff some comment has `severity === "blocking"` and NOT (`status !== "open"` AND `accepted === true`) and targets it (`targetScenarioId === s.id`, or no `targetScenarioId` and the comment's page's `scenarioIds` contains `s.id`). I.e. resolution alone doesn't unblock — acceptance does.

**Endpoints:**
- Agent (API key, `comments.ts`): `GET /` (`?status=open` filter; returns full docs, ULID-ordered like `listPendingUserMessages`); `POST /:id/reply { text }` → appends `{by:"agent", text, at}` to `thread`; `POST /:id/resolve { resolution: "resolved"|"declined", note? }` → sets status (+ optional final thread entry), `resolvedAt`. Reply/resolve on unknown id → 404 (`AppError(404, "not_found", ...)`); resolve on already-resolved → 200 no-op (races: mirror `ackMessage`'s guard style).
- User (ID token, `userProjectsRouter` additions — **no `assertWebEditable`**, same rationale as the ideas veto, cite it in a comment): `POST /:slug/comments` body = `{ pageId, anchor, body, severity, targetScenarioId? }` (zod: anchor strings, `exact` non-empty ≤ 2000, prefix/suffix ≤ 200, body non-empty ≤ 10_000, severity enum, ids `idPattern`); author = `req.uid`. `POST /:slug/comments/:id/accept` → only for `severity === "blocking"`: allowed if `req.uid === author` OR requester's team role is owner/admin (fetch `teams/{t}/members/{uid}` like the project-delete handler at `userProjects.ts:44` — but do NOT copy its role strings: that handler checks `"manager"`, which is not a real role; valid roles are `owner | admin | member`, see `web/src/teams/types.ts` and the `isManager` rule in `firestore.rules`); sets `accepted: true, acceptedBy: uid`. Accept on advisory → 400; on unknown → 404.

**Steps:**

- [ ] **Step 1: Failing tests**: user create → doc shape + author uid; agent GET returns it; `?status=open` excludes resolved; reply appends thread entry; resolve sets status/resolvedAt; resolve twice → ok no-op; accept by author → accepted; accept by admin → accepted; accept by non-author member → 403; accept advisory → 400; user create with oversized body → 400.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (schemas → service → agent router → app mount → userProjects handlers).
- [ ] **Step 4: Run `comments.test.ts` + `userProjects.test.ts` → PASS.**
- [ ] **Step 5: Commit** — `feat(functions): steering comments (user create/accept, agent pull/reply/resolve)`

---

### Task 4: CLI — `vision sync` + `vision migrate`

**Files:**
- Modify: `cli/autoloop.mjs` (two new `case`s in the verb switch, next to `case "vision import"`; add both verbs to the usage/help text where the existing verbs are listed)
- Test: extend `functions/test/cli.unit.test.ts` (same mocked-`fetchImpl` style as the `vision import` tests there)

**`vision sync [--dir vision] [--strict] [--url ...]`:**
1. Recursively read `*.md` under `--dir` (default `vision/`) via `readdirSync(dir, { recursive: true })`; path stored relative to the dir, forward slashes. No dir or zero files → `UsageError("no vision pages found in 'vision/' — author pages or run vision migrate")`.
2. `parsePages(files)` (import `./vision-pages.mjs`). On `ok:false`: print each error as `file:line: message` via `err()`, return 1. **Nothing uploads.**
3. `getJson(GET .../pages)` → server `{id, contentHash}` list. (Network failure: non-strict → warn + treat as empty like other best-effort reads; strict → fail.)
4. For each parsed page whose hash differs or is new: `report(PUT .../pages/:id, body)` (body = page minus `id`). For each server id not on disk: `report(DELETE .../pages/:id)`.
5. Upsert extracted goals, then scenarios through the **existing** endpoints, exactly like `case "vision import"` does — including the `{ id, test, ...body }` strip of the loop-local `test` field. Track `worst` across all reports; return it.

**`vision migrate [--file vision.json] [--dir vision]`:** read+`JSON.parse` the vision file (reuse the read/error style of `vision import`); refuse if `--dir` already exists (`UsageError`). Write `overview.md` (frontmatter id `overview`, title from project, body listing goal titles) and one `<goal.id>.md` per goal: frontmatter (id = goal id, title, order), goal description as prose, a ` ```goal ` block (JSON body — valid input to the parser per spec), then each of its scenarios as prose paragraph (description) + ` ```scenario ` block (JSON, **keeping** `test` — it's loop-local and stays in the repo). Then print `migrated N pages — review, commit, and run: autoloop vision sync`. Purely local: no network.

**Steps:**

- [ ] **Step 1: Failing tests**: sync with a tmp-dir fixture of 2 valid pages + empty server list → PUTs 2 pages + goals/scenarios (assert `test` stripped from scenario body, and page body carries contentHash/scenarioIds); sync again with server hashes matching → zero page PUTs (still upserts goals/scenarios — idempotent); server has an extra id → DELETE issued; parse error → exit 1 and `fetchImpl` never called; missing dir → UsageError; migrate golden test: fixture vision.json → expected files exist, re-parsing them with `parsePages` round-trips the same goal/scenario ids, and migrate onto an existing dir → UsageError.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement both cases.**
- [ ] **Step 4: Run `cli.unit.test.ts` (whole file) → all pass including the existing 139.**
- [ ] **Step 5: Run `scripts/sync-autoloop-cli.sh`; commit** — `feat(cli): vision sync + vision migrate (repo wiki → dashboard)`

---

### Task 5: CLI — `comments pull|reply|resolve`

**Files:**
- Modify: `cli/autoloop.mjs` (+ usage text)
- Test: extend `functions/test/cli.unit.test.ts`

Clone the `messages` verb family exactly (~line 1260):
- `comments pull [--check]` → `GET .../comments?status=open`; `--check`: exit 0 iff non-empty array (silent, GET-only — for the wake shim, same semantics as `messages pull --check`); otherwise `fetchJson` prints the JSON.
- `comments reply <id> --text <t>` → `POST .../comments/<id>/reply`; missing id/text → UsageError.
- `comments resolve <id> [--declined] [--note <t>]` → `POST .../comments/<id>/resolve` body `{ resolution: flags.declined ? "declined" : "resolved", ...(flags.note && { note: flags.note }) }`.

**Steps:**

- [ ] **Step 1: Failing tests**: pull hits the right URL with `?status=open`; `--check` exit codes (has comments → 0, none → 1, network error → 1); reply/resolve URL+body shape; resolve `--declined`; missing args → UsageError. Mirror the assertions style of the existing messages verb tests.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run full `cli.unit.test.ts` → PASS.**
- [ ] **Step 5: Run `scripts/sync-autoloop-cli.sh`; commit** — `feat(cli): comments pull/reply/resolve steering verbs`

---

### Task 6: Web — types, hooks, api

**Files:**
- Modify: `web/src/dashboard/types.ts` (add `Page`, `PageComment`, `CommentThreadEntry` interfaces matching Task 2/3 shapes — timestamps as `unknown` like the rest of the file), `web/src/dashboard/hooks.ts` (add `usePages(teamId, slug)` ordered by `orderBy("order")` and `useComments(teamId, slug)` ordered by `orderBy(documentId())` — clone `useDocuments`/`useMessages` at lines ~185/~314), `web/src/dashboard/api.ts` (add `postComment(teamId, slug, body)` → `POST /comments`; `acceptComment(teamId, slug, id)` → `POST /comments/${id}/accept` — clone `postMessage`)
- Test: extend `web/src/dashboard/hooks.test.tsx` with the collection-path assertions used for the existing hooks.

**Steps:**

- [ ] **Step 1: Failing hook tests** (paths `teams/T/projects/S/pages`, `.../comments`). **Step 2: FAIL. Step 3: Implement. Step 4: PASS** (`cd web && npx vitest run src/dashboard/hooks.test.tsx`).
- [ ] **Step 5: Commit** — `feat(web): pages/comments types, listeners, api calls`

---

### Task 7: Web — blocking suppression in scenario derivation

**Files:**
- Create: `web/src/dashboard/blockedScenarios.ts`
- Modify: `web/src/dashboard/scenarioState.ts`, `web/src/dashboard/whyModel.ts` (`explainScenario` — find its 3-condition rule and add the fourth)
- Test: create `web/src/dashboard/blockedScenarios.test.ts`; extend `scenarioState.test.ts`

**`blockedScenarios.ts` (pure):**

```ts
import type { Page, PageComment } from "./types";
/** Spec §2: blocking && !(resolved && accepted); target = stamped scenario id,
 *  else every scenario on the comment's page. */
export function blockedScenarioIds(comments: PageComment[], pages: Page[]): Set<string> {
  const byPage = new Map(pages.map((p) => [p.id, p.scenarioIds ?? []]));
  const out = new Set<string>();
  for (const c of comments) {
    if (c.severity !== "blocking") continue;
    if (c.status !== "open" && c.accepted === true) continue;
    for (const id of c.targetScenarioId ? [c.targetScenarioId] : (byPage.get(c.pageId) ?? [])) out.add(id);
  }
  return out;
}
```

**Wiring:** add an optional trailing `blockedIds?: Set<string>` param to `explainScenario` and `scenarioStatus`/`summarize`; when the scenario is in the set, state is `"unmet"` and a new reason kind `"blocked"` (extend the `ExplanationReason` union; check how existing reasons carry labels and follow suit) is prepended. Existing call sites compile unchanged (param optional); only the Vision tab (Task 10) passes it — deliberate scope choice: v1 shows blocking in the wiki, not in Map/Loops (note this in the code comment).

**Steps:**

- [ ] **Step 1: Failing tests**: open blocking + targetScenarioId → blocked; resolved-but-unaccepted → still blocked; resolved+accepted → unblocked; declined+accepted → unblocked; advisory → never; page-wide (no target) blocks all `scenarioIds` of that page; deleted page (comment's pageId not in pages) with no target → blocks nothing; `scenarioStatus` with blocked id → `unmet` + `blocked` reason even when score/test would pass.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: Run `blockedScenarios.test.ts`, `scenarioState.test.ts`, `whyModel.test.ts` → PASS.**
- [ ] **Step 5: Commit** — `feat(web): blocking comments suppress scenario met`

---

### Task 8: Web — wiki reader (nav + page render + live scenario cards + mermaid)

**Files:**
- Create: `web/src/dashboard/wiki/navTree.ts` (pure: `Page[]` → tree by `path` segments, siblings by `order` then title; missing intermediate dirs get synthetic nodes), `web/src/dashboard/wiki/WikiNav.tsx`, `web/src/dashboard/wiki/WikiPage.tsx`, `web/src/dashboard/wiki/Mermaid.tsx`
- Modify: `web/package.json` (add `mermaid`)
- Test: `web/src/dashboard/wiki/navTree.test.ts`, `web/src/dashboard/wiki/wiki.test.tsx` (component tests, clone setup from `web/src/dashboard/components/vision.test.tsx`)

**WikiPage rendering:** render `page.markdown` with the existing `Markdown.tsx` pipeline (`web/src/dashboard/components/Markdown.tsx`) — note it currently hardcodes its `components` map (only an `a` override), so first add an optional `components` prop that merges over the defaults (existing call sites unchanged). Then extend via react-markdown's `components.code` override: fence language `scenario` / `goal` → `parseBlockBody` (import from `web/public/skill/vision-pages.mjs`? No — **import from the repo path is not possible in web**; instead add `web/src/dashboard/wiki/blockBody.ts`, a TS port of `parseBlockBody` ONLY (JSON-first + subset), with a comment pointing at `cli/vision-pages.mjs` as canonical; ~60 lines, its own small test) → scenario fences render the existing `ScenarioCard` (reuse `web/src/dashboard/components/ScenarioCard.tsx` — check its props and feed it `scenarioStatus(...)` with the blocked set) with a red "blocked" badge when blocked; goal fences render a compact goal header; language `mermaid` → `<Mermaid code={...}/>` (lazy `import("mermaid")`, render to SVG in a `useEffect`, parse-error → `<pre>` fallback showing the code — never crash the page); all other fences → default rendering.
- Unknown/malformed block body → render the fence as a plain code block plus a small "invalid block" note (never crash).
- Nav: tree + a roll-up header "N of M scenarios met" AND a per-goal met count chip on each page node that has scenarios (spec §3 asks for met counts per goal; compute from that page's `scenarioIds` with `scenarioStatus` + blocked set) + "unanchored comments" project-level section stub (populated in Task 9).

**Steps:**

- [ ] **Step 1: Failing tests**: navTree (nested paths, order sort, synthetic dirs); wiki.test.tsx — page with a scenario fence renders a ScenarioCard title; met state flows from scores/testRuns props; blocked scenario shows badge; mermaid fence renders the Mermaid component (mock the dynamic import); malformed scenario block → "invalid block" note; blockBody.ts port parses the same YAML-subset fixtures as Task 1.
- [ ] **Step 2: FAIL. Step 3: Implement** (`npm install mermaid` in `web/`). **Step 4: PASS** (`npx vitest run src/dashboard/wiki/`).
- [ ] **Step 5: Commit** — `feat(web): wiki reader — nav tree, page render, live scenario cards, mermaid`

---

### Task 9: Web — text-selection comments UI

**Files:**
- Create: `web/src/dashboard/wiki/anchor.ts` (pure), `web/src/dashboard/wiki/CommentPopover.tsx`, `web/src/dashboard/wiki/CommentSidebar.tsx`
- Modify: `web/src/dashboard/wiki/WikiPage.tsx` (selection handling + highlights), `web/src/dashboard/wiki/WikiNav.tsx` (orphaned-on-deleted-pages section)
- Test: `web/src/dashboard/wiki/anchor.test.ts`, extend `wiki.test.tsx`

**`anchor.ts` (pure, the testable core):**

```ts
export interface Anchor { exact: string; prefix: string; suffix: string; }
/** Build from a selection inside pageText: exact = selected, prefix/suffix = up to 64 chars context. */
export function makeAnchor(pageText: string, start: number, end: number): Anchor
/** Locate in (possibly edited) pageText. Exact unique match → that range; multiple matches →
 *  the one whose surrounding text best matches prefix/suffix (score by shared char length);
 *  no match → null (orphaned). */
export function locateAnchor(pageText: string, a: Anchor): { start: number; end: number } | null
```

**Component behavior:**
- `pageText` = `textContent` of the rendered page container (ref). On `mouseup` with a non-collapsed selection inside it: compute offsets via `Range`→container text offsets, show `CommentPopover` (textarea + advisory/blocking toggle, default advisory + Submit → `postComment` with `{ pageId, anchor, body, severity, targetScenarioId }`). `targetScenarioId`: stamped iff the selection lies inside a rendered scenario card — mark each card's wrapper with `data-scenario-id` and walk `selection.anchorNode.parentElement.closest("[data-scenario-id]")`.
- Highlights: CSS Custom Highlight API (`CSS.highlights.set("wiki-comments", new Highlight(...ranges))`) for located anchors — no DOM mutation, degrade silently where unsupported (`typeof Highlight === "undefined"` guard). Margin markers: absolutely-positioned dots at each located range's bounding rect.
- `CommentSidebar`: threads for the current page — anchored section (open first, then resolved), "unanchored" section (locateAnchor → null), thread view (body + replies + status chip), Accept button on blocking comments per Task 3 rules (author or admin — team role is available where ProjectDetail reads membership; check how other admin-gated UI does it and reuse), red badge count in the nav for open blocking comments.
- Nav: comments whose `pageId` matches no live page → project-level "unanchored" section at the bottom of the nav tree (spec §3).

**Steps:**

- [ ] **Step 1: Failing anchor tests**: round-trip make→locate on unedited text; text edited elsewhere → still located; duplicated exact text → prefix/suffix disambiguates; deleted passage → null; empty selection rejected.
- [ ] **Step 2: FAIL. Step 3: Implement anchor.ts. Step 4: PASS.**
- [ ] **Step 5: Failing component tests**: popover appears on simulated selection (jsdom: mock `window.getSelection`); submit posts the right body (spy on api module); blocking comment shows Accept for author, hides for non-author member; unanchored comment lands in the unanchored section; deleted-page comment shows in nav section.
- [ ] **Step 6: FAIL. Step 7: Implement components. Step 8: PASS (`npx vitest run src/dashboard/wiki/`).**
- [ ] **Step 9: Commit** — `feat(web): text-selection steering comments (anchors, popover, sidebar, accept)`

---

### Task 10: Web — Vision tab switchover (+ legacy fallback)

**Files:**
- Create: `web/src/dashboard/tabs/VisionWikiTab.tsx` (composes WikiNav + WikiPage + CommentSidebar; scenario-status props plumbed like the current `VisionTab`)
- Modify: `web/src/dashboard/tabs/VisionTab.tsx` (if `pages.length > 0` render `VisionWikiTab`, else the existing list view untouched — spec §4 legacy rule), `web/src/dashboard/ProjectDetail.tsx` (call `usePages`/`useComments`, pass down; add pages to the tab's loading condition like the `map` tab at line ~101)
- Test: extend `web/src/dashboard/components/vision.test.tsx`

**Steps:**

- [ ] **Step 1: Failing tests**: with pages → wiki nav rendered, old list absent; without pages → existing list view (existing assertions keep passing); scenario met counts in the wiki roll-up reflect the blocked set.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: Run the whole web suite — `cd web && npx vitest run` → PASS (this is the integration gate; fix any fallout).**
- [ ] **Step 5: Commit** — `feat(web): Vision tab renders the wiki (legacy list fallback)`

---

### Task 11: Skills, plugin bump, docs

**Files:**
- Modify: `plugins/autoloop/skills/autoloop-vision/SKILL.md` — interview now writes the initial **wiki** (`vision/` pages, overview + goal pages with embedded blocks, YAML-or-JSON bodies), ends with `autoloop vision sync`; `vision.json`+`vision import` documented as the legacy path; mention `vision migrate`.
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md` — loop contract additions: run `vision sync` wherever the skill currently reports iteration/commit progress and after any vision revision (sync failure = treat like a failing test: fix pages, re-sync, don't proceed); add the comments-triage step at each iteration boundary — `comments pull`, then for EVERY open comment exactly one of revise (edit pages/blocks, resolve with a note pointing at the change), act (spawn task/idea, reply with plan, resolve when done), decline (reply why, `resolve --declined`); blocking comments are prioritized and suppress met until the author/admin accepts.
- Modify: `plugins/autoloop/skills/autoloop-reporting/SKILL.md` + `CODEX.md` — add the three comments verbs and `vision sync` to the CLI verb list they document.
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` — version `0.19.0` → `0.20.0`.
- Modify: `web/src/routes/GettingStarted.tsx` — step 4 wording: `/autoloop-vision` writes "a `vision/` wiki — pages describing the product with goals and scenarios embedded" instead of "a `vision.json`"; step 5 dashboard blurb already mentions tabs — add "comment on any Vision page to steer the loop".
- Run: `scripts/sync-autoloop-cli.sh` (propagates SKILL.md copies).
- Test: `cd web && npx vitest run src/routes/screens.test.tsx`; `cd functions && npx vitest run` (full backend+CLI suite, final gate).

**Steps:**

- [ ] **Step 1: Edit the four skill/docs files + plugin.json.**
- [ ] **Step 2: Run `scripts/sync-autoloop-cli.sh`; verify `git status` shows the mirrored copies updated.**
- [ ] **Step 3: Run both full test suites → PASS.**
- [ ] **Step 4: Commit** — `feat(plugin): wiki-vision loop contract, comments triage, 0.20.0`

---

## Execution notes

- Tasks 1→5 are backend/CLI and independent of 6→10 (web) after Task 1; within each track, order matters as written. Task 11 last.
- Every task ends with the full relevant suite green, not just the new tests.
- YAGNI guards: no GitHub webhooks, no user page-editing, no raw-HTML blocks, no Map/Loops blocking badges (v1 scope is the Vision tab), no comment notifications beyond the existing dashboard listeners.
