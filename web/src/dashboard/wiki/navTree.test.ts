import { describe, it, expect } from "vitest";
import { buildNavTree } from "./navTree";
import type { Page } from "../types";

const page = (id: string, path: string, title: string, order?: number): Page => ({ id, path, title, order });

describe("buildNavTree", () => {
  it("nests pages under directory segments of their path", () => {
    const tree = buildNavTree([
      page("overview", "overview.md", "Overview"),
      page("passkeys", "auth/passkeys.md", "Passkeys"),
    ]);
    const dir = tree.find((n) => n.title === "auth");
    expect(dir).toBeDefined();
    expect(dir!.pageId).toBeUndefined(); // synthetic dir node
    expect(dir!.children.map((c) => c.pageId)).toEqual(["passkeys"]);
    expect(tree.some((n) => n.pageId === "overview")).toBe(true);
  });

  it("creates synthetic nodes for missing intermediate directories", () => {
    const tree = buildNavTree([page("deep", "a/b/c.md", "Deep")]);
    const a = tree.find((n) => n.title === "a")!;
    expect(a.pageId).toBeUndefined();
    const b = a.children.find((n) => n.title === "b")!;
    expect(b.pageId).toBeUndefined();
    expect(b.children[0].pageId).toBe("deep");
  });

  it("sorts siblings by order then title", () => {
    const tree = buildNavTree([
      page("b", "b.md", "Bravo", 2),
      page("a", "a.md", "Alpha", 2),
      page("z", "z.md", "Zulu", 1),
    ]);
    expect(tree.map((n) => n.pageId)).toEqual(["z", "a", "b"]);
  });

  it("treats a missing order as 0", () => {
    const tree = buildNavTree([
      page("late", "late.md", "Late", 5),
      page("noorder", "noorder.md", "NoOrder"),
    ]);
    expect(tree[0].pageId).toBe("noorder");
  });

  it("keeps node keys unique when two pages share a path", () => {
    const tree = buildNavTree([
      page("a", "dup.md", "First"),
      page("b", "dup.md", "Second"),
    ]);
    const keys = tree.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate React keys
    expect(tree.map((n) => n.pageId).sort()).toEqual(["a", "b"]);
  });

  it("disambiguates a leaf path colliding with a directory key", () => {
    // "auth" is both a page path and the directory of "auth/login.md".
    const tree = buildNavTree([
      page("dir-and-page", "auth", "Auth page"),
      page("login", "auth/login.md", "Login"),
    ]);
    const allKeys: string[] = [];
    const walk = (ns: typeof tree) => ns.forEach((n) => { allKeys.push(n.key); walk(n.children); });
    walk(tree);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
