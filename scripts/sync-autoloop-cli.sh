#!/usr/bin/env bash
# Resync the canonical autoloop CLI (cli/autoloop.mjs) into its distribution copies:
#   - web/public/skill/autoloop.mjs        (website curl installer)
#   - plugins/autoloop/bin/autoloop (Claude Code plugin, on $PATH)
# Run after editing cli/autoloop.mjs. (web also resyncs via its `prebuild` step.)
set -euo pipefail
cd "$(dirname "$0")/.."

cp cli/autoloop.mjs web/public/skill/autoloop.mjs
cp cli/autoloop.mjs plugins/autoloop/bin/autoloop
chmod +x plugins/autoloop/bin/autoloop
cp cli/vision-schema.mjs plugins/autoloop/bin/vision-schema.mjs
chmod +x plugins/autoloop/bin/vision-schema.mjs
cp cli/vision-pages.mjs plugins/autoloop/bin/vision-pages.mjs
chmod +x plugins/autoloop/bin/vision-pages.mjs

# vision + loop skills for the curl installer (plugin already bundles them)
mkdir -p web/public/skill/autoloop-vision web/public/skill/autoloop
cp plugins/autoloop/skills/autoloop-vision/SKILL.md web/public/skill/autoloop-vision/SKILL.md
cp plugins/autoloop/skills/autoloop/SKILL.md        web/public/skill/autoloop/SKILL.md
cp cli/vision-schema.mjs web/public/skill/vision-schema.mjs
cp cli/vision-pages.mjs web/public/skill/vision-pages.mjs

# reporting skill for the curl installer (install.sh ships these as SKILL.md/CODEX.md)
cp plugins/autoloop/skills/autoloop-reporting/SKILL.md web/public/skill/SKILL.md
cp plugins/autoloop/skills/autoloop-reporting/CODEX.md web/public/skill/CODEX.md

echo "✓ synced cli/autoloop.mjs → web/public/skill/autoloop.mjs, plugins/autoloop/bin/autoloop"
echo "✓ synced cli/vision-schema.mjs → plugins/autoloop/bin/vision-schema.mjs"
echo "✓ synced cli/vision-pages.mjs → plugins/autoloop/bin/vision-pages.mjs"
echo "✓ synced autoloop-vision/autoloop SKILL.md + vision-schema.mjs → web/public/skill/ (curl installer)"
echo "✓ synced autoloop-reporting SKILL.md/CODEX.md → web/public/skill/ (curl installer)"
