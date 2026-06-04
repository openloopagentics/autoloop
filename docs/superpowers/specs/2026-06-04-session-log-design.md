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

**Firestore rules:** team members can read; API-key authenticated requests can write. Same pattern as `scores` / `testRuns`.

---

## CLI Command

```bash
autoloop session push \
  --file <path-to-transcript.jsonl> \
  --loop <loopId> \
  [--session <uuid>]   # defaults to filename stem
```

**Parsing logic (JSONL → entries):**
1. Skip non-`user`/`assistant` record types (`system`, `attachment`, `permission-mode`, etc.).
2. For `user` records: extract text content blocks → `{ kind: "user", text, ts }`.
3. For `assistant` records: extract text blocks → `{ kind: "assistant", text, ts }`. For each `tool_use` block in the content: emit `{ kind: "tool", name, summary: input summary (≤120 chars), ok: true, ts }`. For each paired `tool_result` block: update `ok` based on `is_error`.
4. Timestamps derived from adjacent `system` records or file mtime fallback.

**State file:** `autoloop loop start` writes the current loop ID to `.autoloop-state.json` in the project root. `autoloop state --current-loop` reads it. `autoloop loop set --status completed` clears it.

---

## Stop Hook

Added to `.claude/settings.json` by `autoloop init --session-log` (opt-in flag):

```json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "autoloop session push --file \"$CLAUDE_PROJECT_DIR/$CLAUDE_SESSION_ID.jsonl\" --loop \"$(autoloop state --current-loop)\" || true"
    }]
  }]
}
```

- `|| true` ensures a failed upload never blocks the session from closing.
- If `--current-loop` returns empty (no active loop), the push is a no-op.

---

## Backend

### New routes

```
POST /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions
GET  /v1/teams/:teamId/projects/:slug/loops/:loopId/sessions
```

Mounted in `app.ts` alongside the existing `scoresRouter` / `testRunsRouter`.

### New files

| File | Purpose |
|------|---------|
| `functions/src/routes/sessions.ts` | Express router — POST (upsert) + GET (list ordered by `startedAt`) |
| `functions/src/services/sessions.ts` | `appendSession(teamId, slug, loopId, body)`, `listSessions(teamId, slug, loopId)` |
| `functions/src/schemas.ts` | `sessionEntrySchema` + `sessionBody` zod schemas |

### Schema (zod)

```ts
const sessionEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"),      text: z.string().max(10_000), ts: z.number() }),
  z.object({ kind: z.literal("assistant"), text: z.string().max(10_000), ts: z.number() }),
  z.object({ kind: z.literal("tool"),      name: z.string().max(100), summary: z.string().max(200), ok: z.boolean(), ts: z.number() }),
]);

const sessionBody = z.object({
  sessionId: z.string().regex(idPattern),
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
- `SessionEntry` — renders one entry row: user bubble / assistant bubble / tool chip

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

1. Backend: new schemas + service + routes + Firestore rules update
2. CLI: `session push` command + `state --current-loop` subcommand + `.autoloop-state.json` write in `loop start`
3. Hook: `autoloop init --session-log` flag writes Stop hook to `.claude/settings.json`
4. UI: MessagesTab sub-tabs + SessionLogTab + hook
5. Sync + deploy
