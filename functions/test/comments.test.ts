import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";
import { makeRequireUser } from "../src/requireUser.js";
import { requireMember } from "../src/requireMember.js";
import { userProjectsRouter } from "../src/routes/userProjects.js";
import { errorHandler } from "../src/errors.js";

const agentApp = makeApp();
const HASH = "a".repeat(64);

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}
async function createProject(slug = "acme") {
  await seedTeam();
  await request(agentApp).put(`/v1/teams/team1/projects/${slug}`).set(authHeader()).send({ title: "Acme", status: "running" });
}

// ─── User-auth mini-app (mirrors messages.test.ts / userProjects.test.ts) ────────
const stubVerify = async (t: string) => {
  const m = t.match(/^good-(.+)$/);
  if (!m) throw new Error("x");
  return { uid: m[1] };
};
function userApp() {
  const a = express();
  a.use(express.json());
  a.use("/v1/u/teams/:teamId/projects", makeRequireUser(stubVerify), requireMember, userProjectsRouter);
  a.use(errorHandler);
  return a;
}
const tok = (uid: string) => ({ Authorization: `Bearer good-${uid}` });

// Seed a user member with an explicit role, plus the agent member so the agent app can
// create the project.
async function seedUserMember(uid = "alice", role = "member") {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed: true });
  await db().doc("teams/team1").set({ name: "Team", createdBy: uid });
  await db().doc(`teams/team1/members/${uid}`).set({ uid, role });
  await seedMember("team1"); // agent member (agent1)
}

function commentBody(over: Record<string, unknown> = {}) {
  return {
    pageId: "p1",
    anchor: { exact: "the vision says X", prefix: "before ", suffix: " after" },
    body: "this is wrong",
    severity: "blocking",
    ...over,
  };
}

// Create a comment via the user API and return its id.
async function createComment(over: Record<string, unknown> = {}, uid = "alice") {
  const res = await request(userApp())
    .post("/v1/u/teams/team1/projects/acme/comments")
    .set(tok(uid))
    .send(commentBody(over));
  return res.body.id as string;
}

