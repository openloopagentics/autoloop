# autoloop (Claude Code plugin)

A Claude Code plugin that lets you author a vision, drive a self-evaluating
development loop, and report its status — goals, scenarios, scores, phases,
and commits — to a [Autoloop](https://daloop-42b47.web.app) dashboard, via the
bundled `autoloop` CLI.

## Install

```
/plugin marketplace add openloopagentics/autoloop
/plugin install autoloop@autoloop
```

Then enable auto-update in `/plugin` → **Marketplaces** → `autoloop`, or update
manually any time with `/plugin marketplace update autoloop`.

## After installing (one-time)

1. Mint a key in the Autoloop app → **API keys**, then `export AUTOLOOP_API_KEY=…`
2. In a loop's working directory: `autoloop init --team <teamId> --project <slug>`

The skills auto-discover and activate automatically. See the **Skills** section
below for a description of each.

## Skills

| Skill | SKILL.md | Purpose |
|-------|----------|---------|
| `autoloop-reporting` | `skills/autoloop-reporting/SKILL.md` | Report a loop's live status (project, phases, commits, scores) to the Autoloop dashboard. Auto-activates while a loop is running. |
| `autoloop-vision` | `skills/autoloop-vision/SKILL.md` | Interview the user to author a `vision.json` file (goals, user scenarios, rubrics). Run once before starting the loop. |
| `autoloop` | `skills/autoloop/SKILL.md` | Drive the vision-driven self-evaluating development loop: plan → execute → score → iterate, using the `vision.json` produced by `autoloop-vision`. (Invoke with `/autoloop`.) |

## Layout

```
plugins/autoloop/
├── .claude-plugin/plugin.json
├── skills/autoloop-reporting/
│   ├── SKILL.md          # invoked by Claude Code
│   └── CODEX.md          # same commands, for Codex loops
├── skills/autoloop-vision/
│   └── SKILL.md          # vision authoring interview
├── skills/autoloop/
│   └── SKILL.md          # vision-driven self-evaluating loop driver (/autoloop)
└── bin/
    ├── autoloop            # the CLI (added to $PATH when the plugin is active)
    └── vision-schema.mjs # JSON schema validator for vision.json
```

`bin/autoloop` is a copy of the canonical `cli/autoloop.mjs` at the repo root.
After changing the CLI, resync the copies with `scripts/sync-autoloop-cli.sh`.
