# Session Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Claude Code session transcripts in Firebase and display them in a new Session Log sub-tab within the Messages tab, stitched across sessions per loop.

**Architecture:** A `Stop` hook calls `autoloop session push` which parses the local JSONL transcript and POSTs it to a new `sessions` subcollection under the loop in Firestore. The UI adds sub-tabs (Messages | Session Log) to `MessagesTab`, with `SessionLogTab` subscribing to all sessions for the selected loop via `onSnapshot`.

**Tech Stack:** Express + Firestore Admin SDK (backend), Node ESM CLI (autoloop.mjs), React 18 + Firestore SDK (UI), Vitest + supertest (backend tests)

---

## File Map

| File | Change |
|------|--------|
| `functions/src/schemas.ts` | Add `sessionEntry`, `sessionBody` zod schemas |
| `functions/src/services/sessions.ts` | Create — `appendSession`, `listSessions` |
| `functions/src/routes/sessions.ts` | Create — POST upsert + GET list |
| `functions/src/app.ts` | Mount `sessionsRouter` |
| `functions/test/sessions.test.ts` | Create — backend tests |
| `cli/autoloop.mjs` | Add `session push`, `state --current-loop`, `init --session-log`; clear `currentLoopId` in `loop set` terminal statuses |
| `web/src/dashboard/types.ts` | Add `SessionDoc`, `SessionEntry` types |
| `web/src/dashboard/hooks.ts` | Add `useSessionLog` hook |
| `web/src/dashboard/tabs/SessionLogTab.tsx` | Create — session log view |
| `web/src/dashboard/tabs/MessagesTab.tsx` | Add sub-tab switcher |

---

## Task 1: Backend — schemas

**Files:**
- Modify: `functions/src/schemas.ts`

- [ ] **1.1 Write the failing test**

In `functions/test/sessions.test.ts` (new file):
```ts
import { describe, it, expect } from "vitest";
import { sessionBody } from "../src/schemas.js";

describe("sessionBody schema", () => {
  it("accepts a valid session", () => {
    const r = sessionBody.safeParse({
      sessionId: "0ee0ac9d-27e2-4439-b550-933f226aaa24",
      startedAt: 1000,
      endedAt: 2000,
      entries: [
        { kind: "user", text: "hello", ts: 1000 },
        { kind: "assistant", text: "hi", ts: 1001 },
        { kind: "tool", name: "Bash", summary: "ls -la", ok: true, ts: 1002 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects sessionId that contains uppercase beyond UUID hex", () => {
    const r = sessionBody.safeParse({
      sessionId: "INVALID SESSION ID!",
      startedAt: 1000, endedAt: 2000, entries: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects text longer than 500 chars", () => {
    const r = sessionBody.safeParse({
      sessionId: "abc123",
      startedAt: 1000, endedAt: 2000,
      entries: [{ kind: "user", text: "x".repeat(501), ts: 1000 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 2000 entries", () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ kind: "user" as const, text: "hi", ts: i }));
    const r = sessionBody.safeParse({ sessionId: "abc123", startedAt: 0, endedAt: 1, entries });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **1.2 Run test to confirm it fails**

```bash
cd functions && npx vitest run test/sessions.test.ts
```
Expected: FAIL — `sessionBody` not found.

- [ ] **1.3 Add schemas to `functions/src/schemas.ts`**

Append after the existing exports:
```ts
const sessionEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"),      text: z.string().max(500), ts: z.number() }),
  z.object({ kind: z.literal("assistant"), text: z.string().max(500), ts: z.number() }),
  z.object({ kind: z.literal("tool"),      name: z.string().max(100), summary: z.string().max(200), ok: z.boolean(), ts: z.number() }),
]);

export const sessionBody = z.object({
  sessionId: z.string().regex(/^[0-9a-f-]+$/i).min(8).max(64),
  startedAt: z.number(),
  endedAt:   z.number(),
  entries:   z.array(sessionEntry).max(2000),
});

export type SessionBody = z.infer<typeof sessionBody>;
```

- [ ] **1.4 Run test to confirm it passes**

```bash
cd functions && npx vitest run test/sessions.test.ts
```
Expected: PASS (4 tests).

- [ ] **1.5 Commit**

```bash
git add functions/src/schemas.ts functions/test/sessions.test.ts
git commit -m "feat(sessions): add sessionBody zod schema + tests"
```

---

## Task 2: Backend — service

**Files:**
- Create: `functions/src/services/sessions.ts`
- Modify: `functions/test/sessions.test.ts`

- [ ] **2.1 Add service-level tests** to `functions/test/sessions.test.ts`:

```ts
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

