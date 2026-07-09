# Living vision pages — design

**Date:** 2026-07-08
**Status:** Approved by user (brainstorming session)

## Problem

The vision is a flat list of goals and scenarios (`vision.json`). The loop mechanics
built on it work well, but the list conveys *what we are building and why* poorly, and
it becomes unmanageable as the product grows. Users also lack a precise way to steer
the loop from the artifact that describes the product.

## Decision summary

The vision becomes a **loop-authored wiki**: a tree of markdown pages in the project
repo that deeply describe what is being built and how, updated by the loop as it works.
Goals and scenarios are embedded in the pages as structured blocks (hybrid model — one
artifact, narrative for humans, structure for the loop). The wiki replaces the Vision
tab in the dashboard. Users steer by leaving Google-Docs-style text-selection comments;
comments are advisory by default, with an optional **blocking** flag per comment.

Decisions made during brainstorming:

| Question | Decision |
|---|---|
| Pages vs structured vision | Hybrid: pages with embedded goal/scenario blocks; blocks are the same schema as today |
| Authorship | Loop writes pages; users steer only through comments |
| Steering strength | Advisory by default; user may flag a comment blocking |
| Page tree | Fully loop-decided (wiki-style, no prescribed skeleton) |
| Placement | Replaces the dashboard Vision tab |
| Comment anchoring | Text-selection anchored (quote + prefix/suffix), with orphan fallback |
| Page format | Markdown + typed fenced blocks (scenario, goal, mermaid); no raw HTML |
| Storage | Approach A: repo-native (`vision/` directory), synced to Firestore by the CLI; git is source of truth, Autoloop holds the render copy |

## 1. Repo format & data model

### On disk

- `vision/` directory in the project repo; every `.md` file is a page; the directory
  tree is the nav tree.
- Page frontmatter: `id` (immutable slug — survives file moves/renames; comments and
  Firestore key on it), `title`, `order` (position among siblings).
- Goals and scenarios are authored as fenced blocks (```goal, ```scenario) inside the
  prose, where they belong narratively. **Block schema is unchanged from `vision.json`**
  — same ids, `goalId` references, rubrics, thresholds, `test.command` — so scoring,
  Tests tab, Loops tab, and Map need zero changes.
- Mermaid diagrams and images are ordinary markdown.

Example page:

````markdown
---
id: passkey-login
title: Passkey login
order: 2
---
Users should never type a password.

```scenario
id: auth-passkey-login
goalId: auth
title: Sign in with a passkey
threshold: 70
rubric:
  criteria:
    - { id: works, name: Registration + login round-trip, weight: 3, max: 5 }
test: { command: "npm run test:e2e -- passkey" }
```
````

### In Firestore

- New per-project `pages` collection: `{ id, path, title, order, markdown,
  contentHash, updatedAt }`.
- Goals and scenarios stay in their existing collections; sync extracts them from
  blocks and upserts through the existing import path.
- New per-page `comments` collection: `{ id, pageId, anchor: { exact, prefix, suffix },
  body, author, severity: advisory|blocking, status: open|resolved|declined,
  thread: [replies], createdAt, resolvedAt, acceptedBy }`.

### Back-compat / migration

- `vision.json` remains supported for existing projects.
- One-time `autoloop vision migrate` generates the initial wiki from `vision.json`
  (overview page + one page per goal with its scenarios embedded).
- Projects with no `pages` collection keep the current list-view Vision tab; the wiki
  view takes over after the first sync. No forced migration.

## 2. Sync & the loop contract

### `autoloop vision sync`

- Walks `vision/**/*.md`; parses frontmatter + fenced blocks with a shared parser
  module (`vision-pages.mjs`), mirrored into `plugins/autoloop/` and
  `web/public/skill/` the same way `vision-schema.mjs` is today.
- Validates locally before uploading anything: duplicate page/scenario ids, dangling
  `goalId`s, malformed rubrics, oversized pages → fail fast with `file:line` errors.
- Diffs `contentHash` per page against the server; upserts only changed pages; deletes
  server pages whose files are gone (their comments survive as orphaned).
- Extracted goals/scenarios upsert through the existing import path.
- Runs at the same moments the loop reports today: after authoring/revising the vision
  and at each iteration/commit report. Dashboard is at most one iteration stale, and
  every synced snapshot corresponds to a real commit.

### Comments flowing down

