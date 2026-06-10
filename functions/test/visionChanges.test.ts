import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { goalBody, scenarioBody } from "../src/schemas.js";
import { applyVisionChange, rejectVisionChange } from "../src/services/visionChanges.js";
import { upsertScenario } from "../src/services/scenarios.js";
import { upsertGoal } from "../src/services/goals.js";

const rubric = { criteria: [{ id: "c1", name: "C", weight: 1, max: 5 }] };

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running", visionOwner: "web" });
}

async function changeDocs() {
  return (await db().collection("teams/team1/projects/acme/visionChanges").orderBy("__name__").get()).docs;
}

describe("applyVisionChange", () => {
  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(applyVisionChange("team1", "ghost", { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("creates a goal exactly like a direct upsert (incl. visionOwner 'loop') and records prior: null", async () => {
    await seedProject();
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-goal", targetId: "g1", payload: { title: "Ship", order: 1 }, reason: "user asked for shipping" });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // server-generated ULID
    const g = (await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!;
    expect(g.title).toBe("Ship");
    expect(g.order).toBe(1);
    expect(g.createdAt).toBeDefined();
    expect(g.updatedAt).toBeDefined();
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop");
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c).toMatchObject({
      op: "upsert-goal", targetId: "g1", payload: { title: "Ship", order: 1 },
      prior: null, reason: "user asked for shipping", status: "applied",
    });
    expect(c.createdAt).toBeDefined();
    expect(c.decidedAt).toBeUndefined();
  });

  it("records the FULL prior doc on update (Timestamps round-trip) and stores originLoopId", async () => {
    await seedProject();
    await upsertScenario("team1", "acme", "s1", { goalId: "g1", title: "S", rubric, threshold: 80 });
    const before = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-scenario", targetId: "s1", payload: { threshold: 90, description: "tightened" },
        reason: "80 proved too lax", originLoopId: "loop-1" });
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c.prior.title).toBe("S");
    expect(c.prior.threshold).toBe(80);
    expect(c.prior.description).toBeUndefined();
    expect(c.prior.createdAt.toMillis()).toBe(before.createdAt.toMillis()); // Timestamp survives the change doc
    expect(c.originLoopId).toBe("loop-1");
    const s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.threshold).toBe(90);
    expect(s.description).toBe("tightened");
    expect(s.title).toBe("S"); // merge semantics, same as a direct upsert
  });

  it("payload validation errors match direct-upsert errors (service create-gates + zod)", async () => {
    await seedProject();
    // service-layer create-gate parity (exact messages from goals.ts / scenarios.ts)
    await expect(applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { order: 1 }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: "title is required when creating a goal" });
    await expect(applyVisionChange("team1", "acme", { op: "upsert-scenario", targetId: "s1", payload: { title: "S" }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: "goalId, title and rubric are required when creating a scenario" });
    // zod parity — the expected message comes from the SAME schema the direct route uses
    const expectedGoal = goalBody.safeParse({ title: "" }).error!.issues[0].message;
    await expect(applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "" }, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: expectedGoal });
    const badRubric = { goalId: "g1", title: "S", rubric: { criteria: [] } };
    const expectedScn = scenarioBody.safeParse(badRubric).error!.issues[0].message;
    await expect(applyVisionChange("team1", "acme", { op: "upsert-scenario", targetId: "s1", payload: badRubric, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400, message: expectedScn });
  });

  it("a scenario payload referencing a missing goal behaves exactly like the direct upsert", async () => {
    // Neither path checks goal existence (no referential gate in applyScenarioUpsert) — parity by reuse.
    await seedProject();
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-scenario", targetId: "s1", payload: { goalId: "ghost", title: "S", rubric }, reason: "r" });
    expect((await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!.goalId).toBe("ghost");
    expect((await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).exists).toBe(true);
  });

  it("a failed apply writes NO change doc and leaves visionOwner alone (atomic)", async () => {
    await seedProject();
    await expect(applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: {}, reason: "r" }))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect((await changeDocs()).length).toBe(0);
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("web");
  });

  it("server-generated change ids ascend (append order == id order)", async () => {
    await seedProject();
    const ids: string[] = [];
    for (const t of ["A", "B", "C"]) {
      ids.push(await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: t }, reason: `r-${t}` }));
    }
    expect([...ids].sort()).toEqual(ids); // lexical sort == append order (ULID)
    expect((await changeDocs()).map((d) => d.id)).toEqual(ids);
  });
});

describe("rejectVisionChange", () => {
  it("404s when the change does not exist", async () => {
    await seedProject();
    await expect(rejectVisionChange("team1", "acme", "01GHOSTGHOSTGHOSTGHOSTGHST"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it("restores prior WHOLESALE — added fields removed, updatedAt re-stamped, Timestamps round-trip", async () => {
    await seedProject();
    await upsertScenario("team1", "acme", "s1", { goalId: "g1", title: "S", rubric, threshold: 80 });
    const before = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    const id = await applyVisionChange("team1", "acme",
      { op: "upsert-scenario", targetId: "s1", payload: { threshold: 90, description: "added" }, reason: "r" });
    await rejectVisionChange("team1", "acme", id);
    const s = (await db().doc("teams/team1/projects/acme/scenarios/s1").get()).data()!;
    expect(s.threshold).toBe(80);
    expect("description" in s).toBe(false); // set WITHOUT merge: the added field is gone
    expect(s.title).toBe("S");
    expect(s.goalId).toBe("g1");
    expect(s.createdAt.toMillis()).toBe(before.createdAt.toMillis()); // Timestamp round-trip through prior
    expect(s.updatedAt.toMillis()).toBeGreaterThanOrEqual(before.updatedAt.toMillis()); // re-stamped, not the stale prior value
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c.status).toBe("rejected");
    expect(c.decidedAt).toBeDefined();
  });

  it("deletes the target when prior is null (the change created it)", async () => {
    await seedProject();
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g9", payload: { title: "New goal" }, reason: "r" });
    expect((await db().doc("teams/team1/projects/acme/goals/g9").get()).exists).toBe(true);
    await rejectVisionChange("team1", "acme", id);
    expect((await db().doc("teams/team1/projects/acme/goals/g9").get()).exists).toBe(false);
    expect((await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!.status).toBe("rejected");
  });

  it("re-reject is idempotent: no error, decidedAt unchanged, target NOT restored again", async () => {
    await seedProject();
    await upsertGoal("team1", "acme", "g1", { title: "Old" });
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "New" }, reason: "r" });
    await rejectVisionChange("team1", "acme", id);
    const decided1 = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!.decidedAt;
    await upsertGoal("team1", "acme", "g1", { title: "Newer" }); // mutate after the reject
    await rejectVisionChange("team1", "acme", id);               // second reject: no-op
    const c = (await db().doc(`teams/team1/projects/acme/visionChanges/${id}`).get()).data()!;
    expect(c.decidedAt.toMillis()).toBe(decided1.toMillis());
    expect((await db().doc("teams/team1/projects/acme/goals/g1").get()).data()!.title).toBe("Newer"); // untouched
  });

  it("does NOT touch visionOwner — the project stays loop-owned after reject", async () => {
    await seedProject();
    const id = await applyVisionChange("team1", "acme", { op: "upsert-goal", targetId: "g1", payload: { title: "G" }, reason: "r" });
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop");
    await rejectVisionChange("team1", "acme", id);
    expect((await db().doc("teams/team1/projects/acme").get()).data()!.visionOwner).toBe("loop");
  });
});
