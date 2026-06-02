#!/usr/bin/env bash
# Installer for the Daloop reporting skill for Claude Code.
#   curl -fsSL https://daloop-42b47.web.app/skill/install.sh | bash
#
# Writes the skill (SKILL.md, CODEX.md) and the bundled `daloop` CLI into
# ~/.claude/skills/daloop-reporting/ . Claude Code discovers personal skills at
# session start, so restart Claude Code (or open a new session) after installing.
set -euo pipefail

BASE="${DALOOP_SKILL_BASE:-https://daloop-42b47.web.app/skill}"
DEST="${DALOOP_SKILL_DIR:-$HOME/.claude/skills/daloop-reporting}"

say() { printf '%s\n' "$*"; }

say "Installing the daloop-reporting skill"
say "  from: $BASE"
say "  to:   $DEST"

command -v curl >/dev/null 2>&1 || { say "✗ curl is required."; exit 1; }

mkdir -p "$DEST"
for f in SKILL.md CODEX.md daloop.mjs; do
  if ! curl -fsSL "$BASE/$f" -o "$DEST/$f.tmp"; then
    say "✗ failed to download $f"; rm -f "$DEST/$f.tmp"; exit 1
  fi
  mv "$DEST/$f.tmp" "$DEST/$f"
done
chmod +x "$DEST/daloop.mjs"

# Node check (the CLI needs Node 22+).
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major:-0}" -lt 22 ]; then
    say "⚠ Node $(node -v) found — the daloop CLI needs Node 22+. Upgrade before using it."
  fi
else
  say "⚠ Node not found — install Node 22+ so the daloop CLI can run."
fi

say ""
say "✓ Installed daloop-reporting → $DEST"
say "  • Restart Claude Code (or start a new session) to load the skill."
say "  • Mint a key in the Daloop app → API keys, then:  export DALOOP_API_KEY=…"
say "  • Initialize a loop:  node \"$DEST/daloop.mjs\" init --team <teamId> --project <slug>"