async function seed() {
  await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
  await seedMember("team1");
  await request(app).put("/v1/teams/team1/projects/proj").set(authHeader()).send({ title: "P", status: "running" });
  await request(app).put("/v1/teams/team1/projects/proj/loops/loop1").set(authHeader()).send({ goal: "g", order: 1, status: "running" });
}

describe("POST /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions", () => {
  it("creates a session and returns ok", async () => {
    await seed();
    const body = {
      sessionId: "abc-123-def",
      startedAt: 1000, endedAt: 2000,
      entries: [{ kind: "user", text: "hi", ts: 1000 }],
    };
    const res = await request(app)
      .post("/v1/teams/team1/projects/proj/loops/loop1/sessions")
      .set(authHeader()).send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("is idempotent — second push with same sessionId returns ok", async () => {
    await seed();
    const body = { sessionId: "abc-123-def", startedAt: 1000, endedAt: 2000, entries: [] };
    await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader()).send(body);
    const res = await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader()).send(body);
    expect(res.status).toBe(200);
  });

  it("returns 400 on invalid body", async () => {
    await seed();
    const res = await request(app)
      .post("/v1/teams/team1/projects/proj/loops/loop1/sessions")
      .set(authHeader()).send({ sessionId: "x", startedAt: "bad" });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions", () => {
  it("lists sessions ordered by startedAt", async () => {
    await seed();
    const base = { endedAt: 2000, entries: [] };
    await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader()).send({ sessionId: "s2", startedAt: 2000, ...base });
    await request(app).post("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader()).send({ sessionId: "s1", startedAt: 1000, ...base });
    const res = await request(app).get("/v1/teams/team1/projects/proj/loops/loop1/sessions").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.sessions[0].sessionId).toBe("s1");
    expect(res.body.sessions[1].sessionId).toBe("s2");
  });
});
```

- [ ] **2.2 Run to confirm failure**

```bash
cd functions && npx vitest run test/sessions.test.ts
```
Expected: FAIL — routes not mounted.

- [ ] **2.3 Create `functions/src/services/sessions.ts`**

```ts
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { SessionBody } from "../schemas.js";

async function loopRef(teamId: string, slug: string, loopId: string) {
  const ref = db().doc(`teams/${teamId}/projects/${slug}/loops/${loopId}`);
  if (!(await ref.get()).exists) throw new AppError(404, "not_found", "loop does not exist");
  return ref;
}

export async function appendSession(teamId: string, slug: string, loopId: string, body: SessionBody): Promise<void> {
  const loop = await loopRef(teamId, slug, loopId);
  await loop.collection("sessions").doc(body.sessionId).set({
    sessionId: body.sessionId,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
    entries: body.entries,
  }, { merge: false });
}

export async function listSessions(teamId: string, slug: string, loopId: string) {
  const loop = await loopRef(teamId, slug, loopId);
  const snap = await loop.collection("sessions").orderBy("startedAt").get();
  return snap.docs.map((d) => d.data());
}
```

- [ ] **2.4 Commit service (tests still failing — routes not mounted yet)**

```bash
git add functions/src/services/sessions.ts
git commit -m "feat(sessions): add appendSession + listSessions service"
```

---

## Task 3: Backend — route + app mount

**Files:**
- Create: `functions/src/routes/sessions.ts`
- Modify: `functions/src/app.ts`

- [ ] **3.1 Create `functions/src/routes/sessions.ts`**

```ts
import { Router, json } from "express";
import { AppError } from "../errors.js";
import { idPattern, sessionBody } from "../schemas.js";
import { appendSession, listSessions } from "../services/sessions.js";

export const sessionsRouter = Router({ mergeParams: true });

sessionsRouter.post("/", json({ limit: "512kb" }), async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug))   throw new AppError(400, "validation", "invalid slug");
    if (!idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = sessionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await appendSession(teamId, slug, loopId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

sessionsRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId: string };
    const sessions = await listSessions(teamId, slug, loopId);
    res.status(200).json({ ok: true, sessions });
  } catch (err) { next(err); }
});
```

- [ ] **3.2 Mount router in `functions/src/app.ts`**

Add import at top with the others:
```ts
import { sessionsRouter } from "./routes/sessions.js";
```

Add mount alongside `scoresRouter`:
```ts
teamRouter.use("/:slug/loops/:loopId/sessions", sessionsRouter);
```

- [ ] **3.3 Run tests**

```bash
cd functions && npx vitest run test/sessions.test.ts
```
Expected: all PASS.

- [ ] **3.4 Run full test suite to check for regressions**

```bash
cd functions && npx vitest run
```
Expected: all green.

- [ ] **3.5 Commit**

```bash
git add functions/src/routes/sessions.ts functions/src/app.ts functions/test/sessions.test.ts
git commit -m "feat(sessions): POST/GET sessions route, mounted on loops/:loopId/sessions"
```

---

## Task 4: CLI — state + loop tracking

**Files:**
- Modify: `cli/autoloop.mjs`

- [ ] **4.1 Add `state --current-loop` command**

In the `switch` block (after `messages send`, before the final `default`), add:

```js
case "state": {
  const cfg = loadConfig(cwd);
  if (flags["current-loop"]) {
    if (cfg.currentLoopId) log(cfg.currentLoopId);
    return 0;
  }
  throw new UsageError("state requires --current-loop");
}
```

- [ ] **4.2 Clear `currentLoopId` in `loop set` when status is terminal**

In the `case "loop set":` block, after `const cfg = loadConfig(cwd);`, add:

```js
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
if (TERMINAL_STATUSES.includes(flags.status)) {
  cfg.currentLoopId = null;
  saveConfig(cwd, cfg);
}
```

- [ ] **4.3 Smoke-test manually**

```bash
# In a dir with .autoloop.json (currentLoopId: "loop-test"):
node cli/autoloop.mjs state --current-loop
# Expected: prints "loop-test"
```

- [ ] **4.4 Commit**

```bash
git add cli/autoloop.mjs
git commit -m "feat(cli): add state --current-loop; clear currentLoopId on terminal loop status"
```

---

## Task 5: CLI — `session push` command

**Files:**
- Modify: `cli/autoloop.mjs`

- [ ] **5.1 Add `session push` command** in the `switch` block:

```js
case "session push": {
  // Resolve transcript file
  let transcriptPath = flags.file;
  if (!transcriptPath) {
    const sessionId = env.CLAUDE_CODE_SESSION_ID;
    if (!sessionId) throw new UsageError("session push: --file required (CLAUDE_CODE_SESSION_ID not set)");
    // Encode cwd: replace every / and . with -
    const encodedCwd = cwd.replace(/[/.]/g, "-");
    const home = env.HOME || env.USERPROFILE || "";
    transcriptPath = join(home, ".claude", "projects", encodedCwd, `${sessionId}.jsonl`);
  }
  if (!existsSync(transcriptPath)) {
    err(`autoloop: session transcript not found at ${transcriptPath}`);
    return 0; // best-effort: don't fail the hook
  }

  const cfg = loadConfig(cwd);
  const loopId = flags.loop || cfg.currentLoopId;
  if (!loopId) { err("autoloop: session push skipped — no active loop"); return 0; }
  validateId("loopId", loopId);

  const sessionId = flags.session || basename(transcriptPath, ".jsonl");
  const lines = readFileSync(transcriptPath, "utf8").trim().split("\n").filter(Boolean);
  const entries = [];
  // Maps tool_use id → index in entries array so tool_result can patch ok=false.
  const toolIndexById = new Map();
  let startedAt = null, endedAt = null;

  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const ts = rec.timestamp ?? rec.ts ?? null;
    if (ts) { if (!startedAt || ts < startedAt) startedAt = ts; if (!endedAt || ts > endedAt) endedAt = ts; }
    const role = rec.type === "user" ? "user" : rec.type === "assistant" ? "assistant" : null;
    if (!role) continue;
    const msg = rec.message ?? rec;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === "text" && block.text) {
        entries.push({ kind: role, text: String(block.text).slice(0, 500), ts: ts ?? 0 });
      }
      if (role === "assistant" && block.type === "tool_use") {
        const inputSummary = JSON.stringify(block.input ?? {}).slice(0, 120);
        toolIndexById.set(block.id, entries.length);
        entries.push({ kind: "tool", name: block.name ?? "tool", summary: inputSummary, ok: true, ts: ts ?? 0 });
      }
      // tool_result arrives in a subsequent user record — patch the matched tool entry's ok flag
      if (role === "user" && block.type === "tool_result" && block.tool_use_id) {
        const idx = toolIndexById.get(block.tool_use_id);
        if (idx !== undefined && block.is_error) entries[idx].ok = false;
      }
    }
  }

  const body = { sessionId, startedAt: startedAt ?? 0, endedAt: endedAt ?? 0, entries };
  const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/loops/${loopId}/sessions`;
  return report({ method: "POST", url, body }, { env, fetchImpl, err, strict: false, teamId: cfg.teamId });
}
```

