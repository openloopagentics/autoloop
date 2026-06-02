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

Each command maps to at most one REST call (`init` is local-only; some commands
also update `.daloop.json`).

```
daloop init --team <teamId> --project <slug> [--url <apiUrl>]
    Writes ./.daloop.json. No network call.

daloop project set --title <t> --status <s> [--design-file <path> | --design-url <url>]
    PUT /v1/teams/{teamId}/projects/{slug}

daloop phase start <phaseId> --name <n> --order <n> [--status running]
    PUT .../phases/{phaseId}; records currentPhaseId AND { name, order } for the
    phase in .daloop.json.

daloop phase set <phaseId> --status <s>
    PUT .../phases/{phaseId}. Re-sends the phase's { name, order } (looked up from
    .daloop.json, recorded by `phase start`) plus the new status, so the write is a
    valid create-or-update regardless of ordering. Errors locally if the phaseId
    was never started (not in .daloop.json) — see Error handling.
    Note: the API PUT is a full upsert, so this re-asserts the LOCALLY-recorded
    name/order and would overwrite a concurrent server-side rename of the phase —
    an accepted consequence of the offline-resilient, best-effort design.

daloop commit
    Reads git HEAD via `git log -1 --format=%H%n%cI%n%an%n%s`:
      sha=%H, committedAt=%cI (strict ISO-8601 with offset), author=%an, message=%s.
    Attaches to .daloop.json's currentPhaseId:
    PUT .../phases/{currentPhaseId}/commits/{sha}
```

- **`committedAt` MUST come from `%cI` (`--date=iso-strict`)** — git's default date
  format is RFC-2822-ish and would fail the API's `z.string().datetime({offset:true})`
  validator. Only the offset-ISO form (`2026-06-02T01:25:49-07:00`) is accepted.
- **`commit` pre-checks locally** that author (`%an`) and message (`%s`) are
  non-empty before sending (an empty author/message would 400 remotely); if empty,
  it errors with an actionable message (e.g. "git author empty — set `user.name`").
- **Client-side validation before any network call:**
  - `status` against `queued | running | blocked | paused | completed | failed | cancelled`.
  - `teamId`, `projectSlug`, `phaseId` (and the git `sha`) against the API's id
    pattern `^[a-z0-9._-]+$` — catches uppercase/spaces/slashes locally instead of a
    confusing remote 400/404 or a malformed URL. (Lowercase-hex git shas pass.)
- `--design-file` reads the file as `{ format: "markdown", content }`;
  `--design-url` sends `{ format: "url", content: <url> }`. (Matches the API's
  `design` object: `{ format: "markdown"|"url", content }`.)
- `daloop commit` requires a `currentPhaseId` (set by `phase start`) and a git repo
  with at least one commit; errors clearly otherwise (see Error handling).

## Config & auth

- **`.daloop.json`** (in the loop repo; non-secret, inspectable, commit-safe):
  `{ apiUrl, teamId, projectSlug, currentPhaseId, phases }` where
  `phases: { [phaseId]: { name, order } }` records each started phase (so
  `phase set` can re-send a complete body). Created by `daloop init`;
  `currentPhaseId` and `phases` are updated by `phase start`.
- **`apiUrl` resolution (precedence): `--url` flag > `DALOOP_API_URL` env >
  `.daloop.json` `apiUrl`.** `init` writes `apiUrl` from `--url`, or the known
  deployed function URL as a documented convenience default. The env override is
  what integration tests use to point the CLI at the locally-booted app.
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
never derail the loop**. If a `daloop` call warns, the agent notes it and continues
its real work — status reporting is not a gate (the CLI's exit-code policy above
makes reporting failures non-fatal by default). The skill also tells the agent the
key + config must already be set up (`DALOOP_API_KEY` in env, `.daloop.json` via
`daloop init`).

