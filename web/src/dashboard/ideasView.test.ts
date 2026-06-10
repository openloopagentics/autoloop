import { describe, it, expect } from "vitest";
import { sortIdeas, moveIdea, ideaIdFor } from "./ideasView";
import type { Idea } from "./types";

const ts = (n: number) => ({ toMillis: () => n });

describe("sortIdeas", () => {
  it("sorts by band (accepted, proposed, rejected, done), then order, then createdAt", () => {
    const ideas: Idea[] = [
      { id: "d", status: "done", order: 1 },
      { id: "p-late", status: "proposed", order: 100, createdAt: ts(2) },
      { id: "r", status: "rejected", order: 1 },
      { id: "p-early", status: "proposed", order: 100, createdAt: ts(1) }, // tie → createdAt
      { id: "p-first", status: "proposed", order: 10 },
      { id: "a", status: "accepted", order: 99 },
    ];
    expect(sortIdeas(ideas).map((i) => i.id)).toEqual(["a", "p-first", "p-early", "p-late", "r", "d"]);
  });
  it("does not mutate its input", () => {
    const ideas: Idea[] = [{ id: "b", status: "done", order: 1 }, { id: "a", status: "accepted", order: 1 }];
    sortIdeas(ideas);
    expect(ideas[0].id).toBe("b");
  });
});

describe("moveIdea", () => {
  it("swaps order with the neighbor above within the same band", () => {
    const ideas: Idea[] = [
      { id: "p1", status: "proposed", order: 10 },
      { id: "p2", status: "proposed", order: 20 },
    ];
    expect(moveIdea(ideas, "p2", "up")).toEqual([{ id: "p1", order: 20 }, { id: "p2", order: 10 }]);
  });
  it("renumbers the whole band 10/20/30 when neighbors share an order (CLI defaults of 100), so reorder is never a no-op", () => {
    const ideas: Idea[] = [
      { id: "p1", status: "proposed", order: 100, createdAt: ts(1) },
      { id: "p2", status: "proposed", order: 100, createdAt: ts(2) },
      { id: "p3", status: "proposed", order: 100, createdAt: ts(3) },
    ];
    const writes = moveIdea(ideas, "p3", "up");
    const byId = Object.fromEntries(writes.map((w) => [w.id, w.order]));
    expect(byId.p3).toBe(20); // moved up into slot 2
    expect(byId.p2).toBe(30); // displaced down
    expect(byId.p1 ?? 10).toBe(10); // renumbered (or already there)
    // applying the writes must change the sorted sequence
    const after = ideas.map((i) => ({ ...i, order: byId[i.id] ?? i.order }));
    expect(sortIdeas(after).map((i) => i.id)).toEqual(["p1", "p3", "p2"]);
  });
  it("never crosses bands and is a no-op at the band edge", () => {
    const ideas: Idea[] = [
      { id: "a1", status: "accepted", order: 10 },
      { id: "p1", status: "proposed", order: 10 },
    ];
    expect(moveIdea(ideas, "p1", "up")).toEqual([]);   // top of its band — accepted above is out of reach
    expect(moveIdea(ideas, "a1", "down")).toEqual([]); // bottom of its band
    expect(moveIdea(ideas, "ghost", "up")).toEqual([]);
  });
});

describe("ideaIdFor", () => {
  it("slugifies the title", () => {
    expect(ideaIdFor("Add Dark Mode!", new Set())).toBe("add-dark-mode");
  });
  it("appends a short random suffix on collision", () => {
    expect(ideaIdFor("Dark mode", new Set(["dark-mode"]), () => "ab12")).toBe("dark-mode-ab12");
  });
  it("falls back to 'idea' for an unslugifiable title", () => {
    expect(ideaIdFor("!!!", new Set())).toBe("idea");
  });
});
