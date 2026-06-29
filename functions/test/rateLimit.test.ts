import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { RATE_LIMIT_MAX } from "../src/rateLimit.js";

const app = makeApp();
// Any path under the API-key subtree exercises the limiter; it runs before auth,
// so the exact downstream status (403/404) is irrelevant — only the 429 edge matters.
const PATH = "/v1/teams/team1/projects/proj/ideas";

describe("per-key rate limiting", () => {
  it(`returns 429 with Retry-After once a key exceeds ${RATE_LIMIT_MAX}/window`, async () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const res = await request(app).get(PATH).set(authHeader());
      expect(res.status).not.toBe(429); // within budget
    }
    const over = await request(app).get(PATH).set(authHeader());
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("rate_limited");
    expect(over.headers["retry-after"]).toBeDefined();
  });

  it("does not meter requests with no key (auth returns 401)", async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });
});