**Ordering the skill prescribes (and the CLI is resilient to):** `project set` with
`--title --status` runs at project start (the create), and `phase start` precedes
any `phase set` for that phase. The CLI hardens this — `phase set` re-sends the
phase's recorded `name`/`order` so it's a valid create-or-update, and it errors
locally if the phase was never started. If the initial `project set` is skipped,
a later status-only `project set` would get a remote `404`/`400` → surfaced as a
best-effort warning, not a loop failure.

## Error handling & exit codes (CLI)

To reconcile "reporting is best-effort and must never derail the loop" with useful
failure signals, the CLI splits failures into two classes:

**Usage errors → exit non-zero** (the agent must fix these; they happen *before* any
network call, so a wrapping `set -e` aborts only on genuine misconfiguration):
- Missing `DALOOP_API_KEY` → "set DALOOP_API_KEY (a key minted via POST /v1/keys)".
- Missing `.daloop.json` → "not initialized — run `daloop init`".
- Invalid `status`, or `teamId`/`slug`/`phaseId` failing `^[a-z0-9._-]+$`.
- `phase set <id>` where `<id>` was never started (not in `.daloop.json` `phases`)
  → "phase <id> not started — run `daloop phase start` first".
- `commit` with no `currentPhaseId` → "no current phase — run `daloop phase start` first".
- `commit` with empty git author/message, or no commit in the repo.
- Unknown command / bad flags.

**Reporting failures → print a one-line warning to stderr, exit 0 by default** (so a
transient API/network hiccup never aborts the loop). A `--strict` flag (or
`DALOOP_STRICT=1`) makes these exit non-zero for callers who want hard failures:
- `401` → "invalid or expired DALOOP_API_KEY".
- `403` → "your API key's user is not a member of team <teamId>".
- `404` → "team/project/phase not found — run `daloop project set` first".
- `400` → surface the API's validation message.
- Network/5xx/other → one-line message, no stack dump.

All messages are single-line and actionable; no stack dumps. There is **no
automatic retry/backoff** — the server-side upserts are idempotent, which only
means a *manual* re-run is safe.

The SKILL.md complements this: it tells the agent that a `daloop` reporting warning
is informational and the loop continues regardless (and not to wrap `daloop` in a
way that treats its output as fatal).

## Testing

Reuses the repo's Vitest + Firestore-emulator harness.

- **Unit (no network):** arg parsing; `.daloop.json` load / merge / `currentPhaseId`
  + `phases` update; `status` and id-pattern validation; git-HEAD parsing fed canned
  `git log -1 --format=%H%n%cI%n%an%n%s` output, asserting `committedAt` is the
  offset-ISO form; request-building (correct method, URL, headers, body per command,
  including `phase set` re-sending recorded name/order); and the exit-code policy
  (usage errors → non-zero; simulated reporting failures → exit 0 by default, exit
  non-zero under `--strict`).
- **Local-guard tests:** `phase set` on a never-started id → non-zero with the right
  message; `commit` with no `currentPhaseId` / empty author / no commits → non-zero;
  missing `DALOOP_API_KEY` / `.daloop.json` → non-zero.
- **Integration (against the real API):** boot the existing Express app
  (`makeApp()`) on a local port pointed at the Firestore emulator; point the CLI at
  it via `DALOOP_API_URL` (or `init --url`). **Seed the key correctly:** the API
  resolves keys by `sha256` of the full plaintext, so the test writes
  `apiKeys/{sha256(plaintextKey)}` (hex, over the full `dl_…` string) with the
  user's `uid`, and seeds `teams/{teamId}/members/{uid}`; the CLI runs with that
  **plaintext** key in `DALOOP_API_KEY`. Drive end-to-end
  (`init → project set → phase start → commit → phase set`), asserting Firestore
  state, and verify the 401 (bad key) / 403 (non-member) paths emit a warning and
  exit 0 by default.

## Out of scope

- The UI / website (separate effort).
- Auto-instrumenting commits via git hooks (the agent calls `daloop commit`
  explicitly; a hook could come later).
- Publishing the CLI to npm (it's a repo-local script for now).
- Minting keys (done via the API's `POST /v1/keys`, normally from the UI); the
  agent is assumed to already have `DALOOP_API_KEY`.