- `autoloop comments pull` (sibling of `messages pull`): returns open comments with
  page, anchor quote, surrounding context, severity, and thread history.
- Loop contract adds a triage step at each iteration boundary — every open comment gets
  exactly one of:
  1. **revise** — update the page and/or blocks; resolve with a note pointing at what
     changed;
  2. **act** — spawn a task/idea; reply with the plan; resolve when done;
  3. **decline** — reply explaining why not; resolve as declined.
- `autoloop comments reply|resolve` handle the upstream half. Nothing sits
  unacknowledged (same discipline as messages).

### Blocking semantics

- A blocking comment sets `blocked` on its target: anchor inside a scenario block →
  that scenario; anywhere else on the page → every scenario on that page.
- A blocked scenario cannot be **met** regardless of score/test state — enforced in the
  same backend/derivation code that computes met today.
- Only the comment author or a team admin accepting the resolution clears the block.
- The loop sees blocks in `comments pull` and prioritizes them.

### Vision authoring

- `/autoloop-vision` changes from "interview → write vision.json" to "interview →
  write the initial wiki": an overview page telling the product story, plus goal pages
  with scenario blocks woven into prose.

## 3. Dashboard: rendering & comments

- **Vision tab becomes a wiki reader**: left nav tree (from `path`/`order`), rendered
  page view. Mermaid blocks render as diagrams. `scenario` blocks render as **live
  cards** — title, met/unmet, current score vs threshold, last test run — reusing the
  existing state derivation. A compact all-scenarios index (met counts per goal) sits
  at the top of the nav.
- **Text-selection comments**: select text → comment popover. Anchor stored as
  `{ exact, prefix, suffix }` (~64 chars context each side). Locate at render time:
  exact match first, then prefix/suffix-assisted fuzzy match. Anchored comments show as
  highlights with margin markers; a right-hand sidebar lists the page's threads.
- **Orphaning**: when a rewrite breaks an anchor, the comment drops to an "unanchored"
  sidebar section — still open, still requiring triage. `comments pull` always includes
  the original quoted text so the loop can still act. Re-anchoring is client-side only;
  never fatal.
- **Threads & steering UI**: thread per comment (user → loop replies → resolution
  state), Accept step for blocking comments, severity toggle on the composer (default
  advisory), red badge on affected scenario cards and in the nav for blocking comments.
  Loop replies arrive in real time via Firestore listeners (same mechanics as Messages).
- **Permissions**: commenting requires team membership (any role); accepting a blocking
  comment's resolution requires the comment author or a team admin; read access
  unchanged.

## 4. Error handling

- **Parse/validation failures**: `vision sync` fails atomically with `file:line`
  errors; nothing uploads; the loop treats it like a test failure (fix, re-sync).
- **Sync interruption**: per-page upserts are idempotent (keyed on page `id`, guarded
  by `contentHash`); a killed sync resumes on the next run.
- **Size limits**: existing 100KB-per-document cap applies per page; sync rejects
  oversized pages locally with a "split this page" error.
- **Anchor failures**: never fatal — worst case unanchored-but-open (see §3).
- **Comment API races**: last-write-wins + status guards, as messages ack today
  (resolving an already-resolved thread is a no-op).
- **Legacy projects**: no `pages` collection → current list view renders untouched.

## 5. Testing

- **Parser** (`vision-pages.mjs`): unit tests in `functions/test` alongside existing
  CLI tests — frontmatter, fenced blocks, duplicate ids, dangling goalIds, oversized
  pages, malformed markdown. Shared module ⇒ CLI and server behavior tested once.
- **CLI verbs** (`vision sync`, `comments pull/reply/resolve`): mocked-fetch unit tests
  like the existing CLI suite — diff-by-hash, atomic failure, idempotent re-run.
- **Anchoring**: pure-function tests for locate/re-anchor/orphan against edited-text
  cases (moved paragraph, reworded sentence, deleted section).
- **Blocked-scenario derivation**: blocking comment suppresses met; acceptance restores
  it.
- **UI**: component tests like existing tab tests — nav tree, scenario-card state,
  selection popover, orphaned tray, severity toggle.

## Out of scope (explicitly)

- Raw/interactive HTML blocks in pages (possible later as a sandboxed block type).
- Public/shareable standalone wiki site.
- User direct-editing of pages in the dashboard.
- GitHub webhooks or reading the repo from the server — all flow is CLI-push, as today.
