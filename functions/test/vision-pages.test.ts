import { describe, it, expect } from "vitest";
// @ts-ignore - untyped .mjs imported for runtime test
import { parsePages, parseBlockBody } from "../../cli/vision-pages.mjs";

const scenarioJson = `{
  "id": "login-works",
  "goalId": "g1",
  "title": "Login succeeds",
  "order": 1,
  "threshold": 80,
  "rubric": { "criteria": [{ "id": "correctness", "name": "Correctness", "weight": 3, "max": 5 }] },
  "test": { "command": "npm test -- login" }
}`;

const scenarioYaml = `id: login-works
goalId: g1
title: Login succeeds
order: 1
threshold: 80
rubric:
  criteria:
    - { "id": "correctness", "name": "Correctness", "weight": 3, "max": 5 }
test:
  command: npm test -- login`;

const goalBlock = `{ "id": "g1", "title": "Sign in", "order": 1 }`;

const pageWith = (id: string, body: string, blocks: string) =>
  `---\n${body}\n---\n\n# Heading\n\n${blocks}\n`;

const goalFence = "```goal\n" + goalBlock + "\n```";
const scenarioFence = (b: string) => "```scenario\n" + b + "\n```";

describe("parsePages", () => {
  it("parses a valid page with frontmatter + one goal + one scenario (JSON body)", () => {
    const text = pageWith(
      "auth",
      "id: auth\ntitle: Authentication\norder: 2",
      `${goalFence}\n\n${scenarioFence(scenarioJson)}`
    );
    const r = parsePages([{ path: "auth/passkeys.md", text }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const page = r.pages[0];
    expect(page.id).toBe("auth");
    expect(page.path).toBe("auth/passkeys.md");
    expect(page.title).toBe("Authentication");
    expect(page.order).toBe(2);
    expect(page.markdown).toContain("# Heading");
    expect(page.markdown).toContain("```goal");
    expect(page.goalIds).toEqual(["g1"]);
    expect(page.scenarioIds).toEqual(["login-works"]);
    expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.goals).toEqual([{ id: "g1", title: "Sign in", order: 1 }]);
    expect(r.scenarios[0].id).toBe("login-works");
    // scenario keeps `test` (callers strip it before upload)
    expect(r.scenarios[0].test).toEqual({ command: "npm test -- login" });
  });

  it("produces a stable content hash for identical markdown", () => {
    const text = pageWith("auth", "id: auth\ntitle: Authentication", goalFence);
    const a = parsePages([{ path: "auth.md", text }]);
    const b = parsePages([{ path: "auth.md", text }]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.pages[0].contentHash).toBe(b.pages[0].contentHash);
  });

  it("parses a YAML scenario body identically to the JSON body", () => {
    const jsonText = pageWith("auth", "id: auth\ntitle: Auth", `${goalFence}\n\n${scenarioFence(scenarioJson)}`);
    const yamlText = pageWith("auth", "id: auth\ntitle: Auth", `${goalFence}\n\n${scenarioFence(scenarioYaml)}`);
    const j = parsePages([{ path: "j.md", text: jsonText }]);
    const y = parsePages([{ path: "y.md", text: yamlText }]);
    expect(j.ok && y.ok).toBe(true);
    if (!j.ok || !y.ok) return;
    expect(y.scenarios[0]).toEqual(j.scenarios[0]);
  });

  it("errors on missing frontmatter id, at file+line 1", () => {
    const text = pageWith("x", "title: No id here", goalFence);
    const r = parsePages([{ path: "noid.md", text }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ file: "noid.md", line: 1 });
    expect(r.errors[0].message).toMatch(/id/);
  });

  it("errors on a duplicate page id across two files, naming both files", () => {
    const a = pageWith("auth", "id: dup\ntitle: A", goalFence);
    const b = pageWith("auth", "id: dup\ntitle: B", goalFence);
    const r = parsePages([{ path: "a.md", text: a }, { path: "b.md", text: b }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.map((e: any) => `${e.file} ${e.message}`).join(" | ");
    expect(joined).toMatch(/a\.md/);
    expect(joined).toMatch(/b\.md/);
    expect(joined).toMatch(/dup/);
  });

  it("errors on a duplicate scenario id across two pages", () => {
    const a = pageWith("p1", "id: p1\ntitle: P1", `${goalFence}\n\n${scenarioFence(scenarioJson)}`);
    const b = pageWith("p2", "id: p2\ntitle: P2", `${goalFence}\n\n${scenarioFence(scenarioJson)}`);
    const r = parsePages([{ path: "a.md", text: a }, { path: "b.md", text: b }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e: any) => e.message).join(" ")).toMatch(/login-works/);
  });

  it("maps a dangling goalId error (from validateVision) to the block's file+line", () => {
    const dangling = scenarioJson.replace('"goalId": "g1"', '"goalId": "ghost"');
    const text = pageWith("p1", "id: p1\ntitle: P1", `${goalFence}\n\n${scenarioFence(dangling)}`);
    const r = parsePages([{ path: "auth/p.md", text }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const err = r.errors.find((e: any) => /ghost/.test(e.message));
    expect(err).toBeTruthy();
    expect(err.file).toBe("auth/p.md");
    // the scenario fence opens after frontmatter (3 lines) + blank + heading + blank + goal fence (3) + blank
    expect(typeof err.line).toBe("number");
    expect(err.line).toBeGreaterThan(1);
  });

  it("errors on an unclosed fence, at the opening line", () => {
    const text = "---\nid: p1\ntitle: P1\n---\n\nintro\n\n```goal\n" + goalBlock + "\n";
    const r = parsePages([{ path: "unclosed.md", text }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const err = r.errors.find((e: any) => /unclosed|closing|fence/i.test(e.message));
    expect(err).toBeTruthy();
    expect(err.file).toBe("unclosed.md");
    expect(err.line).toBe(8); // the ```goal line
  });

  it("errors when a page markdown exceeds 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    const text = `---\nid: big\ntitle: Big\n---\n\n${big}`;
    const r = parsePages([{ path: "big.md", text }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e: any) => e.message).join(" ")).toMatch(/100KB|split it/);
  });

  it("defaults order to 0 when omitted", () => {
    const text = pageWith("auth", "id: auth\ntitle: Auth", goalFence);
    const r = parsePages([{ path: "auth.md", text }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pages[0].order).toBe(0);
  });
});

describe("parseBlockBody", () => {
  it("coerces true/42/quoted-string scalars", () => {
    const out = parseBlockBody('flag: true\ncount: 42\nname: "hi there"');
    expect(out).toEqual({ flag: true, count: 42, name: "hi there" });
  });
});
