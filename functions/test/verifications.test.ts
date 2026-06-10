import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { appendVerification } from "../src/services/events.js";
import { upsertLoop } from "../src/services/loops.js";

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

describe("appendVerification (service)", () => {
  it("writes project-direct with by: 'verifier' default and conditional keys absent", async () => {
    await seedProject();
    const id = await appendVerification("team1", "acme", { scenarioId: "s1", testRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", verdict: "confirmed" });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // server ULID
    const d = (await db().doc(`teams/team1/projects/acme/verifications/${id}`).get()).data()!;
    expect(d.scenarioId).toBe("s1");
    expect(d.testRunId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(d.verdict).toBe("confirmed");
    expect(d.by).toBe("verifier"); // default
    expect(d.createdAt).toBeDefined();
    expect("taskId" in d).toBe(false);   // omitted → key absent (byte-stable)
    expect("summary" in d).toBe(false);
  });

  it("stores taskId, summary, and an explicit by when provided", async () => {
    await seedProject();
    const id = await appendVerification("team1", "acme", { scenarioId: "s1", taskId: "t1", testRunId: "01A", verdict: "refuted", summary: "npm test → 4/6", by: "ci" });
    const d = (await db().doc(`teams/team1/projects/acme/verifications/${id}`).get()).data()!;
    expect(d.taskId).toBe("t1");
    expect(d.summary).toBe("npm test → 4/6");
    expect(d.by).toBe("ci");
  });

  it("writes loop-scoped under loops/l1/verifications", async () => {
    await seedProject();
    await upsertLoop("team1", "acme", "l1", { goal: "g", order: 1, status: "running" });
    const id = await appendVerification("team1", "acme", { scenarioId: "s1", testRunId: "01A", verdict: "confirmed" }, "l1");
    expect((await db().doc(`teams/team1/projects/acme/loops/l1/verifications/${id}`).get()).exists).toBe(true);
    expect((await db().doc(`teams/team1/projects/acme/verifications/${id}`).get()).exists).toBe(false);
  });

  it("404s when the loop does not exist", async () => {
    await seedProject();
    await expect(appendVerification("team1", "acme", { scenarioId: "s1", testRunId: "01A", verdict: "confirmed" }, "ghost"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(appendVerification("team1", "ghost", { scenarioId: "s1", testRunId: "01A", verdict: "confirmed" }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});
