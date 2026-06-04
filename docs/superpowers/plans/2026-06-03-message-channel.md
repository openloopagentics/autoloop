# 2-way message channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** A user→agent message channel: the user posts from the web; the running `/daloop` agent pulls pending messages at each task boundary (surfaced via a piggyback on its own `task set` report), acts, acks, and can reply in-thread. Stop messages gracefully terminate the run.

**Architecture:** Project-level `messages` docs at `teams/{teamId}/projects/{slug}/messages/{ulid}`. Server-mediated writes (no Firestore rules change — recursive member-read already covers reads). Agent reads via a new API-key `GET` (the first agent read endpoint) + a `pendingMessages` preview piggybacked on the `task set` response so the agent notices messages reliably without a separate poll. CLI gains `messages pull/ack/send`; web gains a Messages tab; the `/daloop` skill gains a check-messages step.

**Tech Stack:** Firebase Functions v2 (TS, zod, Vitest+emulator), dependency-free Node CLI, React+Firestore web, Markdown skill.

**Design reference:** `~/.claude/plans/synchronous-whistling-goose.md` (approved). Lands on `new-workspace` (PR #17 batch). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Message doc shape:** `{ text, author: "user"|"agent", status?: "pending"|"delivered" (user only), createdAt, deliveredAt?, ackedBy? }`. `author`/`status` are server-owned; the zod body accepts only `text` (plain `z.object` drops the rest).

---

### Task A1: `messageBody` schema

**Files:** Modify `functions/src/schemas.ts`.

- [ ] **Step 1: Add the schema** (after the `id` const block, near the other bodies):
```ts
export const messageBody = z.object({ text: z.string().min(1).max(8192) });
export type MessageBody = z.infer<typeof messageBody>;
```
- [ ] **Step 2:** `cd functions && npm run build` — clean.
- [ ] **Step 3: Commit** `feat(contract): messageBody schema`.

---

### Task A2: `messages` service

**Files:** Create `functions/src/services/messages.ts`; Test `functions/test/messages.test.ts`.

Reuse `resolveBase` (project-level: pass no loopId) from `./baseRef.js`, `ulid()` from `../ulid.js`, `FieldValue.serverTimestamp()`, `AppError`.

- [ ] **Step 1: Write failing service tests** (`functions/test/messages.test.ts`) — model on `events.test.ts` (seedTeam/seedMember/createProject helpers):
  - `createMessage` (author "user") stores text/author/status:"pending"/createdAt; returns id.
  - `createMessage` (author "agent") stores author:"agent" and NO `status` key.
  - `listPendingUserMessages` returns only `author=="user" && status=="pending"`, oldest-first by id, excludes agent replies + delivered; caps at 50.
  - `ackMessage` flips status→"delivered" + stamps deliveredAt + ackedBy; re-ack is a no-op (deliveredAt unchanged, compare toMillis); 404 on missing id.
  - 404 when the project doesn't exist (via resolveBase).
- [ ] **Step 2:** Run `cd functions && npm test` → fail (module missing).
- [ ] **Step 3: Implement** `functions/src/services/messages.ts`:
```ts
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../errors.js";
import { resolveBase } from "./baseRef.js";
import { ulid } from "../ulid.js";

export async function createMessage(teamId: string, slug: string, text: string, author: "user" | "agent", uid: string): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug); // project-level
  const id = ulid();
  const data: Record<string, unknown> = { text, author, by: uid, createdAt: FieldValue.serverTimestamp() };
  if (author === "user") data.status = "pending";
  await baseRef.collection("messages").doc(id).set(data);
  return id;
}

export interface MessagePreview { id: string; text: string; createdAt: string | null }
export async function listPendingUserMessages(teamId: string, slug: string, max = 50): Promise<MessagePreview[]> {
  const { baseRef } = await resolveBase(teamId, slug);
  const snap = await baseRef.collection("messages")
    .where("author", "==", "user").where("status", "==", "pending")
    .orderBy("__name__").limit(max).get();
  return snap.docs.map((d) => {
    const v = d.data();
    const ts = v.createdAt as { toDate?: () => Date } | undefined;
    return { id: d.id, text: v.text as string, createdAt: ts?.toDate ? ts.toDate().toISOString() : null };
  });
}

export async function ackMessage(teamId: string, slug: string, id: string, uid: string): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug);
  const ref = baseRef.collection("messages").doc(id);
  await (await import("../firestore.js")).db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "not_found", "message does not exist");
    if (snap.data()!.status === "delivered") return; // idempotent
    tx.set(ref, { status: "delivered", deliveredAt: FieldValue.serverTimestamp(), ackedBy: uid }, { merge: true });
  });
}
```
> Note: prefer a top-level `import { db } from "../firestore.js";` rather than the inline dynamic import shown — match the file's neighbours (events.ts imports db at top). The dynamic import is only to avoid an unused import if `db` isn't otherwise used; use the top-level import for consistency.

The `where(...).where(...).orderBy("__name__")` query needs no composite index because the two `==` filters + the document-id order are covered by Firestore's automatic single-field indexes. If the emulator demands an index, fall back to `orderBy(FieldPath.documentId())` (already index-free) — confirm in the test run.
- [ ] **Step 4:** `cd functions && npm test` → pass. `npm run build` clean.
- [ ] **Step 5: Commit** `feat(contract): messages service (create/listPending/ack)`.

---

### Task A3: `messages` routes + mounts (user-send, agent pull/ack/reply)

**Files:** Create `functions/src/routes/messages.ts`; Modify `functions/src/app.ts`, `functions/src/routes/userProjects.ts`; Test: extend `functions/test/messages.test.ts` (Supertest) + `functions/test-rules/rules.test.ts`.

- [ ] **Step 1: Write failing API tests** (Supertest, in messages.test.ts):
  - User-send: `POST /v1/u/teams/team1/projects/acme/messages {text}` with an ID-token member → 200 `{ok,id}`; doc is author "user", pending. (Use the existing user-auth test helper — see `userProjects.test.ts` for how it auths the `/v1/u` path.)
  - Agent pull: `GET /v1/teams/team1/projects/acme/messages` (authHeader API key) → 200 `{ok,messages:[...]}` returns only pending user msgs.
  - Agent ack: `POST …/messages/:id/ack` → 200; flips delivered; pull no longer returns it.
  - Agent reply: `POST …/messages {text}` (API key) → author "agent", no status; not returned by pull.
  - 400 on empty text.
- [ ] **Step 2:** run → fail (routes missing).
- [ ] **Step 3: Implement** `functions/src/routes/messages.ts` (agent router; mirror `routes/events.ts` param validation):
```ts
import { Router } from "express";
import { idPattern, messageBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { createMessage, listPendingUserMessages, ackMessage } from "../services/messages.js";

export const messagesRouter = Router({ mergeParams: true }); // agent (API key)

messagesRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const messages = await listPendingUserMessages(teamId, slug);
    res.status(200).json({ ok: true, messages });
  } catch (err) { next(err); }
});

messagesRouter.post("/", async (req, res, next) => { // agent reply
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const parsed = messageBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await createMessage(teamId, slug, parsed.data.text, "agent", req.uid as string);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});

messagesRouter.post("/:id/ack", async (req, res, next) => {
  try {
    const { teamId, slug, id } = req.params as Record<string, string>;
    for (const [n, v] of [["teamId", teamId], ["slug", slug], ["id", id]] as const) if (!idPattern.test(v)) throw new AppError(400, "validation", `invalid ${n}`);
    await ackMessage(teamId, slug, id, req.uid as string);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
```
- [ ] **Step 4: User-send route** — add to `functions/src/routes/userProjects.ts` (uses its `ids()` helper + `req.uid` from makeRequireUser):
```ts
import { messageBody } from "../schemas.js";          // add to imports
import { createMessage } from "../services/messages.js";
userProjectsRouter.post("/:slug/messages", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const parsed = messageBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug } = req.params as Record<string, string>;
    const id = await createMessage(teamId, slug, parsed.data.text, "user", (req as { uid?: string }).uid ?? "");
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});
```
- [ ] **Step 5: Mount** in `functions/src/app.ts`: `import { messagesRouter } from "./routes/messages.js";` and add `teamRouter.use("/:slug/messages", messagesRouter);` with the other project-direct entity mounts (e.g. after `/:slug/bugs`). (User-send is already mounted via userProjectsRouter.)
- [ ] **Step 6: Rules test** — in `functions/test-rules/rules.test.ts`, seed a `messages/m1` doc in `seedProjectTree` and add `"messages/m1"` to the loop-contract `paths` array (members read; clients can't write — recursive rule, no rules change).
- [ ] **Step 7:** `cd functions && npm test && npm run test:rules && npm run build` → all green/clean.
- [ ] **Step 8: Commit** `feat(contract): message routes (user-send + agent pull/ack/reply) + rules test`.

---

### Task A4: task-boundary `pendingMessages` piggyback

**Files:** Modify `functions/src/routes/tasks.ts`; Test: extend `functions/test/messages.test.ts` (or tasks.test.ts).

- [ ] **Step 1: Write failing test:** after seeding a project + a pending user message, `PUT /v1/teams/team1/projects/acme/tasks/t1 {phaseId,title,order,status}` (authHeader) → 200 and `res.body.pendingMessages` is a non-empty array `[{id,text}]`. And with no pending messages → `pendingMessages` is `[]`. (Loop-scoped task PUT also returns project-level pendingMessages.)
- [ ] **Step 2:** run → fail (response lacks the field).
- [ ] **Step 3: Implement** — in `functions/src/routes/tasks.ts`, import `listPendingUserMessages`, and after `await upsertTask(...)` augment the response:
```ts
const pendingMessages = await listPendingUserMessages(teamId, slug, 5);
res.status(200).json({ ok: true, pendingMessages });
```
(Keep `ok:true`; the field is additive so existing callers/tests pass. Note pendingMessages is project-level even when `loopId` is set — pass only teamId/slug.)
- [ ] **Step 4:** `cd functions && npm test` → pass (confirm existing tasks tests still green — the response gained a field but `toMatchObject({ ok: true })` still holds).
- [ ] **Step 5: Commit** `feat(contract): piggyback pendingMessages on task-set response`.

---

### Task B1: CLI `messages` verbs + report() notice + sync

**Files:** Modify `cli/daloop.mjs`; Test `functions/test/cli.unit.test.ts`; then `scripts/sync-daloop-cli.sh`.

- [ ] **Step 1: Write failing CLI unit tests** (model on the existing cap()/base() pattern):
  - `messages send --text "hi"` → POST `…/projects/web/messages`, body `{text:"hi"}` (NO loopSeg even when currentLoopId set).
  - `messages ack m1` → POST `…/messages/m1/ack`.
  - `messages pull` → GET `…/messages`; given a stubbed fetch returning `{messages:[{id:"m1",text:"hi"}]}`, the verb prints JSON containing `m1` to the captured `log` (stdout).
  - report() notice: a stubbed `task set` fetch returning `{ok:true,pendingMessages:[{id:"m1",text:"hi"}]}` causes a `📨`/"message" notice on the captured `err`.
- [ ] **Step 2:** run `cd functions && npm run test:run -- cli.unit` → fail.
- [ ] **Step 3: Implement** in `cli/daloop.mjs`:
  - A `fetchJson(req, deps)` helper (mirror `report()` auth; on `res.ok` parse JSON and `log(JSON.stringify(body.messages ?? body, null, 2))`, return 0; on failure `err(...)` + return 0; never throw).
  - Extend `report()`: after `if (res.ok)`, before `return 0`, read the body best-effort and notify:
    ```js
    if (res.ok) {
      try { const b = await res.json(); if (Array.isArray(b?.pendingMessages) && b.pendingMessages.length) err(`daloop: 📨 ${b.pendingMessages.length} message(s) from the user — run \`daloop messages pull\``); } catch { /* ignore */ }
      return 0;
    }
    ```
  - Three `case`s (two-word verbs; project-level URLs, no `loopSeg`):
    - `"messages pull"` → `fetchJson({method:"GET", url: `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/messages`}, {env,fetchImpl,log,err,teamId:cfg.teamId})`.
    - `"messages ack"` → `const id = positionals[2];` presence-check only (`if (!id || !id.trim()) throw new UsageError(...)`) — do NOT `validateId`/idPattern it (message ids are uppercase ULIDs that idPattern rejects) → `report({method:"POST", url: `…/messages/${id}/ack`, body:{}}, {...})`.
    - `"messages send"` → `if (!flags.text) throw new UsageError("messages send requires --text")` → `report({method:"POST", url: `…/messages`, body:{text:flags.text}}, {...})`.
- [ ] **Step 4:** run cli.unit → pass; `cd functions && npm run build`.
- [ ] **Step 5: Sync + verify** `bash scripts/sync-daloop-cli.sh` then `diff cli/daloop.mjs plugins/daloop-reporting/bin/daloop && diff cli/daloop.mjs web/public/skill/daloop.mjs && echo IDENTICAL`.
- [ ] **Step 6: Commit** `feat(cli): messages pull/ack/send + pendingMessages notice (synced)`.

---

### Task C1: web types + `useMessages` hook + `postMessage`

**Files:** Modify `web/src/dashboard/types.ts`, `web/src/dashboard/hooks.ts`, `web/src/dashboard/api.ts`.

- [ ] **Step 1:** `types.ts` — add:
```ts
export interface Message { id: string; text: string; author: "user" | "agent"; status?: "pending" | "delivered"; createdAt?: unknown; deliveredAt?: unknown; }
```
- [ ] **Step 2:** `hooks.ts` — add `useMessages(teamId, slug)` mirroring `useDocuments` (project-level, `orderBy(documentId())` ascending; import `Message`).
- [ ] **Step 3:** `api.ts` — add:
```ts
export async function postMessage(teamId: string, slug: string, text: string): Promise<void> {
  await ok(await fetch(u(teamId, slug, "/messages"), { method: "POST", headers: await headers(), body: JSON.stringify({ text }) }));
}
```
- [ ] **Step 4:** `cd web && npm run build` clean.
- [ ] **Step 5: Commit** `feat(web): Message type + useMessages + postMessage`.

---

### Task C2: `MessagesTab` + tab wiring

**Files:** Create `web/src/dashboard/tabs/MessagesTab.tsx`; Modify `web/src/dashboard/components/Tabs.tsx`, `web/src/dashboard/ProjectDetail.tsx`; Test `web/src/dashboard/components/messages.test.tsx`.

- [ ] **Step 1: Write failing tests** (presentational): a `MessageThread`/`MessagesTab` rendered with props shows user vs agent bubbles (distinct class), a "Sent"/"Delivered" pill for user messages by status, and an empty state. Make `MessagesTab` accept `messages` + an `onSend(text)` callback so it's testable without Firestore (ProjectDetail wires `useMessages` + `postMessage`). Test the compose calls `onSend`.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3: Implement** `MessagesTab.tsx` — a thread list (reuse `relativeTime` from `web/src/notifications/NotificationsBell.tsx` if exported, else a local copy) with `msg--user`/`msg--agent` rows, a `msgstatus--pending|delivered` pill on user messages, and a controlled compose box (textarea + Send button) calling `onSend`; clear on submit; surface a send error via `ErrorNote`. Props: `{ messages: Message[]; onSend: (text: string) => Promise<void> }`.
- [ ] **Step 4:** `Tabs.tsx` — add `"messages"` to `TabKey` + `{ key: "messages", label: "Messages" }`. `ProjectDetail.tsx` — add `const messages = useMessages(teamId, slug);`, a `tabLoading` branch (`messages.loading && messages.data.length === 0` for the messages tab), and render `{tab === "messages" && <MessagesTab messages={messages.data} onSend={(t) => postMessage(teamId, slug, t)} />}`.
- [ ] **Step 5:** add minimal CSS (`web/src/index.css`): `.msgthread`/`.msg`/`.msg--user`/`.msg--agent`/`.msg-text`/`.msg-time`/`.msgstatus--pending`/`.msgstatus--delivered`/`.msgcompose`. Consistent with existing tokens.
- [ ] **Step 6:** `cd web && npm test && npm run build` → green/clean.
- [ ] **Step 7: Commit** `feat(web): Messages tab (thread + compose + delivery pill)`.

---

### Task D1: `/daloop` skill + plugin 0.4.0

**Files:** Modify `plugins/daloop-reporting/skills/daloop/SKILL.md`, `plugins/daloop-reporting/.claude-plugin/plugin.json`; sync.

- [ ] **Step 1:** In SKILL.md, in step 2 after "Close the task", add a **Check for user messages** sub-step: the `task set --status completed` call surfaces a `📨` notice when messages are pending; on it (or proactively each task) run `daloop messages pull`; for each message oldest-first, interpret — answer via `daloop messages send --text "…"`; reprioritize/add/drop via the existing `daloop revise` flow; **stop/pause → graceful terminate**; ambiguous → reply asking — then `daloop messages ack <id>`. Reply at discretion.
- [ ] **Step 2:** In step 4 (Terminate), make "user interrupts" explicit: a pulled stop/pause message → reply, ack, `daloop loop set <loopId> --status cancelled`, emit the "N/M scenarios met" summary noting the user stop.
- [ ] **Step 3:** Add a **Rules** bullet: "A `messages pull` error is noted once and skipped — never block or abort the build on the channel." Update the worked Example to show pull→act→ack and a reply. Update the frontmatter `description` to mention "receive user messages".
- [ ] **Step 4:** Bump `plugin.json` 0.3.0 → 0.4.0. Run `bash scripts/sync-daloop-cli.sh`; `diff plugins/daloop-reporting/skills/daloop/SKILL.md web/public/skill/daloop/SKILL.md && echo IDENTICAL`.
- [ ] **Step 5:** Verify every `daloop messages …` command in SKILL.md matches `cli/daloop.mjs`.
- [ ] **Step 6: Commit** `feat(skill): /daloop checks user messages + stop path (plugin 0.4.0)`.

---

### Final: full green + push

- [ ] `cd functions && npm test && npm run test:rules && npm run build`; `cd web && npm test && npm run build`. All green.
- [ ] `git push origin new-workspace` (updates PR #17). Update the PR body to add the message-channel feature.

## Definition of done

- User posts a message (web Messages tab → "Sent"); agent pulls it at the next task boundary (surfaced via the `task set` notice), acts, acks (web → "Delivered"), and can reply (agent bubble appears live). A "stop" message gracefully terminates the run.
- No Firestore rules change; messages member-readable + client-write-denied (tested). All suites green; CLI + skill copies synced.

## Out of scope

Mid-task hard interrupt; agent reading the full thread; a resumable pause state; per-loop message scoping; real-time push.
