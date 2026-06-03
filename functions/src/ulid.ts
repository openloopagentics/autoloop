import { randomBytes } from "node:crypto";

// Crockford base32 — alphabet is in ascending ASCII order, so lexical sort == numeric sort.
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10; // 50 bits encodes a 48-bit ms timestamp with headroom
const RANDOM_LEN = 16;

/**
 * A sortable, ULID-style id: <ms timestamp, base32> + <random suffix>. Gives a total
 * order even for events committed in the same millisecond. `now` is injectable for tests.
 * Date.now() is fine in functions/src (the no-Date.now() rule is for the throwaway prototype/).
 */
export function ulid(now: number = Date.now()): string {
  let time = now;
  const timeChars: string[] = new Array(TIME_LEN);
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    timeChars[i] = ENCODING[time % 32];
    time = Math.floor(time / 32);
  }
  const rand = randomBytes(RANDOM_LEN);
  let suffix = "";
  for (let i = 0; i < RANDOM_LEN; i++) suffix += ENCODING[rand[i] % 32];
  return timeChars.join("") + suffix;
}