describe("POST /v1/u/teams/:teamId/projects/:slug/comments — user create", () => {
  it("creates an open comment doc with author=uid, empty thread, anchor + severity", async () => {
    await createProject();
    await seedUserMember();
    const res = await request(userApp())
      .post("/v1/u/teams/team1/projects/acme/comments")
      .set(tok("alice"))
      .send(commentBody({ targetScenarioId: "s1" }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe("string");

    const d = (await db().doc(`teams/team1/projects/acme/comments/${res.body.id}`).get()).data()!;
    expect(d.pageId).toBe("p1");
    expect(d.anchor).toEqual({ exact: "the vision says X", prefix: "before ", suffix: " after" });
    expect(d.targetScenarioId).toBe("s1");
    expect(d.body).toBe("this is wrong");
    expect(d.severity).toBe("blocking");
    expect(d.author).toBe("alice");
    expect(d.status).toBe("open");
    expect(d.thread).toEqual([]);
    expect(d.createdAt).toBeDefined();
  });

  it("returns 400 on an oversized body", async () => {
    await createProject();
    await seedUserMember();
    const res = await request(userApp())
      .post("/v1/u/teams/team1/projects/acme/comments")
      .set(tok("alice"))
      .send(commentBody({ body: "x".repeat(10_001) }));
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/teams/:teamId/projects/:slug/comments — agent pull", () => {
  it("returns full comment docs", async () => {
    await createProject();
    await seedUserMember();
    const id = await createComment();
    const res = await request(agentApp).get("/v1/teams/team1/projects/acme/comments").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.comments.length).toBe(1);
    expect(res.body.comments[0].id).toBe(id);
    expect(res.body.comments[0].body).toBe("this is wrong");
    expect(res.body.comments[0].author).toBe("alice");
  });

  it("?status=open excludes resolved comments", async () => {
    await createProject();
    await seedUserMember();
    const openId = await createComment();
    const resolvedId = await createComment();
    await request(agentApp)
      .post(`/v1/teams/team1/projects/acme/comments/${resolvedId}/resolve`)
      .set(authHeader())
      .send({ resolution: "resolved" });

    const res = await request(agentApp).get("/v1/teams/team1/projects/acme/comments?status=open").set(authHeader());
    expect(res.status).toBe(200);
    const ids = res.body.comments.map((c: { id: string }) => c.id);
    expect(ids).toContain(openId);
    expect(ids).not.toContain(resolvedId);
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/comments/:id/reply — agent reply", () => {
  it("appends an {by:agent,text,at} entry to the thread", async () => {
    await createProject();
    await seedUserMember();
    const id = await createComment();
    const res = await request(agentApp)
      .post(`/v1/teams/team1/projects/acme/comments/${id}/reply`)
      .set(authHeader())
      .send({ text: "looking into it" });
    expect(res.status).toBe(200);

    const d = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!;
    expect(d.thread.length).toBe(1);
    expect(d.thread[0].by).toBe("agent");
    expect(d.thread[0].text).toBe("looking into it");
    expect(d.thread[0].at).toBeDefined();
  });

  it("404s on an unknown comment id", async () => {
    await createProject();
    const res = await request(agentApp)
      .post("/v1/teams/team1/projects/acme/comments/NONEXISTENT/reply")
      .set(authHeader())
      .send({ text: "hi" });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/comments/:id/resolve — agent resolve", () => {
  it("sets status + resolvedAt", async () => {
    await createProject();
    await seedUserMember();
    const id = await createComment();
    const res = await request(agentApp)
      .post(`/v1/teams/team1/projects/acme/comments/${id}/resolve`)
      .set(authHeader())
      .send({ resolution: "resolved", note: "fixed the wording" });
    expect(res.status).toBe(200);

    const d = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!;
    expect(d.status).toBe("resolved");
    expect(d.resolvedAt).toBeDefined();
    // note becomes a final agent thread entry
    expect(d.thread.length).toBe(1);
    expect(d.thread[0].by).toBe("agent");
    expect(d.thread[0].text).toBe("fixed the wording");
  });

  it("resolving twice is a 200 no-op", async () => {
    await createProject();
    await seedUserMember();
    const id = await createComment();
    await request(agentApp)
      .post(`/v1/teams/team1/projects/acme/comments/${id}/resolve`)
      .set(authHeader())
      .send({ resolution: "resolved" });
    const firstResolvedAt = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!.resolvedAt;

    const res = await request(agentApp)
      .post(`/v1/teams/team1/projects/acme/comments/${id}/resolve`)
      .set(authHeader())
      .send({ resolution: "declined" });
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!;
    expect(d.status).toBe("resolved"); // unchanged by the second call
    expect(d.resolvedAt.toMillis()).toBe(firstResolvedAt.toMillis());
  });

  it("404s on an unknown comment id", async () => {
    await createProject();
    const res = await request(agentApp)
      .post("/v1/teams/team1/projects/acme/comments/NONEXISTENT/resolve")
      .set(authHeader())
      .send({ resolution: "resolved" });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/u/teams/:teamId/projects/:slug/comments/:id/accept — user accept", () => {
  it("accept by the author sets accepted + acceptedBy", async () => {
    await createProject();
    await seedUserMember();
    const id = await createComment();
    const res = await request(userApp())
      .post(`/v1/u/teams/team1/projects/acme/comments/${id}/accept`)
      .set(tok("alice"))
      .send({});
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!;
    expect(d.accepted).toBe(true);
    expect(d.acceptedBy).toBe("alice");
  });

  it("accept by an admin (non-author) sets accepted + acceptedBy", async () => {
    await createProject();
    await seedUserMember(); // alice = member, author
    const id = await createComment();
    // bob is an admin on the team
    await db().doc("users/bob").set({ email: "bob@x.com", isAllowed: true });
    await db().doc("teams/team1/members/bob").set({ uid: "bob", role: "admin" });
    const res = await request(userApp())
      .post(`/v1/u/teams/team1/projects/acme/comments/${id}/accept`)
      .set(tok("bob"))
      .send({});
    expect(res.status).toBe(200);
    const d = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!;
    expect(d.accepted).toBe(true);
    expect(d.acceptedBy).toBe("bob");
  });

  it("403s for a non-author plain member", async () => {
    await createProject();
    await seedUserMember(); // alice = member, author
    const id = await createComment();
    // carol is a plain member (allowed user + team member), not the author — so the 403
    // comes from the accept role check, not from requireUser/requireMember.
    await db().doc("users/carol").set({ email: "carol@x.com", isAllowed: true });
    await db().doc("teams/team1/members/carol").set({ uid: "carol", role: "member" });
    const res = await request(userApp())
      .post(`/v1/u/teams/team1/projects/acme/comments/${id}/accept`)
      .set(tok("carol"))
      .send({});
    expect(res.status).toBe(403);
    const d = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!;
    expect(d.accepted).toBeUndefined();
  });

  it("400s when accepting an advisory comment", async () => {
    await createProject();
    await seedUserMember();
    const id = await createComment({ severity: "advisory" });
    const res = await request(userApp())
      .post(`/v1/u/teams/team1/projects/acme/comments/${id}/accept`)
      .set(tok("alice"))
      .send({});
    expect(res.status).toBe(400);
  });

  it("404s on an unknown comment id", async () => {
    await createProject();
    await seedUserMember();
    const res = await request(userApp())
      .post("/v1/u/teams/team1/projects/acme/comments/NONEXISTENT/accept")
      .set(tok("alice"))
      .send({});
    expect(res.status).toBe(404);
  });
});

// ─── Cross-resource: comments survive page deletion ─────────────────────────────
describe("comments survive page deletion", () => {
  it("deleting the anchored page via the pages API leaves the comment intact", async () => {
    await createProject();
    await seedUserMember();
    // seed page p1
    await request(agentApp).put("/v1/teams/team1/projects/acme/pages/p1").set(authHeader()).send({
      path: "docs/intro.md",
      title: "Intro",
      order: 1,
      markdown: "# Intro",
      contentHash: HASH,
      goalIds: [],
      scenarioIds: [],
    });
    const id = await createComment({ pageId: "p1" });

    const del = await request(agentApp).delete("/v1/teams/team1/projects/acme/pages/p1").set(authHeader());
    expect(del.status).toBe(200);
    expect((await db().doc("teams/team1/projects/acme/pages/p1").get()).exists).toBe(false);

    // the comment must still exist
    const d = (await db().doc(`teams/team1/projects/acme/comments/${id}`).get()).data()!;
    expect(d).toBeDefined();
    expect(d.pageId).toBe("p1");
    expect(d.status).toBe("open");
  });
});
