#!/usr/bin/env bash
# Resync the canonical daloop CLI (cli/daloop.mjs) into its distribution copies:
#   - web/public/skill/daloop.mjs        (website curl installer)
#   - plugins/daloop-reporting/bin/daloop (Claude Code plugin, on $PATH)
# Run after editing cli/daloop.mjs. (web also resyncs via its `prebuild` step.)
set -euo pipefail
cd "$(dirname "$0")/.."

cp cli/daloop.mjs web/public/skill/daloop.mjs
cp cli/daloop.mjs plugins/daloop-reporting/bin/daloop
chmod +x plugins/daloop-reporting/bin/daloop
cp cli/vision-schema.mjs plugins/daloop-reporting/bin/vision-schema.mjs
chmod +x plugins/daloop-reporting/bin/vision-schema.mjs

# vision + loop skills for the curl installer (plugin already bundles them)
mkdir -p web/public/skill/daloop-vision web/public/skill/daloop-loop
cp plugins/daloop-reporting/skills/daloop-vision/SKILL.md web/public/skill/daloop-vision/SKILL.md
cp plugins/daloop-reporting/skills/daloop-loop/SKILL.md   web/public/skill/daloop-loop/SKILL.md
cp cli/vision-schema.mjs web/public/skill/vision-schema.mjs

echo "✓ synced cli/daloop.mjs → web/public/skill/daloop.mjs, plugins/daloop-reporting/bin/daloop"
echo "✓ synced cli/vision-schema.mjs → plugins/daloop-reporting/bin/vision-schema.mjs"
echo "✓ synced daloop-vision/daloop-loop SKILL.md + vision-schema.mjs → web/public/skill/ (curl installer)"
