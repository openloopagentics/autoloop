#!/usr/bin/env node
// Parse a repo "vision wiki" — a set of markdown pages under vision/ — into the
// { goals, scenarios } shapes that cli/vision-schema.mjs validates. Each page
// carries YAML-subset frontmatter (id/title/order) and embeds goal/scenario
// definitions inside ```goal / ```scenario fenced blocks. The dashboard renders
// the raw markdown (fences included) as cards; the loop uses the extracted
// goals/scenarios. This is the single parser shared by the dependency-free CLI
// and the functions tests — node builtins only, no npm deps.
//
// Block/frontmatter body grammar (a restricted YAML subset; JSON is a superset
// and short-circuits via JSON.parse):
//   - `key: value` maps; nesting by exactly 2-space indent per level.
//   - `- ` list items: a scalar, or inline JSON ({...}/[...]) parsed with JSON.parse.
//   - Values that are `{...}` or `[...]` are parsed as inline JSON.
//   - Scalar coercion: true/false → boolean, integer/float → number, else string
//     (surrounding matching quotes are stripped).
//   - Anything else (bad indent, missing colon) ⇒ a parse error with a line number.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { validateVision } from "./vision-schema.mjs";

const ID_RE = /^[a-z0-9._-]+$/;
const MARKDOWN_MAX_BYTES = 100 * 1024;

class BlockParseError extends Error {}

/** Coerce a scalar token: true/false, int, float, else string (matched quotes stripped). */
function coerceScalar(raw) {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
      (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    return s.slice(1, -1);
  }
  return s;
}

/** Parse a single value token: inline JSON ({...}/[...]) or a coerced scalar. */
function parseValue(raw) {
  const s = raw.trim();
  if (s.startsWith("{") || s.startsWith("[")) {
    try { return JSON.parse(s); }
    catch { throw new BlockParseError(`invalid inline JSON: ${s}`); }
  }
  return coerceScalar(s);
}

/**
 * Parse the restricted YAML subset. `lines` are raw text lines; nesting is by
 * 2-space indent. Returns a plain object/array. Throws BlockParseError on any
 * construct outside the subset.
 */
function parseYamlSubset(text) {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  let i = 0;

  function indentOf(line) {
    const m = line.match(/^( *)/);
    const n = m[1].length;
    if (n % 2 !== 0) throw new BlockParseError(`bad indentation (must be 2-space multiples): "${line}"`);
    return n;
  }

  // Parse a block of entries at exactly `depth` spaces of indent. Consumes lines
  // as long as they are at >= depth; stops at end or a shallower line.
  function parseBlock(depth) {
    // Peek the first content line at this level to decide list vs map.
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) return {};
    const first = lines[i];
    const ind = indentOf(first);
    if (ind < depth) return {};
    const isList = first.slice(depth).startsWith("- ") || first.slice(depth) === "-";
    return isList ? parseList(depth) : parseMap(depth);
  }

  function parseList(depth) {
    const out = [];
    while (i < lines.length) {
      if (lines[i].trim() === "") { i++; continue; }
      const ind = indentOf(lines[i]);
      if (ind < depth) break;
      if (ind > depth) throw new BlockParseError(`unexpected indent: "${lines[i]}"`);
      const rest = lines[i].slice(depth);
      if (rest !== "-" && !rest.startsWith("- ")) throw new BlockParseError(`expected list item "- ": "${lines[i]}"`);
      const val = rest === "-" ? "" : rest.slice(2);
      i++;
      out.push(parseValue(val));
    }
    return out;
  }

  function parseMap(depth) {
    const out = {};
    while (i < lines.length) {
      if (lines[i].trim() === "") { i++; continue; }
      const ind = indentOf(lines[i]);
      if (ind < depth) break;
      if (ind > depth) throw new BlockParseError(`unexpected indent: "${lines[i]}"`);
      const rest = lines[i].slice(depth);
      const colon = rest.indexOf(":");
      if (colon < 0) throw new BlockParseError(`expected "key: value": "${lines[i]}"`);
      const key = rest.slice(0, colon).trim();
      if (!key) throw new BlockParseError(`empty key: "${lines[i]}"`);
      const valPart = rest.slice(colon + 1).trim();
      i++;
      if (valPart === "") {
        // Nested block (map or list) at a deeper indent.
        out[key] = parseBlock(depth + 2);
      } else {
        out[key] = parseValue(valPart);
      }
    }
    return out;
  }

  const result = parseBlock(0);
  return result;
}

