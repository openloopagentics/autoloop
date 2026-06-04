import { describe, it, expect } from "vitest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { hashKey } from "../src/apiKeys.js";
import { mintKey, listKeys, revokeKey } from "../src/services/apiKeys.js";

describe("apiKeys service", () => {
  it("mints a key: returns plaintext once, stores only the hash + metadata", async () => {
    const r = await mintKey("alice", "laptop");
    expect(r.key.startsWith("al_")).toBe(true);
    expect(r.id).toBe(hashKey(r.key));
    const doc = (await db().doc(`apiKeys/${r.id}`).get()).data()!;
    expect(doc.uid).toBe("alice");
    expect(doc.label).toBe("laptop");
    expect(doc.prefix).toBe(r.key.slice(0, 8));
    expect(doc.key).toBeUndefined();
    expect(doc.createdAt).toBeDefined();
  });

  it("lists only the caller's keys, without plaintext", async () => {
    await mintKey("alice", "a1");
    await mintKey("alice", "a2");
    await mintKey("bob", "b1");
    const keys = await listKeys("alice");
    expect(keys.length).toBe(2);
    expect(keys.every((k) => "id" in k && "label" in k && "prefix" in k && !("key" in k))).toBe(true);
  });

  it("revokes only the caller's own key; 404 otherwise", async () => {
    const r = await mintKey("alice", "a1");
    await expect(revokeKey("bob", r.id)).rejects.toMatchObject({ httpStatus: 404 });
    await revokeKey("alice", r.id);
    expect((await db().doc(`apiKeys/${r.id}`).get()).exists).toBe(false);
  });
});
