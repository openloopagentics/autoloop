// A faithful TypeScript port of `parseBlockBody` from cli/vision-pages.mjs —
// that file is CANONICAL; keep this in sync with it (and with the shared
// fixtures in functions/test/vision-pages.test.ts). Only the body parser is
// ported here; the CLI owns frontmatter/block extraction and file walking.
//
// Body grammar (a restricted YAML subset; JSON is a superset and short-circuits
// via JSON.parse):
//   - `key: value` maps; nesting by exactly 2-space indent per level.
//   - `- ` list items: a scalar, or inline JSON ({...}/[...]) via JSON.parse.
//   - Values that are `{...}` or `[...]` are parsed as inline JSON.
//   - Scalar coercion: true/false → boolean, int/float → number, null → null,
//     else string (matched surrounding quotes stripped).
//   - Tabs, odd indent, missing colon, block-style list-of-maps ⇒ parse error.
//   - A bare `key:` with no value and no deeper children yields {} for that key.

export class BlockParseError extends Error {}

/** Coerce a scalar token: true/false/null, int, float, else string (matched quotes stripped). */
export function coerceScalar(raw: string): unknown {
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
function parseValue(raw: string): unknown {
  const s = raw.trim();
  if (s.startsWith("{") || s.startsWith("[")) {
    try { return JSON.parse(s); }
    catch { throw new BlockParseError(`invalid inline JSON: ${s}`); }
  }
  return coerceScalar(s);
}

/** Parse the restricted YAML subset; nesting by 2-space indent. */
function parseYamlSubset(text: string): unknown {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  let i = 0;

  function indentOf(line: string): number {
    if (/^\s*\t/.test(line)) throw new BlockParseError(`tabs not allowed; indent with spaces: "${line}"`);
    const m = line.match(/^( *)/)!;
    const n = m[1].length;
    if (n % 2 !== 0) throw new BlockParseError(`bad indentation (must be 2-space multiples): "${line}"`);
    return n;
  }

  function parseBlock(depth: number): unknown {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) return {};
    const first = lines[i];
    const ind = indentOf(first);
    if (ind < depth) return {};
    const isList = first.slice(depth).startsWith("- ") || first.slice(depth) === "-";
    return isList ? parseList(depth) : parseMap(depth);
  }

  function parseList(depth: number): unknown[] {
    const out: unknown[] = [];
    while (i < lines.length) {
      if (lines[i].trim() === "") { i++; continue; }
      const ind = indentOf(lines[i]);
      if (ind < depth) break;
      if (ind > depth) throw new BlockParseError(`unexpected indent: "${lines[i]}"`);
      const rest = lines[i].slice(depth);
      if (rest !== "-" && !rest.startsWith("- ")) throw new BlockParseError(`expected list item "- ": "${lines[i]}"`);
      const val = rest === "-" ? "" : rest.slice(2);
      if (!val.trim().startsWith("{") && /^[A-Za-z0-9_-]+:(\s|$)/.test(val.trim())) {
        throw new BlockParseError(`block-style list-of-maps not supported — use inline JSON {...} items: "${lines[i]}"`);
      }
      i++;
      out.push(parseValue(val));
    }
    return out;
  }

  function parseMap(depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
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
        out[key] = parseBlock(depth + 2);
      } else {
        out[key] = parseValue(valPart);
      }
    }
    return out;
  }

  return parseBlock(0);
}

/** Body text of a fenced block: JSON.parse first; on failure, restricted YAML subset. */
export function parseBlockBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  try { return JSON.parse(trimmed); } catch { /* fall through to YAML subset */ }
  return parseYamlSubset(text);
}