You'll need to add `basename` to the Node imports at the top of the file if not already present:
```js
import { join, basename } from "path";
```

- [ ] **5.2 Smoke-test**

```bash
CLAUDE_CODE_SESSION_ID=test-session node cli/autoloop.mjs session push --loop loop1 --file /dev/null 2>&1
# Expected: "session transcript not found" or network error (not a crash)
```

- [ ] **5.3 Commit**

```bash
git add cli/autoloop.mjs
git commit -m "feat(cli): add session push command with transcript auto-discovery + parsing"
```

---

## Task 6: CLI — `init --session-log` flag

**Files:**
- Modify: `cli/autoloop.mjs`

- [ ] **6.1 Update `case "init":` to support `--session-log` flag**

After `log(\`autoloop: initialized...\`)`, add:

```js
if (flags["session-log"]) {
  const settingsPath = join(cwd, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { settings = {}; }
  }
  const hookCmd = `autoloop session push --loop "$(autoloop state --current-loop)" || true`;
  const stopHooks = settings.Stop ?? [];
  const alreadyAdded = stopHooks.some((h) => h.hooks?.some((hh) => hh.command?.includes("session push")));
  if (!alreadyAdded) {
    stopHooks.push({ hooks: [{ type: "command", command: hookCmd }] });
    settings.Stop = stopHooks;
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    log("autoloop: added session-push Stop hook to .claude/settings.json");
  } else {
    log("autoloop: session-push Stop hook already present");
  }
}
```

