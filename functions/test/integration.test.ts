import { describe, it, expect } from "vitest";
import request from "supertest";
import "./helpers.js";
import { authHeader, seedMember } from "./helpers.js";
import { makeApp } from "../src/app.js";
import { db } from "../src/firestore.js";

const app = makeApp();

async function seedTeam(teamId = "team1") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId); // TEST_UID becomes a member so the test key can write
}

describe("full loop reporting flow", () => {
  it("project -> phase -> commit, with derived current phase", async () => {
    await seedTeam();

    await request(app).put("/v1/teams/team1/projects/acme")
      .set(authHeader()).send({ title: "Acme Web", status: "running", design: { format: "markdown", content: "# Plan" } })
      .expect(200);

    await request(app).put("/v1/teams/team1/projects/acme/phases/build")
      .set(authHeader()).send({ name: "Build", order: 1, status: "running" }).expect(200);

    await request(app).put("/v1/teams/team1/projects/acme/phases/build/commits/deadbeef")
      .set(authHeader()).send({ message: "first commit", author: "claude", committedAt: "2026-06-01T12:00:00Z" })
      .expect(200);

    const project = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(project.currentPhaseId).toBe("build");

    const commit = (await db().doc("teams/team1/projects/acme/phases/build/commits/deadbeef").get()).data()!;
    expect(commit.message).toBe("first commit");
  });
});
