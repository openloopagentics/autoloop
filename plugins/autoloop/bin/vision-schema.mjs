#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ID_RE = /^[a-z0-9._-]+$/;
const CONTENT_MAX_BYTES = 100 * 1024;
const AUTONOMY = ["L1", "L2", "L3"];
const isId = (v) => typeof v === "string" && ID_RE.test(v);
const nonEmpty = (v) => typeof v === "string" && v.length > 0;

/**
 * Validate an optional loop-local `governance` block (top-level or per-scenario).
 * All fields optional; absence is valid. Pushes any problems onto `errors`.
 * Mirrors the loop-engineering registry cost/autonomy fields. This block is NOT
 * sent to the server — it stays in the local vision.json (stripped on import).
 */
function validateGovernance(g, at, errors) {
  if (g === undefined) return;
  if (typeof g !== "object" || g === null || Array.isArray(g)) { errors.push(`${at} must be an object`); return; }
  if (g.autonomy !== undefined && !AUTONOMY.includes(g.autonomy)) errors.push(`${at}.autonomy must be one of L1|L2|L3`);
  if (g.dailyTokenCap !== undefined && !(Number.isInteger(g.dailyTokenCap) && g.dailyTokenCap >= 10000)) errors.push(`${at}.dailyTokenCap must be an integer >= 10000`);
  if (g.earlyExit !== undefined && typeof g.earlyExit !== "boolean") errors.push(`${at}.earlyExit must be a boolean`);
  if (g.humanGates !== undefined) {
    if (!Array.isArray(g.humanGates)) errors.push(`${at}.humanGates must be an array of strings`);
    else g.humanGates.forEach((h, k) => { if (!nonEmpty(h)) errors.push(`${at}.humanGates[${k}] must be a non-empty string`); });
  }
}

/**
 * Validate a vision.json object against the loop-contract field rules (+ a
 * dangling-goalId cross-check). Returns { ok: true } or { ok: false, errors: [...] }.
 * Missing goals/scenarios/documents are treated as empty arrays (a partial vision is valid).
 */
export function validateVision(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, errors: ["vision must be an object"] };
  const errors = [];
  const goals = v.goals ?? [];
  const scenarios = v.scenarios ?? [];
  const documents = v.documents ?? [];
  if (!Array.isArray(goals)) errors.push("goals must be an array");
  if (!Array.isArray(scenarios)) errors.push("scenarios must be an array");
  if (!Array.isArray(documents)) errors.push("documents must be an array");
  if (errors.length) return { ok: false, errors };

  const intOk = (n) => Number.isInteger(n);
  const goalIds = new Set();
  goals.forEach((g, i) => {
    if (!isId(g?.id)) errors.push(`goals[${i}].id must match ${ID_RE}`);
    else goalIds.add(g.id);
    if (!nonEmpty(g?.title)) errors.push(`goals[${i}].title is required`);
    if (g?.order !== undefined && !intOk(g.order)) errors.push(`goals[${i}].order must be an integer`);
  });

  scenarios.forEach((s, i) => {
    if (!isId(s?.id)) errors.push(`scenarios[${i}].id must match ${ID_RE}`);
    if (!isId(s?.goalId)) errors.push(`scenarios[${i}].goalId must match ${ID_RE}`);
    else if (!goalIds.has(s.goalId)) errors.push(`scenarios[${i}].goalId '${s.goalId}' has no matching goal`);
    if (!nonEmpty(s?.title)) errors.push(`scenarios[${i}].title is required`);
    if (s?.order !== undefined && !intOk(s.order)) errors.push(`scenarios[${i}].order must be an integer`);
    if (s?.threshold !== undefined && !(typeof s.threshold === "number" && s.threshold >= 0 && s.threshold <= 100))
      errors.push(`scenarios[${i}].threshold must be a number 0..100`);
    const crit = s?.rubric?.criteria;
    if (!Array.isArray(crit) || crit.length === 0) errors.push(`scenarios[${i}].rubric.criteria must be a non-empty array`);
    else crit.forEach((c, j) => {
      const at = `scenarios[${i}].rubric.criteria[${j}]`;
      if (!isId(c?.id)) errors.push(`${at}.id must match ${ID_RE}`);
      if (!nonEmpty(c?.name)) errors.push(`${at}.name is required`);
      if (!(typeof c?.weight === "number" && c.weight > 0)) errors.push(`${at}.weight must be > 0`);
      if (!(Number.isInteger(c?.max) && c.max >= 1)) errors.push(`${at}.max must be an integer >= 1`);
    });
    if (s?.test !== undefined) {
      if (typeof s.test !== "object" || s.test === null || (s.test.command !== undefined && typeof s.test.command !== "string"))
        errors.push(`scenarios[${i}].test.command must be a string`);
    }
    validateGovernance(s?.governance, `scenarios[${i}].governance`, errors);
  });

  documents.forEach((d, i) => {
    if (!isId(d?.id)) errors.push(`documents[${i}].id must match ${ID_RE}`);
    if (!nonEmpty(d?.kind)) errors.push(`documents[${i}].kind is required`);
    if (!nonEmpty(d?.title)) errors.push(`documents[${i}].title is required`);
    if (d?.format !== "markdown" && d?.format !== "url") errors.push(`documents[${i}].format must be markdown|url`);
    if (typeof d?.content !== "string") errors.push(`documents[${i}].content is required`);
    if (typeof d?.content === "string" && d.content.length > CONTENT_MAX_BYTES) errors.push(`documents[${i}].content exceeds 100KB`);
  });

  validateGovernance(v.governance, "governance", errors);

  if (errors.length) return { ok: false, errors };

  // Non-fatal: surface scenarios with no runnable test command. Their score is
  // unverified — "done" is subjective without a test (goal-audit's lesson). The
  // shape stays { ok: true } when there are none, preserving existing callers.
  const warnings = [];
  scenarios.forEach((s, i) => {
    const cmd = s?.test?.command;
    if (typeof cmd !== "string" || cmd.length === 0)
      warnings.push(`scenarios[${i}]${isId(s?.id) ? ` (${s.id})` : ""} has no test.command — its score will be unverified ("done" is subjective)`);
  });
  return warnings.length ? { ok: true, warnings } : { ok: true };
}

/** Return an import-safe scenario: the loop-local `test` and `governance` fields removed. */
export function stripForImport(scenario) {
  const { test, governance, ...rest } = scenario;
  return rest;
}

// CLI entry: `node vision-schema.mjs <vision.json>` → prints OK or the errors; exit 0/1.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error("usage: vision-schema.mjs <vision.json>"); process.exit(1); }
  let obj;
  try { obj = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { console.error(`could not read/parse ${file}: ${e.message}`); process.exit(1); }
  const r = validateVision(obj);
  if (r.ok) {
    console.log(`✓ ${file} is a valid vision`);
    if (r.warnings?.length) {
      console.warn(`⚠ ${r.warnings.length} warning(s):`);
      for (const w of r.warnings) console.warn(`  - ${w}`);
    }
    process.exit(0);
  }
  console.error(`✗ ${file} has ${r.errors.length} problem(s):`);
  for (const e of r.errors) console.error(`  - ${e}`);
  process.exit(1);
}
