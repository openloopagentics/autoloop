import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";
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
