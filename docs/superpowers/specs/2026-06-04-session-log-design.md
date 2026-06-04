# Session Log — Design Spec

**Date:** 2026-06-04  
**Status:** Approved  

## Overview

Store the full Claude Code session transcript in Firebase and display it in a new Session Log sub-tab within the Messages tab. Each session is uploaded automatically via a Claude Code `Stop` hook. Multiple sessions for the same loop are stitched together chronologically.

---

## Data Model

New `sessions` subcollection under each loop:

```
teams/{teamId}/projects/{slug}/loops/{loopId}/sessions/{sessionId}
```

**Document shape:**

```ts
interface SessionDoc {
  sessionId: string;       // Claude session UUID (transcript filename stem)
  startedAt: Timestamp;    // timestamp of first entry
  endedAt: Timestamp;      // timestamp of last entry
  entries: SessionEntry[]; // parsed turns, stored inline
}

type SessionEntry =
  | { kind: "user";      text: string; ts: number }
  | { kind: "assistant"; text: string; ts: number }
  | { kind: "tool";      name: string; summary: string; ok: boolean; ts: number }
```

**Constraints:**
- `entries` stored inline (not subcollection) — summarised content stays well under 1 MB.
- Write is an idempotent upsert keyed on `sessionId` — re-uploading the same session is safe.
- Documents are immutable once written (no partial updates).

**Firestore rules:** No rule change needed. Backend writes go through the Firebase Admin SDK which bypasses Firestore security rules entirely, same as all other write paths (`scores`, `testRuns`, etc.). Team members can already read all subcollections under their project via the existing wildcard read rule.

---

## CLI Command

```bash
autoloop session push \
  --loop <loopId> \
  [--file <path-to-transcript.jsonl>]   # auto-discovered if omitted
  [--session <uuid>]                     # defaults to filename stem
```

**Transcript auto-discovery:** Claude Code exposes `CLAUDE_CODE_SESSION_ID` in the hook environment. The CLI computes the transcript path as:

```
~/.claude/projects/<encoded-cwd>/$CLAUDE_CODE_SESSION_ID.jsonl
```

where `<encoded-cwd>` replaces every `/` and `.` in the absolute working directory path with `-` (e.g. `/Users/foo/.myproject` → `-Users-foo--myproject`). If `--file` is provided explicitly it takes precedence.

**Parsing logic (JSONL → entries):**
1. Skip non-`user`/`assistant` record types (`system`, `attachment`, `permission-mode`, etc.).
2. For `user` records: extract text content blocks → `{ kind: "user", text: text.slice(0,500), ts }`.
3. For `assistant` records: extract text blocks → `{ kind: "assistant", text: text.slice(0,500), ts }`. For each `tool_use` block in the content: emit `{ kind: "tool", name, summary: input summary (≤120 chars), ok: true, ts }`. For each paired `tool_result` block: update `ok` based on `is_error`.
4. Timestamps derived from adjacent `system` records or file mtime fallback.

**State:** `autoloop state --current-loop` reads `currentLoopId` from the existing `.autoloop.json` config file (written by `autoloop loop start`, cleared by `autoloop loop set --status completed`). No second config file.

---

## Stop Hook

Added to `.claude/settings.json` by `autoloop init --session-log` (opt-in flag):

```json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "autoloop session push --loop \"$(autoloop state --current-loop)\" || true"
    }]
  }]
}
```

- `CLAUDE_CODE_SESSION_ID` is available automatically in the hook environment — the CLI uses it to locate the transcript file.
- `|| true` ensures a failed upload never blocks the session from closing.
- If `--current-loop` returns empty (no active loop), the push is a no-op.

---

## Backend

### New routes

```
POST /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions
GET  /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions
```

Explicitly mounted in `app.ts`:

```ts
teamRouter.use("/:slug/loops/:loopId/sessions", sessionsRouter);
```

Alongside the existing `scoresRouter` / `testRunsRouter` mounts. No project-level (non-loop) sessions mount needed.

### Body size

The `sessions` route needs a larger body limit than the global 256 KB. Mount it with a route-level override:

```ts
sessionsRouter.post("/", express.json({ limit: "512kb" }), async (req, res, next) => { … });
```

512 KB accommodates sessions with up to 2000 entries at 200 chars each with overhead.

### New files

| File | Purpose |
|------|---------|
| `functions/src/routes/sessions.ts` | Express router — POST (upsert) + GET (list ordered by `startedAt`) |
| `functions/src/services/sessions.ts` | `appendSession(teamId, slug, loopId, body)`, `listSessions(teamId, slug, loopId)` |
| `functions/src/schemas.ts` | `sessionEntrySchema` + `sessionBody` zod schemas (additions) |

### Schema (zod)

```ts
const sessionEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"),      text: z.string().max(500), ts: z.number() }),
  z.object({ kind: z.literal("assistant"), text: z.string().max(500), ts: z.number() }),
  z.object({ kind: z.literal("tool"),      name: z.string().max(100), summary: z.string().max(200), ok: z.boolean(), ts: z.number() }),
]);

// sessionId is a UUID — use a UUID-tolerant pattern, not the general idPattern
const sessionBody = z.object({
  sessionId: z.string().regex(/^[0-9a-f-]+$/i).min(8).max(64),
  startedAt: z.number(),
  endedAt:   z.number(),
  entries:   z.array(sessionEntry).max(2000),
});
```

---

## UI

### MessagesTab changes

Replace the single-view `MessagesTab` with two sub-tabs:

| Sub-tab | Content |
|---------|---------|
| **Messages** | Existing thread + compose box (unchanged) |
| **Session Log** | Stitched session entries for the selected loop |

**New components:**
- `SessionLogTab` — fetches sessions for `loopId`, renders stitched entries
- `SessionEntryRow` — renders one entry row: user bubble / assistant bubble / tool chip

**Data:** `useSessionLog(teamId, slug, loopId)` hook — Firestore `onSnapshot` on `sessions` subcollection, ordered by `startedAt`. Returns all sessions flat; component stitches entries in order.

**Rendering:**
- Sessions separated by a faint header: `Session 1 · Jun 4 · 09:12 – 09:58`
- User turns: left-aligned, muted background
- Assistant turns: right-aligned, blue background
- Tool entries: indented, monospace, `✓ ToolName · summary` (green) or `✗ ToolName · summary` (red)
- Long sessions truncated at 50 visible entries with "show all" toggle

**Empty state:** "No session log yet — the loop will upload its transcript when it stops."

---

## Rollout

1. Backend: new schemas + service + routes (no Firestore rules change needed)
2. CLI: `session push` command + transcript auto-discovery + `state --current-loop` reading `.autoloop.json` + `currentLoopId` written by `loop start` / cleared by `loop set`
3. Hook: `autoloop init --session-log` flag writes Stop hook to `.claude/settings.json`
4. UI: MessagesTab sub-tabs + SessionLogTab + useSessionLog hook
5. Sync + deploy
