import { describe, it, expect } from "vitest";
import { generateKey, hashKey, keyDisplayPrefix, KEY_PREFIX } from "../src/apiKeys.js";

describe("apiKeys crypto", () => {
  it("generates dl_-prefixed keys that are unique", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.startsWith(KEY_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("hashes the FULL plaintext (incl. prefix) to a stable 64-char hex sha256", () => {
    const h1 = hashKey("dl_abc");
    const h2 = hashKey("dl_abc");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey("dl_abc")).not.toBe(hashKey("abc"));
  });

  it("display prefix is the first 8 chars", () => {
    expect(keyDisplayPrefix("dl_abcdefghij")).toBe("dl_abcde");
  });
});
