import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { makeApp } from "../src/app.js";
// @ts-ignore
import { run } from "../../cli/daloop.mjs";

const PLAINTEXT = "dl_integrationkey";
const KEY_HASH = createHash("sha256").update(PLAINTEXT).digest("hex");
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => { server = makeApp().listen(0, () => resolve()); });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => { server?.close(); });

async function seedKeyAndMember(teamId: string, uid = "agentX") {
  await db().doc(`apiKeys/${KEY_HASH}`).set({ uid, label: "it", prefix: "dl_integ" });
  await db().doc(`teams/${teamId}`).set({ name: "T", createdBy: uid });
  await db().doc(`teams/${teamId}/members/${uid}`).set({ uid, role: "member" });
}

function dir() { return mkdtempSync(join(tmpdir(), "daloop-it-")); }
const env = { DALOOP_API_KEY: PLAINTEXT };

describe("CLI end-to-end against the real API", () => {
  it("init -> project set -> phase start -> commit lands in Firestore", async () => {
    await seedKeyAndMember("itteam");
    const cwd = dir();
    const opts = { cwd, env, log: () => {}, err: () => {},
      gitRun: () => "abc123\n2026-06-02T10:00:00Z\nAgent\nfeat: x" };

    expect(await run(["init", "--team", "itteam", "--project", "web", "--url", baseUrl], opts)).toBe(0);
    expect(await run(["project", "set", "--title", "Web", "--status", "running"], opts)).toBe(0);
    expect(await run(["phase", "start", "build", "--name", "Build", "--order", "1"], opts)).toBe(0);
    expect(await run(["commit"], opts)).toBe(0);
    const project = (await db().doc("teams/itteam/projects/web").get()).data()!;
    expect(project.title).toBe("Web");
    expect(project.currentPhaseId).toBe("build");
    // commit now auto-creates the implicit 'main' task and lands under it
    const mainTask = (await db().doc("teams/itteam/projects/web/tasks/main").get()).data()!;
    expect(mainTask.phaseId).toBe("build");
    const commit = (await db().doc("teams/itteam/projects/web/tasks/main/commits/abc123").get()).data()!;
    expect(commit.message).toBe("feat: x");
    expect(commit.author).toBe("Agent");
  });

  it("vision import -> task start -> commit -> score/test-run/revise -> doc add all land in Firestore", async () => {
    await seedKeyAndMember("loopteam");
    const cwd = dir();
    const opts = { cwd, env, log: () => {}, err: () => {}, gitRun: () => "c0ffee\n2026-06-02T10:00:00Z\nAgent\nfeat: y" };
    writeFileSync(join(cwd, "vision.json"), JSON.stringify({
      goals: [{ id: "g1", title: "Ship", order: 1 }],
      scenarios: [{ id: "s1", goalId: "g1", title: "Login", rubric: { criteria: [{ id: "correctness", name: "C", weight: 3, max: 5 }] } }],
    }));
    expect(await run(["init", "--team", "loopteam", "--project", "web", "--url", baseUrl], opts)).toBe(0);
    expect(await run(["project", "set", "--title", "Web", "--status", "running"], opts)).toBe(0);
    expect(await run(["phase", "start", "build", "--name", "Build", "--order", "1"], opts)).toBe(0);
    expect(await run(["vision", "import", "--file", "vision.json"], opts)).toBe(0);
    expect(await run(["task", "start", "t1", "--phase", "build", "--name", "Login", "--order", "1", "--scenarios", "s1"], opts)).toBe(0);
    expect(await run(["commit", "--task", "t1"], opts)).toBe(0);
    expect(await run(["score", "s1", "--task", "t1", "--criterion", "correctness=4", "--composite", "80"], opts)).toBe(0);
    expect(await run(["test-run", "s1", "--task", "t1", "--passed", "5", "--failed", "0"], opts)).toBe(0);
    expect(await run(["revise", "--scenario", "s1", "--reason", "tighten", "--change", "add:t2"], opts)).toBe(0);
    expect(await run(["doc", "add", "--kind", "notes", "--title", "Run Notes", "--url", "https://x.com/n"], opts)).toBe(0);

    expect((await db().doc("teams/loopteam/projects/web/scenarios/s1").get()).data()!.title).toBe("Login");
    expect((await db().doc("teams/loopteam/projects/web/tasks/t1/commits/c0ffee").get()).data()!.message).toBe("feat: y");
    expect((await db().collection("teams/loopteam/projects/web/scores").get()).size).toBe(1);
    expect((await db().collection("teams/loopteam/projects/web/testRuns").get()).size).toBe(1);
    expect((await db().collection("teams/loopteam/projects/web/revisions").get()).size).toBe(1);
    expect((await db().doc("teams/loopteam/projects/web/documents/run-notes").get()).data()!.format).toBe("url");
  });

  it("a bad key warns and returns 0 (best-effort); strict returns 1", async () => {
    const cwd = dir();
    const opts = { cwd, env: { DALOOP_API_KEY: "dl_wrong" }, log: () => {}, err: () => {} };
    await run(["init", "--team", "itteam", "--project", "web", "--url", baseUrl], opts);
    expect(await run(["project", "set", "--title", "x", "--status", "running"], opts)).toBe(0);
    expect(await run(["project", "set", "--title", "x", "--status", "running", "--strict"], opts)).toBe(1);
  });

  it("a non-member key -> 403 warning, returns 0", async () => {
    // The global beforeEach (helpers.ts) wipes Firestore before each test, so re-seed
    // the key here — but with NO membership in 'lonelyteam' so it reaches 403 (not 401).
    await db().doc(`apiKeys/${KEY_HASH}`).set({ uid: "agentX", label: "it", prefix: "dl_integ" });
    await db().doc("teams/lonelyteam").set({ name: "L", createdBy: "someoneelse" });
    const cwd = dir();
    const opts = { cwd, env, log: () => {}, err: () => {} };
    await run(["init", "--team", "lonelyteam", "--project", "web", "--url", baseUrl], opts);
    expect(await run(["project", "set", "--title", "x", "--status", "running"], opts)).toBe(0);
    expect(await run(["project", "set", "--title", "x", "--status", "running", "--strict"], opts)).toBe(1);
  });
});
