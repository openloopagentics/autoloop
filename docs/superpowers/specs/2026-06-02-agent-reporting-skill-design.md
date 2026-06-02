# Daloop Agent Reporting CLI & Skill — Design

**Date:** 2026-06-02
**Status:** Approved (design phase)

## Context

Daloop's REST API is built and deployed. The remaining piece on the agent side
is how an AI agent (Claude Code, Codex) running a development loop in *some other
project's repo* reports status (project / phase / commit) to Daloop as it works.

This sub-project delivers a thin, dependency-free CLI plus a Claude Code skill
that drives it. The CLI is the portable core (any agent that can run `node`); the
skill tells a Claude Code agent *when* to call it.

Builds on the deployed API:
- `docs/superpowers/specs/2026-06-01-multitenant-foundation-design.md` (team-scoped paths)
- `docs/superpowers/specs/2026-06-02-api-keys-design.md` (per-user API keys)

Writes go to `PUT /v1/teams/{teamId}/projects/{slug}[/phases/{phaseId}[/commits/{sha}]]`
authenticated by a per-user key (`Authorization: Bearer dl_…`); the key's user
must be a member of the team.

## Deliverables

All in this repo:

- **`cli/daloop.mjs`** — a single, dependency-free Node script (Node 22+; uses
  global `fetch` and `node:child_process` for git). Portable to any agent env.
- **`skills/daloop-reporting/SKILL.md`** — a Claude Code skill mapping the loop
  lifecycle to CLI calls.
- **Codex usage note** — a short section (in the skill dir, e.g. `CODEX.md` or a
  README) describing the same CLI commands for Codex-driven loops.

The agent runs the loop in another repo; the CLI reads a local `.daloop.json`
there and the API key from the environment.

## CLI command surface

Each command maps to exactly one REST call.

```
daloop init --team <teamId> --project <slug> [--url <apiUrl>]
    Writes ./.daloop.json. No network call.

daloop project set --title <t> --status <s> [--design-file <path> | --design-url <url>]
    PUT /v1/teams/{teamId}/projects/{slug}

daloop phase start <phaseId> --name <n> --order <n> [--status running]
    PUT .../phases/{phaseId}; also records currentPhaseId in .daloop.json.

daloop phase set <phaseId> --status <s>
    PUT .../phases/{phaseId} (partial; status only).

daloop commit
    Reads git HEAD (sha, message, author, committedAt) via `git log -1`,
    attaches to .daloop.json's currentPhaseId:
    PUT .../phases/{currentPhaseId}/commits/{sha}
```

- `status` is validated client-side against
  `queued | running | blocked | paused | completed | failed | cancelled` for fast
  feedback before any network call.
- `--design-file` reads the file as `{ format: "markdown", content }`;
  `--design-url` sends `{ format: "url", content: <url> }`.
- `daloop commit` requires a `currentPhaseId` (set by `phase start`) and a git
  repo with at least one commit; errors clearly otherwise.

## Config & auth

- **`.daloop.json`** (in the loop repo; non-secret, inspectable, commit-safe):
  `{ apiUrl, teamId, projectSlug, currentPhaseId }`. Created by `daloop init`;
  `currentPhaseId` is updated by `phase start`. `apiUrl` defaults to the deployed
  function URL if `--url` is omitted at init.
- **`DALOOP_API_KEY`** (environment, secret): the per-user key minted via
  `POST /v1/keys`. Never written to `.daloop.json`. The CLI sends it as
  `Authorization: Bearer $DALOOP_API_KEY` and errors clearly if it's unset.

## The skill (when to report)

`skills/daloop-reporting/SKILL.md` is a **flexible** skill (guidance, not a rigid
checklist). Lifecycle mapping:

| Loop moment | CLI call |
|---|---|
| Project start (once) | `daloop init …` then `daloop project set --title … --status running --design-file <plan/spec>` |
| Entering a phase | `daloop phase start <id> --name … --order …` |
| After each git commit | `daloop commit` |
| Leaving a phase | `daloop phase set <id> --status completed\|failed` |
| Loop end | `daloop project set --status completed\|failed\|cancelled` |

**Core principle in the skill:** reporting is **best-effort observability and must
never derail the loop**. If a `daloop` call fails, the agent notes it and
continues its real work — status reporting is not a gate. The skill also tells the
agent the key + config must already be set up (`DALOOP_API_KEY` in env,
`.daloop.json` via `daloop init`).

## Error handling (CLI)

Map API responses to clear, single-line, actionable messages + non-zero exit:

- `401` → "invalid or missing DALOOP_API_KEY".
- `403` → "your API key's user is not a member of team <teamId>".
- `404` → "team/project/phase not found — run `daloop init` / `daloop project set` first".
- `400` → surface the API's validation message.
- Missing `.daloop.json` → "not initialized — run `daloop init`".
- Missing `DALOOP_API_KEY` → clear setup error.
- Network/other errors → non-zero exit, one-line message, no stack dump.

All calls are idempotent (server-side upserts), so retries are safe.

## Testing

Reuses the repo's Vitest + Firestore-emulator harness.

- **Unit (no network):** arg parsing; `.daloop.json` load / merge / `currentPhaseId`
  update; `status` enum validation; git-HEAD parsing (fed canned `git log` output);
  request-building (correct method, URL, headers, body per command).
- **Integration (against the real API):** boot the existing Express app
  (`makeApp()`) on a local port pointed at the Firestore emulator; seed an
  `apiKeys` doc + team membership; drive the CLI end-to-end
  (`init → project set → phase start → commit → phase set`), asserting Firestore
  state and the 401 (bad key) / 403 (non-member) error paths.

## Out of scope

- The UI / website (separate effort).
- Auto-instrumenting commits via git hooks (the agent calls `daloop commit`
  explicitly; a hook could come later).
- Publishing the CLI to npm (it's a repo-local script for now).
- Minting keys (done via the API's `POST /v1/keys`, normally from the UI); the
  agent is assumed to already have `DALOOP_API_KEY`.
