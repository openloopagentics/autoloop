import { randomBytes, createHash } from "node:crypto";

export const KEY_PREFIX = "dl_";

/** A fresh API key: "dl_" + 32 random bytes (base64url). Plaintext, shown once. */
export function generateKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** SHA-256 (hex) of the FULL plaintext including the dl_ prefix — used as the doc id. */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** First 8 chars of the plaintext, stored for display (e.g. "dl_ab12c"). */
export function keyDisplayPrefix(plaintext: string): string {
  return plaintext.slice(0, 8);
}
