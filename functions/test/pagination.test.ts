import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";
import { clampLimit, parseLimitParam, MAX_LIST_LIMIT } from "../src/pagination.js";

describe("clampLimit", () => {
  it("defaults to MAX when absent or invalid", () => {
    expect(clampLimit(undefined)).toBe(MAX_LIST_LIMIT);
    expect(clampLimit(0)).toBe(MAX_LIST_LIMIT);
    expect(clampLimit(-5)).toBe(MAX_LIST_LIMIT);
    expect(clampLimit(Number.NaN)).toBe(MAX_LIST_LIMIT);
  });
  it("caps to MAX and floors fractional limits", () => {
    expect(clampLimit(10_000)).toBe(MAX_LIST_LIMIT);
    expect(clampLimit(2)).toBe(2);
    expect(clampLimit(3.9)).toBe(3);
  });
});

describe("parseLimitParam", () => {
  it("parses strings/arrays and rejects non-numeric", () => {
    expect(parseLimitParam("10")).toBe(10);
    expect(parseLimitParam(["7"])).toBe(7);
    expect(parseLimitParam("abc")).toBeUndefined();
    expect(parseLimitParam(undefined)).toBeUndefined();
  });
});

const app = makeApp();
async function seed() {
  await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
  await seedMember("team1");
  await request(app).put("/v1/teams/team1/projects/proj").set(authHeader()).send({ title: "P", status: "running" });
}

describe("GET ideas honours the ?limit= cap", () => {
  it("returns at most the requested number of docs", async () => {
    await seed();
    for (let i = 0; i < 5; i++) {
      await request(app).put(`/v1/teams/team1/projects/proj/ideas/idea${i}`).set(authHeader())
        .send({ title: `t${i}`, status: "proposed", order: i });
    }
    const res = await request(app).get("/v1/teams/team1/projects/proj/ideas?limit=2").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ideas).toHaveLength(2);
  });
});
