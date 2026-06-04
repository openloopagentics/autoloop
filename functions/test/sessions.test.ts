import { describe, it, expect } from "vitest";
import { sessionBody } from "../src/schemas.js";

describe("sessionBody schema", () => {
  it("accepts a valid session", () => {
    const r = sessionBody.safeParse({
      sessionId: "0ee0ac9d-27e2-4439-b550-933f226aaa24",
      startedAt: 1000,
      endedAt: 2000,
      entries: [
        { kind: "user", text: "hello", ts: 1000 },
        { kind: "assistant", text: "hi", ts: 1001 },
        { kind: "tool", name: "Bash", summary: "ls -la", ok: true, ts: 1002 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects sessionId that contains uppercase beyond UUID hex", () => {
    const r = sessionBody.safeParse({
      sessionId: "INVALID SESSION ID!",
      startedAt: 1000, endedAt: 2000, entries: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects text longer than 500 chars", () => {
    const r = sessionBody.safeParse({
      sessionId: "abc123",
      startedAt: 1000, endedAt: 2000,
      entries: [{ kind: "user", text: "x".repeat(501), ts: 1000 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 2000 entries", () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ kind: "user" as const, text: "hi", ts: i }));
    const r = sessionBody.safeParse({ sessionId: "abc123", startedAt: 0, endedAt: 1, entries });
    expect(r.success).toBe(false);
  });
});
