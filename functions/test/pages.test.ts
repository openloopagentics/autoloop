import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}
async function createProject(slug = "acme") {
  await seedTeam();
  await request(app).put(`/v1/teams/team1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}

function pageBody(over: Record<string, unknown> = {}) {
  return {
    path: "docs/intro.md",
    title: "Intro",
    order: 1,
    markdown: "# Intro\n\nhello",
    contentHash: HASH,
    goalIds: ["g1"],
    scenarioIds: ["s1", "s2"],
    ...over,
  };
}

describe("PUT /v1/teams/:teamId/projects/:slug/pages/:pageId", () => {
  it("creates a page doc with all fields + updatedAt timestamp", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader()).send(pageBody());
    expect(res.status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/pages/p1").get()).data()!;
    expect(d.path).toBe("docs/intro.md");
    expect(d.title).toBe("Intro");
    expect(d.order).toBe(1);
    expect(d.markdown).toBe("# Intro\n\nhello");
    expect(d.contentHash).toBe(HASH);
    expect(d.goalIds).toEqual(["g1"]);
    expect(d.scenarioIds).toEqual(["s1", "s2"]);
    expect(d.updatedAt).toBeTruthy();
    expect(d.updatedAt.toDate()).toBeInstanceOf(Date);
  });

  it("advances updatedAt on re-upsert", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader()).send(pageBody());
    const first = (await db().doc("teams/team1/projects/acme/pages/p1").get()).data()!.updatedAt.toMillis();
    await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader())
      .send(pageBody({ contentHash: HASH2 }));
    const second = (await db().doc("teams/team1/projects/acme/pages/p1").get()).data()!.updatedAt.toMillis();
    expect(second).toBeGreaterThan(first);
  });

  it("updates an existing page (changed title + hash)", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader()).send(pageBody());
    const res = await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader())
      .send(pageBody({ title: "Introduction", contentHash: HASH2 }));
    expect(res.status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/pages/p1").get()).data()!;
    expect(d.title).toBe("Introduction");
    expect(d.contentHash).toBe(HASH2);
  });

  it("404s when the project does not exist", async () => {
    await seedTeam();
    const res = await request(app).put("/v1/teams/team1/projects/ghost/pages/p1").set(authHeader()).send(pageBody());
    expect(res.status).toBe(404);
  });

  it("403s when not a member of the team (transitively, via missing project)", async () => {
    const res = await request(app).put("/v1/teams/ghostteam/projects/acme/pages/p1").set(authHeader()).send(pageBody());
    expect(res.status).toBe(403);
  });

  it("400s on a bad contentHash", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader())
      .send(pageBody({ contentHash: "not-a-sha" }));
    expect(res.status).toBe(400);
  });

  it("400s on markdown over 100KB", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader())
      .send(pageBody({ markdown: "x".repeat(100 * 1024 + 1) }));
    expect(res.status).toBe(400);
  });

  it("400s on an invalid id inside scenarioIds", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader())
      .send(pageBody({ scenarioIds: ["ok", "BAD/ID"] }));
    expect(res.status).toBe(400);
  });

  it("400s on an invalid pageId", async () => {
    await createProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/pages/BAD%2FID").set(authHeader()).send(pageBody());
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/teams/:teamId/projects/:slug/pages", () => {
  it("lists {id, contentHash} only — no markdown in the payload", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader()).send(pageBody());
    await request(app).put("/v1/teams/team1/projects/acme/pages/p2").set(authHeader())
      .send(pageBody({ path: "docs/b.md", title: "B", contentHash: HASH2 }));
    const res = await request(app).get("/v1/teams/team1/projects/acme/pages").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const byId = Object.fromEntries(res.body.pages.map((p: { id: string; contentHash: string }) => [p.id, p]));
    expect(byId.p1).toEqual({ id: "p1", contentHash: HASH });
    expect(byId.p2).toEqual({ id: "p2", contentHash: HASH2 });
    // The list is a sync diff endpoint — it must never ship page bodies.
    for (const p of res.body.pages) {
      expect(Object.keys(p).sort()).toEqual(["contentHash", "id"]);
      expect(p).not.toHaveProperty("markdown");
    }
  });

  it("returns an empty list for a project with zero pages", async () => {
    await createProject();
    const res = await request(app).get("/v1/teams/team1/projects/acme/pages").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, pages: [] });
  });
});

describe("DELETE /v1/teams/:teamId/projects/:slug/pages/:pageId", () => {
  it("removes the page doc", async () => {
    await createProject();
    await request(app).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader()).send(pageBody());
    const res = await request(app).delete("/v1/teams/team1/projects/acme/pages/p1").set(authHeader());
    expect(res.status).toBe(200);
    expect((await db().doc("teams/team1/projects/acme/pages/p1").get()).exists).toBe(false);
  });

  it("returns 200 deleting a nonexistent page (resume-safe idempotent delete)", async () => {
    await createProject();
    const res = await request(app).delete("/v1/teams/team1/projects/acme/pages/ghost").set(authHeader());
    expect(res.status).toBe(200);
  });

  it("400s on an invalid pageId", async () => {
    await createProject();
    const res = await request(app).delete("/v1/teams/team1/projects/acme/pages/BAD%2FID").set(authHeader());
    expect(res.status).toBe(400);
  });
});
