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
import { createMessage, listPendingUserMessages, ackMessage } from "../src/services/messages.js";

const app = makeApp();

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
}

async function createProject(slug = "acme") {
  await seedTeam();
  await request(app)
    .put(`/v1/teams/team1/projects/${slug}`)
    .set(authHeader())
    .send({ title: "Acme", status: "running" });
}

describe("createMessage", () => {
  it("stores text/author/status:pending/createdAt for user messages and returns an id", async () => {
    await createProject();
    const id = await createMessage("team1", "acme", "hello agent", "user", "u1");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    const doc = await db().doc(`teams/team1/projects/acme/messages/${id}`).get();
    expect(doc.exists).toBe(true);
    const data = doc.data()!;
    expect(data.text).toBe("hello agent");
    expect(data.author).toBe("user");
    expect(data.status).toBe("pending");
    expect(data.createdAt).toBeDefined();
  });

  it("stores author:agent with NO status key for agent messages", async () => {
    await createProject();
    const id = await createMessage("team1", "acme", "agent reply here", "agent", "agent1");
    const doc = await db().doc(`teams/team1/projects/acme/messages/${id}`).get();
    expect(doc.exists).toBe(true);
    const data = doc.data()!;
    expect(data.author).toBe("agent");
    expect(Object.prototype.hasOwnProperty.call(data, "status")).toBe(false);
    expect(data.text).toBe("agent reply here");
  });

  it("404s when the project does not exist", async () => {
    await seedTeam();
    await expect(createMessage("team1", "ghost", "hi", "user", "u1"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("listPendingUserMessages", () => {
  it("returns only author==user && status==pending, oldest-first by id", async () => {
    await createProject();
    const id1 = await createMessage("team1", "acme", "first", "user", "u1");
    const id2 = await createMessage("team1", "acme", "second", "user", "u1");
    // agent reply — should NOT appear
    await createMessage("team1", "acme", "agent says hi", "agent", "agent1");

    const msgs = await listPendingUserMessages("team1", "acme");
    expect(msgs.length).toBe(2);
    // oldest first (ULID ids are time-ordered)
    expect(msgs[0].id).toBe(id1);
    expect(msgs[1].id).toBe(id2);
    expect(msgs[0].text).toBe("first");
  });

  it("excludes delivered user messages", async () => {
    await createProject();
    const id1 = await createMessage("team1", "acme", "msg1", "user", "u1");
    await createMessage("team1", "acme", "msg2", "user", "u1");
    // ack msg1 → delivered
    await ackMessage("team1", "acme", id1, "agent1");

    const msgs = await listPendingUserMessages("team1", "acme");
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe("msg2");
  });

  it("returns an empty array when no pending messages", async () => {
    await createProject();
    const msgs = await listPendingUserMessages("team1", "acme");
    expect(msgs).toEqual([]);
  });

  it("caps results at the max param (default 50)", async () => {
    await createProject();
    // seed 3 messages, cap at 2
    await createMessage("team1", "acme", "a", "user", "u1");
    await createMessage("team1", "acme", "b", "user", "u1");
    await createMessage("team1", "acme", "c", "user", "u1");
    const msgs = await listPendingUserMessages("team1", "acme", 2);
    expect(msgs.length).toBe(2);
  });

  it("404s when the project does not exist", async () => {
    await seedTeam();
    await expect(listPendingUserMessages("team1", "ghost"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("ackMessage", () => {
  it("flips status to delivered, stamps deliveredAt and ackedBy", async () => {
    await createProject();
    const id = await createMessage("team1", "acme", "please ack me", "user", "u1");
    await ackMessage("team1", "acme", id, "agent1");

    const doc = await db().doc(`teams/team1/projects/acme/messages/${id}`).get();
    const data = doc.data()!;
    expect(data.status).toBe("delivered");
    expect(data.deliveredAt).toBeDefined();
    expect(data.ackedBy).toBe("agent1");
  });

  it("is idempotent: re-ack leaves deliveredAt unchanged", async () => {
    await createProject();
    const id = await createMessage("team1", "acme", "idempotent test", "user", "u1");
    await ackMessage("team1", "acme", id, "agent1");
    const snapFirst = await db().doc(`teams/team1/projects/acme/messages/${id}`).get();
    const deliveredAtFirst = snapFirst.data()!.deliveredAt;

    // re-ack — should be no-op
    await ackMessage("team1", "acme", id, "agent1");
    const snapSecond = await db().doc(`teams/team1/projects/acme/messages/${id}`).get();
    const deliveredAtSecond = snapSecond.data()!.deliveredAt;

    expect(deliveredAtFirst.toMillis()).toBe(deliveredAtSecond.toMillis());
  });

  it("throws 404 on a missing message id", async () => {
    await createProject();
    await expect(ackMessage("team1", "acme", "nonexistent-id", "agent1"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("404s when the project does not exist", async () => {
    await seedTeam();
    await expect(ackMessage("team1", "ghost", "some-id", "agent1"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

// ─── API route tests ───────────────────────────────────────────────────────────

// User-auth mini-app (mirrors userProjects.test.ts pattern)
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

async function seedUserMember(uid = "alice") {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed: true });
  await db().doc("teams/team1").set({ name: "Team", createdBy: uid });
  await db().doc(`teams/team1/members/${uid}`).set({ uid, role: "member" });
  // also seed the agent member so agentApp (requireApiKeyMember) can create the project
  await seedMember("team1");
}

// Agent-auth app (full makeApp + authHeader)
const agentApp = makeApp();

describe("POST /v1/u/teams/:teamId/projects/:slug/messages — user-send", () => {
  it("returns 200 {ok, id} and stores a pending user message", async () => {
    await seedUserMember();
    // create project via agent app first
    await request(agentApp)
      .put("/v1/teams/team1/projects/acme")
      .set(authHeader())
      .send({ title: "Acme", status: "running" });
    const res = await request(userApp())
      .post("/v1/u/teams/team1/projects/acme/messages")
      .set(tok("alice"))
      .send({ text: "hello agent" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe("string");
    const doc = await db().doc(`teams/team1/projects/acme/messages/${res.body.id}`).get();
    expect(doc.data()?.author).toBe("user");
    expect(doc.data()?.status).toBe("pending");
  });

  it("returns 400 on empty text", async () => {
    await seedUserMember();
    await request(agentApp)
      .put("/v1/teams/team1/projects/acme")
      .set(authHeader())
      .send({ title: "Acme", status: "running" });
    const res = await request(userApp())
      .post("/v1/u/teams/team1/projects/acme/messages")
      .set(tok("alice"))
      .send({ text: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/teams/:teamId/projects/:slug/messages — agent pull", () => {
  it("returns 200 {ok, messages:[...]} with only pending user messages", async () => {
    await createProject();
    const id1 = await createMessage("team1", "acme", "user msg", "user", "u1");
    await createMessage("team1", "acme", "agent reply", "agent", "agent1");
    const res = await request(agentApp)
      .get("/v1/teams/team1/projects/acme/messages")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages.length).toBe(1);
    expect(res.body.messages[0].id).toBe(id1);
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/messages/:id/ack — agent ack", () => {
  it("returns 200, flips message to delivered, pull no longer returns it", async () => {
    await createProject();
    const id = await createMessage("team1", "acme", "ack me", "user", "u1");

    const ackRes = await request(agentApp)
      .post(`/v1/teams/team1/projects/acme/messages/${id}/ack`)
      .set(authHeader())
      .send({});
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.ok).toBe(true);

    // doc is now delivered
    const doc = await db().doc(`teams/team1/projects/acme/messages/${id}`).get();
    expect(doc.data()?.status).toBe("delivered");

    // pull no longer returns it
    const pullRes = await request(agentApp)
      .get("/v1/teams/team1/projects/acme/messages")
      .set(authHeader());
    expect(pullRes.body.messages.length).toBe(0);
  });
});

describe("POST /v1/teams/:teamId/projects/:slug/messages — agent reply", () => {
  it("returns 200 {ok, id}; message is author:agent with no status; not returned by pull", async () => {
    await createProject();
    const res = await request(agentApp)
      .post("/v1/teams/team1/projects/acme/messages")
      .set(authHeader())
      .send({ text: "agent says hi" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe("string");

    const doc = await db().doc(`teams/team1/projects/acme/messages/${res.body.id}`).get();
    expect(doc.data()?.author).toBe("agent");
    expect(Object.prototype.hasOwnProperty.call(doc.data(), "status")).toBe(false);

    // not returned by pull
    const pullRes = await request(agentApp)
      .get("/v1/teams/team1/projects/acme/messages")
      .set(authHeader());
    expect(pullRes.body.messages.length).toBe(0);
  });

  it("returns 400 on empty text", async () => {
    await createProject();
    const res = await request(agentApp)
      .post("/v1/teams/team1/projects/acme/messages")
      .set(authHeader())
      .send({ text: "" });
    expect(res.status).toBe(400);
  });
});

// ─── A4: task-boundary pendingMessages piggyback ──────────────────────────────

describe("PUT /v1/teams/:teamId/projects/:slug/tasks/:taskId — pendingMessages piggyback", () => {
  it("returns pendingMessages array with pending user messages when they exist", async () => {
    await createProject();
    await request(agentApp)
      .put("/v1/teams/team1/projects/acme/phases/p1")
      .set(authHeader())
      .send({ name: "Phase 1", order: 1, status: "running" });
    // seed a pending user message
    await createMessage("team1", "acme", "please fix the bug", "user", "u1");

    const res = await request(agentApp)
      .put("/v1/teams/team1/projects/acme/tasks/t1")
      .set(authHeader())
      .send({ phaseId: "p1", title: "Task 1", order: 1, status: "running" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.pendingMessages)).toBe(true);
    expect(res.body.pendingMessages.length).toBeGreaterThan(0);
    expect(res.body.pendingMessages[0].text).toBe("please fix the bug");
  });

  it("returns pendingMessages as [] when no pending messages exist", async () => {
    await createProject();
    await request(agentApp)
      .put("/v1/teams/team1/projects/acme/phases/p1")
      .set(authHeader())
      .send({ name: "Phase 1", order: 1, status: "running" });

    const res = await request(agentApp)
      .put("/v1/teams/team1/projects/acme/tasks/t1")
      .set(authHeader())
      .send({ phaseId: "p1", title: "Task 1", order: 1, status: "running" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.pendingMessages).toEqual([]);
  });

  it("loop-scoped task PUT returns project-level pendingMessages (no loopId passed to listPendingUserMessages)", async () => {
    await createProject();
    await request(agentApp)
      .put("/v1/teams/team1/projects/acme/loops/l1")
      .set(authHeader())
      .send({ goal: "build feature", order: 1, status: "running" });
    await request(agentApp)
      .put("/v1/teams/team1/projects/acme/loops/l1/phases/p1")
      .set(authHeader())
      .send({ name: "Phase 1", order: 1, status: "running" });
    // seed a pending user message at the project level
    await createMessage("team1", "acme", "user msg for loop task", "user", "u1");

    const res = await request(agentApp)
      .put("/v1/teams/team1/projects/acme/loops/l1/tasks/t1")
      .set(authHeader())
      .send({ phaseId: "p1", title: "Loop Task 1", order: 1, status: "running" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.pendingMessages)).toBe(true);
    expect(res.body.pendingMessages.length).toBe(1);
    expect(res.body.pendingMessages[0].text).toBe("user msg for loop task");
  });
});