Add `mkdirSync` + `writeFileSync` to the Node imports at the top if not already present:
```js
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
```

- [ ] **6.2 Smoke-test**

```bash
cd /tmp && mkdir test-hook && cd test-hook
node <repo>/cli/autoloop.mjs init --team t1 --project p1 --session-log
cat .claude/settings.json
# Expected: Stop hook with "session push" present
```

- [ ] **6.3 Commit**

```bash
git add cli/autoloop.mjs
git commit -m "feat(cli): init --session-log writes Stop hook to .claude/settings.json"
```

---

## Task 7: UI — types + hook

**Files:**
- Modify: `web/src/dashboard/types.ts`
- Modify: `web/src/dashboard/hooks.ts`

- [ ] **7.1 Add types to `web/src/dashboard/types.ts`**

```ts
export type SessionEntry =
  | { kind: "user";      text: string; ts: number }
  | { kind: "assistant"; text: string; ts: number }
  | { kind: "tool";      name: string; summary: string; ok: boolean; ts: number };

export interface SessionDoc {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  entries: SessionEntry[];
}
```

- [ ] **7.2 Add `useSessionLog` hook to `web/src/dashboard/hooks.ts`**

Import at top (add to existing firebase imports):
```ts
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
```
(These are likely already imported — check and add only what's missing.)

Add the hook:
```ts
export function useSessionLog(teamId: string, slug: string, loopId: string | undefined): Result<SessionDoc[]> {
  const [data, setData] = useState<SessionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loopId) { setData([]); setLoading(false); return; }
    const q = query(
      collection(db, "teams", teamId, "projects", slug, "loops", loopId, "sessions"),
      orderBy("startedAt"),
    );
    return onSnapshot(q, (snap) => {
      setData(snap.docs.map((d) => d.data() as SessionDoc));
      setLoading(false);
    }, (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, loopId]);
  return { data, loading, error };
}
```

- [ ] **7.3 Run type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **7.4 Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/hooks.ts
git commit -m "feat(sessions): add SessionDoc type + useSessionLog hook"
```

---

## Task 8: UI — SessionLogTab component

**Files:**
- Create: `web/src/dashboard/tabs/SessionLogTab.tsx`

- [ ] **8.1 Create `web/src/dashboard/tabs/SessionLogTab.tsx`**

```tsx
import { useSessionLog } from "../hooks";
import type { SessionDoc, SessionEntry } from "../types";

function formatTime(ts: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function EntryRow({ entry }: { entry: SessionEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="slog-entry slog-entry--user">
        <span className="slog-role dim">you</span>
        <span className="slog-text">{entry.text}</span>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div className="slog-entry slog-entry--assistant">
        <span className="slog-role">claude</span>
        <span className="slog-text">{entry.text}</span>
      </div>
    );
  }
  return (
    <div className={`slog-entry slog-entry--tool${entry.ok ? "" : " slog-entry--tool-err"}`}>
      <span className="slog-tool-icon">{entry.ok ? "✓" : "✗"}</span>
      <span className="slog-tool-name">{entry.name}</span>
      <span className="slog-tool-summary dim">{entry.summary}</span>
    </div>
  );
}

function SessionBlock({ session, index }: { session: SessionDoc; index: number }) {
  const [showAll, setShowAll] = useState(false);
  const start = formatTime(session.startedAt);
  const end = formatTime(session.endedAt);
  const visible = showAll ? session.entries : session.entries.slice(0, 50);
  const hidden = session.entries.length - 50;
  return (
    <div className="slog-session">
      <div className="slog-session-header dim">
        Session {index + 1} · {start}{end && end !== start ? ` – ${end}` : ""}
      </div>
      {visible.map((e, i) => <EntryRow key={i} entry={e} />)}
      {!showAll && hidden > 0 && (
        <button type="button" className="slog-more dim" onClick={() => setShowAll(true)}>
          {hidden} more entries — show all
        </button>
      )}
    </div>
  );
}

export function SessionLogTab({ teamId, slug, loopId }: { teamId: string; slug: string; loopId: string | undefined }) {
  const { data: sessions, loading, error } = useSessionLog(teamId, slug, loopId);
  if (loading) return <p className="dim">Loading…</p>;
  if (error) return <p className="error-note">{error}</p>;
  if (sessions.length === 0) return <p className="dim">No session log yet — the loop will upload its transcript when it stops.</p>;
  return (
    <div className="slog-wrap">
      {sessions.map((s, i) => <SessionBlock key={s.sessionId} session={s} index={i} />)}
    </div>
  );
}
```

- [ ] **8.2 Run type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **8.3 Commit**

```bash
git add web/src/dashboard/tabs/SessionLogTab.tsx
git commit -m "feat(sessions): add SessionLogTab component"
```

---

## Task 9: UI — MessagesTab sub-tabs

**Files:**
- Modify: `web/src/dashboard/tabs/MessagesTab.tsx`

- [ ] **9.1 Update `MessagesTab` to accept `loopId` + add sub-tab switcher**

Replace the current `MessagesTab` signature and body:

```tsx
import { useState } from "react";
import { ErrorNote } from "../components/ErrorNote";
import { SessionLogTab } from "./SessionLogTab";
import type { Message } from "../types";

// (keep the existing relativeTime function unchanged)

export function MessagesTab({
  teamId,
  slug,
  loopId,
  messages,
  onSend,
  agentActive,
}: {
  teamId: string;
  slug: string;
  loopId: string | undefined;
  messages: Message[];
  onSend: (text: string) => Promise<void>;
  agentActive?: boolean;
}) {
  const [tab, setTab] = useState<"messages" | "log">("messages");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    setSendError(null);
    try { await onSend(text.trim()); setText(""); }
    catch (err) { setSendError(err instanceof Error ? err.message : "Failed to send message"); }
    finally { setSending(false); }
  }

  return (
    <div className="msgthread-wrap">
      {/* sub-tab bar */}
      <div className="msgtabs">
        <button type="button" className={`msgtab${tab === "messages" ? " msgtab--active" : ""}`} onClick={() => setTab("messages")}>Messages</button>
        <button type="button" className={`msgtab${tab === "log" ? " msgtab--active" : ""}`} onClick={() => setTab("log")}>Session Log</button>
      </div>

      {tab === "log" ? (
        <SessionLogTab teamId={teamId} slug={slug} loopId={loopId} />
      ) : (
        <>
          <div className="msgthread">
            {messages.length === 0 ? (
              <p className="msgthread-empty">No messages yet</p>
            ) : (
              <ul className="msglist">
                {messages.map((msg) => (
                  <li key={msg.id} className={`msg msg--${msg.author}`}>
                    <span className="msg-text">{msg.text}</span>
                    {msg.createdAt !== undefined && <span className="msg-time dim tnum">{relativeTime(msg.createdAt)}</span>}
                    {msg.author === "user" && msg.status !== undefined && (
                      <span className={`msgstatus msgstatus--${msg.status}`}>{msg.status === "pending" ? "Sent" : "Delivered"}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {sendError && <ErrorNote message={sendError} />}
          {agentActive !== undefined && (
            <p className={`msg-agentstatus${agentActive ? " msg-agentstatus--active" : ""}`}>
              {agentActive ? "A loop is running — it'll see your message at its next step." : "No active run — your message will wait until a loop starts."}
            </p>
          )}
          <div className="msgcompose">
            <textarea className="msgcompose-input" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Send a message to the agent…" rows={3} disabled={sending}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSend(); } }}
            />
            <button type="button" className="btn btn--primary msgcompose-send" onClick={() => void handleSend()} disabled={sending || !text.trim()}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **9.2 Update call-sites and existing tests**

Find all usages:
```bash
grep -rn "MessagesTab" web/src/
```

**Call-site** (likely `web/src/dashboard/tabs/LoopsTab.tsx` or `ProjectDetail.tsx`): add `teamId`, `slug`, and `loopId` (the currently-selected loop's id) to the props.

**Existing test file** `web/src/dashboard/components/messages.test.tsx`: every `<MessagesTab .../>` render must now include the three new required props. Add stub values:
```tsx
<MessagesTab teamId="t1" slug="p1" loopId="loop1" messages={[]} onSend={async () => {}} />
```
Update all render calls in that file accordingly. The tests themselves do not need to change — just add the props so TypeScript compiles.

- [ ] **9.3 Add CSS for sub-tabs + session log** to `web/src/index.css`

```css
/* Sub-tab bar */
.msgtabs { display: flex; gap: 2px; padding: 0 0 12px; }
.msgtab { background: none; border: none; padding: 6px 14px; border-radius: 5px; cursor: pointer; font-size: 13px; color: var(--text-muted); }
.msgtab--active { background: var(--surface-2); color: var(--text); }

/* Session log */
.slog-wrap { display: flex; flex-direction: column; gap: 16px; }
.slog-session { display: flex; flex-direction: column; gap: 4px; }
.slog-session-header { font-size: 11px; padding: 0 0 4px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.slog-entry { display: flex; gap: 8px; font-size: 12px; padding: 2px 0; }
.slog-entry--user .slog-role { color: var(--text-muted); min-width: 40px; }
.slog-entry--assistant .slog-role { color: var(--accent); min-width: 40px; }
.slog-entry--tool { font-family: monospace; font-size: 11px; padding-left: 16px; }
.slog-tool-icon { color: var(--success); min-width: 12px; }
.slog-entry--tool-err .slog-tool-icon { color: var(--error); }
.slog-tool-name { color: var(--text-muted); min-width: 60px; }
.slog-tool-summary { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
.slog-more { font-size: 11px; padding-left: 16px; }
```

- [ ] **9.4 Run type-check + build**

```bash
cd web && npx tsc --noEmit && npm run build
```
Expected: no errors, build succeeds.

- [ ] **9.5 Commit**

```bash
git add web/src/dashboard/tabs/MessagesTab.tsx web/src/index.css
git commit -m "feat(sessions): MessagesTab sub-tabs — Messages + Session Log"
```

---

## Task 10: Sync + deploy

**Files:**
- Sync: `web/public/skill/autoloop/SKILL.md`, `plugins/autoloop/bin/autoloop`

- [ ] **10.1 Run sync script**

```bash
bash scripts/sync-autoloop-cli.sh
```
Expected: `✓ synced` lines.

- [ ] **10.2 Build + deploy**

```bash
cd web && npm run build && cd .. && firebase deploy --only hosting
```
Expected: deploy complete.

- [ ] **10.3 Smoke test end-to-end**

1. In a project with `.autoloop.json`, run:
   ```bash
   node cli/autoloop.mjs init --team <t> --project <p> --session-log
   ```
   Verify `.claude/settings.json` has the Stop hook.

2. Start a short Claude Code session in that dir, do something simple, let it stop.
   Verify the session was pushed: check Firebase console for `sessions` subcollection.

3. Open the dashboard, go to Messages tab → Session Log.
   Verify entries appear.

- [ ] **10.4 Final commit**

```bash
git add -A
git commit -m "feat(sessions): sync CLI + deploy session-log feature"
```
