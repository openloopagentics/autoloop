import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { upsertLoop } from "../src/services/loops.js";
import { upsertProject } from "../src/services/projects.js";
import { upsertPhase } from "../src/services/phases.js";
import { upsertTask } from "../src/services/tasks.js";

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

/** Loop l1 with one running phase and one task per non-terminal status, plus a failed task. */
async function seedLoopTree(loopId = "l1") {
  await seedProject();
  await upsertLoop("team1", "acme", loopId, { goal: "g", order: 1, status: "running" });
  await upsertPhase("team1", "acme", "p1", { name: "P", order: 1, status: "running" }, loopId);
  await upsertTask("team1", "acme", "t-run",     { phaseId: "p1", title: "A", order: 1, status: "running" }, loopId);
  await upsertTask("team1", "acme", "t-queued",  { phaseId: "p1", title: "B", order: 2, status: "queued"  }, loopId);
  await upsertTask("team1", "acme", "t-blocked", { phaseId: "p1", title: "C", order: 3, status: "blocked" }, loopId);
  await upsertTask("team1", "acme", "t-paused",  { phaseId: "p1", title: "D", order: 4, status: "paused"  }, loopId);
  await upsertTask("team1", "acme", "t-failed",  { phaseId: "p1", title: "E", order: 5, status: "failed"  }, loopId);
}
const loopDoc = (p: string) => db().doc(`teams/team1/projects/acme/loops/l1/${p}`);

describe("terminal backstop — loop close", () => {
  it("sweeps every non-terminal phase+task to the loop's terminal status (endedAt on phases only)", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    for (const id of ["t-run", "t-queued", "t-blocked", "t-paused"]) {
      const d = (await loopDoc(`tasks/${id}`).get()).data()!;
      expect(d.status).toBe("completed");
      expect(d.updatedAt).toBeDefined();
      expect("endedAt" in d).toBe(false); // tasks have no endedAt field
    }
    const p = (await loopDoc("phases/p1").get()).data()!;
    expect(p.status).toBe("completed");
    expect(p.endedAt).not.toBeNull();
  });

  it("nulls the loop's derived currentPhaseId/currentTaskId", async () => {
    await seedLoopTree();
    // sanity: the open phase/task are current before the close
    const before = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(before.currentPhaseId).toBe("p1");
    expect(before.currentTaskId).toBe("t-run");
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    const after = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(after.currentPhaseId).toBeNull();
    expect(after.currentTaskId).toBeNull();
  });

  it("leaves already-terminal docs byte-stable (failed task under a completed loop stays failed)", async () => {
    await seedLoopTree();
    const before = await loopDoc("tasks/t-failed").get();
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    const after = await loopDoc("tasks/t-failed").get();
    expect(after.data()!.status).toBe("failed"); // NOT promoted to completed
    expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true); // untouched
  });

  it("is idempotent: re-PUTting completed sweeps nothing", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "completed" });
    const taskBefore = await loopDoc("tasks/t-run").get();
    const phaseBefore = await loopDoc("phases/p1").get();
    await upsertLoop("team1", "acme", "l1", { status: "completed" }); // completed → completed: no transition
    expect((await loopDoc("tasks/t-run").get()).updateTime!.isEqual(taskBefore.updateTime!)).toBe(true);
    expect((await loopDoc("phases/p1").get()).updateTime!.isEqual(phaseBefore.updateTime!)).toBe(true);
    const loop = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(loop.currentPhaseId).toBeNull(); // pointers stay null
    expect(loop.currentTaskId).toBeNull();
  });

  it("maps cancelled → cancelled (honest semantics, same terminal status as the loop)", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "cancelled" });
    expect((await loopDoc("tasks/t-run").get()).data()!.status).toBe("cancelled");
    expect((await loopDoc("phases/p1").get()).data()!.status).toBe("cancelled");
    expect((await loopDoc("tasks/t-failed").get()).data()!.status).toBe("failed"); // already terminal: untouched
  });

  it("sweeps nothing on a non-terminal write", async () => {
    await seedLoopTree();
    await upsertLoop("team1", "acme", "l1", { status: "paused" });
    expect((await loopDoc("tasks/t-run").get()).data()!.status).toBe("running");
    expect((await loopDoc("phases/p1").get()).data()!.status).toBe("running");
    const loop = (await db().doc("teams/team1/projects/acme/loops/l1").get()).data()!;
    expect(loop.currentPhaseId).toBe("p1"); // pointers untouched
  });
});

describe("terminal backstop — project-direct (implicit main loop)", () => {
  const projDoc = (p: string) => db().doc(`teams/team1/projects/acme/${p}`);

  async function seedProjectDirectTree() {
    await seedProject();
    await upsertPhase("team1", "acme", "p1", { name: "P", order: 1, status: "running" });
    await upsertTask("team1", "acme", "t1", { phaseId: "p1", title: "T", order: 1, status: "running" });
  }

  it("project terminal transition sweeps project-direct phases/tasks and nulls the project pointers", async () => {
    await seedProjectDirectTree();
    await upsertProject("team1", "acme", { status: "completed" });
    expect((await projDoc("tasks/t1").get()).data()!.status).toBe("completed");
    const p = (await projDoc("phases/p1").get()).data()!;
    expect(p.status).toBe("completed");
    expect(p.endedAt).not.toBeNull();
    const proj = (await db().doc("teams/team1/projects/acme").get()).data()!;
    expect(proj.currentPhaseId).toBeNull();
    expect(proj.currentTaskId).toBeNull();
  });

  it("non-terminal project writes sweep nothing", async () => {
    await seedProjectDirectTree();
    await upsertProject("team1", "acme", { status: "paused" });
    expect((await projDoc("tasks/t1").get()).data()!.status).toBe("running");
    expect((await projDoc("phases/p1").get()).data()!.status).toBe("running");
  });

  it("re-PUTting completed is idempotent (no transition, no sweep)", async () => {
    await seedProjectDirectTree();
    await upsertProject("team1", "acme", { status: "completed" });
    const before = await projDoc("tasks/t1").get();
    await upsertProject("team1", "acme", { status: "completed" });
    expect((await projDoc("tasks/t1").get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  });
});