/** Body text of a fenced block: JSON.parse first; on failure, restricted YAML subset. */
export function parseBlockBody(text) {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  try { return JSON.parse(trimmed); } catch { /* fall through to YAML subset */ }
  return parseYamlSubset(text);
}

// Split a file into { frontmatter: {lines, startLine}, markdown, markdownStartLine }.
// Frontmatter: file starts with `---\n`, ends at the next `---` line.
function splitFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    return { fmLines: null, fmStart: 0, markdown: text, mdStart: 1 };
  }
  let end = -1;
  for (let k = 1; k < lines.length; k++) {
    if (lines[k] === "---") { end = k; break; }
  }
  if (end < 0) return { fmLines: null, fmStart: 0, markdown: text, mdStart: 1, unterminated: true };
  const fmLines = lines.slice(1, end);
  // markdown is everything after the closing `---` line, verbatim (leading blank
  // line included, so mdStart lines up exactly with the file's line numbers).
  const markdown = lines.slice(end + 1).join("\n");
  return { fmLines, fmStart: 2, markdown, mdStart: end + 2 };
}

// Extract ```goal / ```scenario fenced blocks from markdown. Returns
// { blocks: [{ kind, body, openLine }], error?: {line, message} }. `mdStart` is
// the 1-based file line of the markdown's first line.
function extractBlocks(markdown, mdStart) {
  const lines = markdown.split("\n");
  const blocks = [];
  let k = 0;
  while (k < lines.length) {
    const m = lines[k].match(/^```(goal|scenario)\s*$/);
    if (!m) { k++; continue; }
    const openLine = mdStart + k;
    const kind = m[1];
    let close = -1;
    for (let j = k + 1; j < lines.length; j++) {
      if (/^```\s*$/.test(lines[j])) { close = j; break; }
    }
    if (close < 0) return { blocks, error: { line: openLine, message: `unclosed \`\`\`${kind} fence` } };
    blocks.push({ kind, body: lines.slice(k + 1, close).join("\n"), openLine });
    k = close + 1;
  }
  return { blocks };
}

/**
 * files: [{ path: "overview.md" | "auth/passkeys.md", text: string }]
 * Returns { ok:true, pages, goals, scenarios } or { ok:false, errors:[{file,line,message}] }.
 * pages: [{ id, path, title, order, markdown, contentHash, goalIds, scenarioIds }]
 * goals/scenarios: exactly the shapes vision-schema.mjs validates (scenario keeps
 * `test` — callers strip it before upload, same as `vision import`).
 */
export function parsePages(files) {
  const errors = [];
  const pages = [];
  const goals = [];
  const scenarios = [];
  // blockIndex → { file, line } so validateVision errors can be mapped back to source.
  const goalLoc = [];
  const scenarioLoc = [];
  const seenPageIds = new Map(); // id → first file that used it

  for (const { path, text } of files) {
    const { fmLines, fmStart, markdown, mdStart, unterminated } = splitFrontmatter(text);
    if (unterminated || fmLines === null) {
      errors.push({ file: path, line: 1, message: "missing or unterminated frontmatter (--- ... ---)" });
      continue;
    }

    // Parse frontmatter (same subset parser).
    let fm;
    try { fm = parseBlockBody(fmLines.join("\n")); }
    catch (e) { errors.push({ file: path, line: fmStart, message: `frontmatter parse error: ${e.message}` }); continue; }

    if (typeof fm?.id !== "string" || !ID_RE.test(fm.id)) {
      errors.push({ file: path, line: 1, message: `frontmatter 'id' is required and must match ${ID_RE}` });
      continue;
    }
    if (typeof fm.title !== "string" || fm.title.length === 0) {
      errors.push({ file: path, line: 1, message: "frontmatter 'title' is required" });
      continue;
    }
    if (fm.order !== undefined && !Number.isInteger(fm.order)) {
      errors.push({ file: path, line: 1, message: "frontmatter 'order' must be an integer" });
      continue;
    }
    const order = fm.order === undefined ? 0 : fm.order;

    if (seenPageIds.has(fm.id)) {
      errors.push({ file: path, line: 1, message: `duplicate page id '${fm.id}' (also in ${seenPageIds.get(fm.id)})` });
      continue;
    }
    seenPageIds.set(fm.id, path);

    if (Buffer.byteLength(markdown, "utf8") > MARKDOWN_MAX_BYTES) {
      errors.push({ file: path, line: mdStart, message: "page exceeds 100KB — split it" });
      continue;
    }

    const { blocks, error } = extractBlocks(markdown, mdStart);
    if (error) { errors.push({ file: path, ...error }); continue; }

    const goalIds = [];
    const scenarioIds = [];
    let blockErr = false;
    for (const b of blocks) {
      let body;
      try { body = parseBlockBody(b.body); }
      catch (e) { errors.push({ file: path, line: b.openLine, message: `${b.kind} block parse error: ${e.message}` }); blockErr = true; continue; }
      if (b.kind === "goal") {
        goals.push(body);
        goalLoc.push({ file: path, line: b.openLine });
        if (typeof body?.id === "string") goalIds.push(body.id);
      } else {
        scenarios.push(body);
        scenarioLoc.push({ file: path, line: b.openLine });
        if (typeof body?.id === "string") scenarioIds.push(body.id);
      }
    }
    if (blockErr) continue;

    pages.push({
      id: fm.id,
      path,
      title: fm.title,
      order,
      markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"),
      goalIds,
      scenarioIds,
    });
  }

  // Duplicate goal/scenario ids across all pages (validateVision doesn't cross-check
  // uniqueness). Report at the second occurrence's block location.
  const flagDupes = (items, locs, kind) => {
    const seen = new Map();
    items.forEach((it, idx) => {
      const id = it?.id;
      if (typeof id !== "string") return;
      if (seen.has(id)) errors.push({ ...locs[idx], message: `duplicate ${kind} id '${id}' (also in ${seen.get(id).file})` });
      else seen.set(id, locs[idx]);
    });
  };
  flagDupes(goals, goalLoc, "goal");
  flagDupes(scenarios, scenarioLoc, "scenario");

  // Semantic validation of the assembled vision, mapped back to source blocks.
  const vres = validateVision({ goals, scenarios });
  if (!vres.ok) {
    for (const msg of vres.errors) {
      const m = msg.match(/^(goals|scenarios)\[(\d+)\]/);
      const loc = m
        ? (m[1] === "goals" ? goalLoc[+m[2]] : scenarioLoc[+m[2]])
        : undefined;
      errors.push({ file: loc?.file ?? files[0]?.path ?? "", line: loc?.line ?? 1, message: msg });
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, pages, goals, scenarios };
}

/** Read a vision/ directory into the `files` shape parsePages expects (relative POSIX paths). */
export function readVisionDir(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".md")) files.push({ path: relative(dir, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return files;
}

// CLI entry: `node vision-pages.mjs <vision-dir>` → prints OK or the errors; exit 0/1.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: vision-pages.mjs <vision-dir>"); process.exit(1); }
  let files;
  try { files = readVisionDir(dir); }
  catch (e) { console.error(`could not read ${dir}: ${e.message}`); process.exit(1); }
  const r = parsePages(files);
  if (r.ok) { console.log(`✓ ${dir} — ${r.pages.length} page(s), ${r.goals.length} goal(s), ${r.scenarios.length} scenario(s)`); process.exit(0); }
  console.error(`✗ ${dir} has ${r.errors.length} problem(s):`);
  for (const e of r.errors) console.error(`  - ${e.file}:${e.line} ${e.message}`);
  process.exit(1);
}
