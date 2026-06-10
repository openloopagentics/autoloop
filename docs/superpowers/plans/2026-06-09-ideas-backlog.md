# Ideas backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the loop's between-rounds improvement ideas durable and user-steerable: a project-level `idea` entity (proposed/accepted/rejected/done lifecycle) the loop proposes via PUT, the user accepts/rejects/reorders/adds from a new Ideas dashboard tab, and the next loop picks from deterministically (accepted-first, then proposed by order, never rejected).

**Architecture:** Purely additive, mirroring the bug-entity pattern exactly (idempotent PUT with a client-supplied id, run data, no `visionOwner` stamp, no transaction) — but project-direct **only**, never loop-scoped: ideas outlive loops, so they live beside `messages`. Adds the third agent **read** endpoint (GET list, after messages pull and loop state). User writes ride the existing `/v1/u/` ID-token + membership path **without** `assertWebEditable` — steering must work *while* the loop owns the project (autonomous-with-veto). `by` is server-stamped from the auth path (agent key ⇒ `"agent"`, `/v1/u/` ⇒ `"user"`), never client-supplied. `decidedAt` is stamped the FIRST time status becomes accepted/rejected (including create-as-accepted/rejected) and never overwritten — mirrors `bug.fixedAt`. No `firestore.rules` change (the recursive project match already covers `ideas/{id}`); rules **tests** only.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript, Firestore Admin SDK), Express routers, zod validation, Vitest + Firestore emulator, dependency-free Node CLI (`cli/autoloop.mjs`), React + Vite + Firestore listeners (web), Testing Library + jsdom (web tests).

**Spec:** `docs/superpowers/specs/2026-06-09-ideas-backlog-design.md`

**Conventions (read before starting):**
- Run a single functions test file with the emulator already running: `cd functions && npm run test:run -- <name>`. The full suite (spins up the emulator) is `cd functions && npm test`. Rules tests: `cd functions && npm run test:rules` (or via the full `npm test`). Functions build: `cd functions && npm run build`. Web suite: `cd web && npm test`. (All verified against `functions/package.json` and `web/package.json`.)
- All new entity bodies enforce required-on-create in the **service layer**, not zod (zod marks fields optional — see `services/bugs.ts`, `services/loops.ts`).
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- The CLI has **three copies** kept identical via `bash scripts/sync-autoloop-cli.sh`: canonical `cli/autoloop.mjs` → `web/public/skill/autoloop.mjs` + `plugins/autoloop/bin/autoloop`. Sync after CLI edits (Task 11 verifies).
- The driver skill also has two copies: `plugins/autoloop/skills/autoloop/SKILL.md` (canonical) → `web/public/skill/autoloop/SKILL.md` — the same sync script copies it. Any skill change requires a plugin version bump in `plugins/autoloop/.claude-plugin/plugin.json` (currently `0.10.1`).

---

### Task 1: `ideaBody` schema

**Files:**
- Modify: `functions/src/schemas.ts` (add after the `bugBody` block, ~line 65 — it reuses `id` and `CONTENT_MAX_BYTES`)
- Test: `functions/test/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/schemas.test.ts` (extend the existing import line with `ideaBody`):

```ts
describe("ideaBody", () => {
  it("accepts a minimal proposed idea", () => {
    expect(ideaBody.safeParse({ title: "Dark mode", status: "proposed", order: 100 }).success).toBe(true);
  });
  it("accepts the optional fields", () => {
    expect(ideaBody.safeParse({ title: "X", rationale: "users asked", status: "accepted", order: 1, originLoopId: "loop-1", builtInLoopId: "loop-2" }).success).toBe(true);
  });
  it("accepts a partial body (all fields optional — required-on-create is the service's job)", () => {
    expect(ideaBody.safeParse({ status: "rejected" }).success).toBe(true);
  });
  it("rejects an unknown status", () => {
    expect(ideaBody.safeParse({ title: "X", status: "maybe", order: 1 }).success).toBe(false);
  });
  it("rejects a non-integer order", () => {
    expect(ideaBody.safeParse({ title: "X", status: "proposed", order: 1.5 }).success).toBe(false);
  });
  it("rejects a non-idPattern originLoopId", () => {
    expect(ideaBody.safeParse({ title: "X", status: "proposed", order: 1, originLoopId: "Bad Id" }).success).toBe(false);
  });
  it("rejects a rationale over 100KB", () => {
    const big = "x".repeat(100 * 1024 + 1);
    expect(ideaBody.safeParse({ title: "X", status: "proposed", order: 1, rationale: big }).success).toBe(false);
  });
  it("drops unknown keys, including a client-supplied by (plain z.object)", () => {
    const parsed = ideaBody.parse({ title: "X", status: "proposed", order: 1, by: "agent", createdAt: "nope" });
    expect("by" in parsed).toBe(false);
    expect("createdAt" in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- schemas`
Expected: FAIL (`ideaBody` is not exported).

- [ ] **Step 3: Implement**

In `functions/src/schemas.ts`, add **after** the `export type BugBody = ...` line (~line 65):

```ts
const ideaStatus = z.enum(["proposed", "accepted", "rejected", "done"]);
export const ideaBody = z.object({
  title: z.string().min(1).optional(),       // required-on-create in the service
  rationale: z.string().max(CONTENT_MAX_BYTES, "idea.rationale exceeds 100KB").optional(),
  status: ideaStatus.optional(),             // required-on-create in the service
  order: z.number().int().optional(),        // required-on-create in the service
  originLoopId: id.optional(),
  builtInLoopId: id.optional(),
});
export type IdeaBody = z.infer<typeof ideaBody>;
```

(`by` is deliberately NOT in the body — server-owned, derived from the auth path; plain `z.object` drops it if sent.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/test/schemas.test.ts
git commit -m "feat(ideas): ideaBody schema (status enum, 100KB rationale cap, server-owned by dropped)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `upsertIdea` + `listIdeas` service

**Files:**
- Create: `functions/src/services/ideas.ts`
- Test: `functions/test/ideas.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

`functions/test/ideas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "./helpers.js";
import { seedMember } from "./helpers.js";
import { db } from "../src/firestore.js";
import { upsertIdea, listIdeas } from "../src/services/ideas.js";

async function seedProject(teamId = "team1", slug = "acme") {
  await db().doc(`teams/${teamId}`).set({ name: "Team", createdBy: "u1" });
  await seedMember(teamId);
  await db().doc(`teams/${teamId}/projects/${slug}`).set({ title: "Acme", status: "running" });
}

describe("upsertIdea", () => {
  it("requires title, status AND order on create", async () => {
    await seedProject();
    await expect(upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed" }, "agent")).rejects.toMatchObject({ httpStatus: 400 });
    await expect(upsertIdea("team1", "acme", "i1", { title: "X", order: 1 }, "agent")).rejects.toMatchObject({ httpStatus: 400 });
    await expect(upsertIdea("team1", "acme", "i1", { status: "proposed", order: 1 }, "agent")).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("creates with createdAt, by from the arg, decidedAt:null", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "Dark mode", rationale: "asked", status: "proposed", order: 100, originLoopId: "loop-1" }, "agent");
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.title).toBe("Dark mode");
    expect(d.rationale).toBe("asked");
    expect(d.status).toBe("proposed");
    expect(d.order).toBe(100);
    expect(d.originLoopId).toBe("loop-1");
    expect(d.by).toBe("agent");
    expect(d.createdAt).toBeDefined();
    expect(d.decidedAt).toBeNull();
  });

  it("stamps by:'user' when created via the user path arg", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 1 }, "user");
    expect((await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.by).toBe("user");
  });

  it("partial update sets only provided fields and never touches by/createdAt", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 100 }, "agent");
    const before = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    await upsertIdea("team1", "acme", "i1", { order: 10 }, "user"); // user reorder must not flip by
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.order).toBe(10);
    expect(d.title).toBe("X");
    expect(d.by).toBe("agent");
    expect(d.createdAt.toMillis()).toBe(before.createdAt.toMillis());
  });

  it("stamps decidedAt once on first accept and keeps it stable across re-PUTs", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 1 }, "agent");
    await upsertIdea("team1", "acme", "i1", { status: "accepted" }, "user");
    const decided1 = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.decidedAt;
    expect(decided1).not.toBeNull();
    await upsertIdea("team1", "acme", "i1", { status: "rejected" }, "user"); // flip — decidedAt unchanged
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.status).toBe("rejected");
    expect(d.decidedAt.toMillis()).toBe(decided1.toMillis());
  });

  it("stamps decidedAt when the idea is CREATED directly as accepted (and as rejected)", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "accepted", order: 1 }, "user");
    expect((await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.decidedAt).not.toBeNull();
    await upsertIdea("team1", "acme", "i2", { title: "Y", status: "rejected", order: 2 }, "user");
    expect((await db().doc("teams/team1/projects/acme/ideas/i2").get()).data()!.decidedAt).not.toBeNull();
  });

  it("does NOT stamp decidedAt for proposed or done", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 1 }, "agent");
    await upsertIdea("team1", "acme", "i1", { status: "done", builtInLoopId: "loop-2" }, "agent");
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.decidedAt).toBeNull();
    expect(d.builtInLoopId).toBe("loop-2");
  });

  it("404s when the project does not exist", async () => {
    await db().doc("teams/team1").set({ name: "T", createdBy: "u1" });
    await seedMember("team1");
    await expect(upsertIdea("team1", "ghost", "i1", { title: "X", status: "proposed", order: 1 }, "agent"))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("listIdeas", () => {
  it("sorts by status band (accepted, proposed, rejected, done), then order, then createdAt; serializes timestamps", async () => {
    await seedProject();
    // insertion order is deliberately scrambled; same-band order ties fall back to createdAt
    await upsertIdea("team1", "acme", "done-1",     { title: "D", status: "done",     order: 1 },   "agent");
    await upsertIdea("team1", "acme", "prop-late",  { title: "P2", status: "proposed", order: 100 }, "agent");
    await upsertIdea("team1", "acme", "rej-1",      { title: "R", status: "rejected", order: 1 },   "user");
    await upsertIdea("team1", "acme", "prop-early", { title: "P1", status: "proposed", order: 100 }, "agent"); // tie on order — created later
    await upsertIdea("team1", "acme", "prop-first", { title: "P0", status: "proposed", order: 10 },  "agent");
    await upsertIdea("team1", "acme", "acc-1",      { title: "A", status: "accepted", order: 50 },  "user");

    const ideas = await listIdeas("team1", "acme");
    expect(ideas.map((i) => i.id)).toEqual(["acc-1", "prop-first", "prop-late", "prop-early", "rej-1", "done-1"]);
    expect(typeof ideas[0].createdAt).toBe("string"); // ISO, like the messages GET
    expect(typeof ideas[0].updatedAt).toBe("string");
    expect(ideas[0].decidedAt === null || typeof ideas[0].decidedAt === "string").toBe(true);
    expect(ideas[0].by).toBe("user");
  });

  it("returns [] for a project with no ideas and 404s on a missing project", async () => {
    await seedProject();
    expect(await listIdeas("team1", "acme")).toEqual([]);
    await expect(listIdeas("team1", "ghost")).rejects.toMatchObject({ httpStatus: 404 });
  });
});
```

> `AppError` carries `httpStatus`, so `.rejects.toMatchObject({ httpStatus: 400/404 })` works without importing it (same as `bugs.test.ts`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- ideas`
Expected: FAIL (`services/ideas.js` does not exist).

- [ ] **Step 3: Implement**

`functions/src/services/ideas.ts`:

```ts
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../errors.js";
import { resolveBase } from "./baseRef.js";
import type { IdeaBody } from "../schemas.js";

/** Band ranks for listing: the user's queue first, then the loop's proposals, then the vetoed, then the shipped. */
const BAND: Record<string, number> = { accepted: 0, proposed: 1, rejected: 2, done: 3 };

/**
 * Upsert an idea (idempotent PUT). PROJECT-DIRECT ONLY — ideas outlive the loop that
 * proposed them, so there is no loopId variant. An idea is run data — no derived
 * currentX, no visionOwner stamp, no transaction (mirrors upsertBug).
 * `by` is the caller's AUTH PATH (agent key vs /v1/u/), never the request body.
 * decidedAt is stamped the FIRST time status becomes accepted/rejected — including
 * when the idea is created directly as accepted/rejected — and never updated after.
 */
export async function upsertIdea(teamId: string, slug: string, ideaId: string, body: IdeaBody, by: "agent" | "user"): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug); // project-level (404s on a missing project)
  const ideaRef = baseRef.collection("ideas").doc(ideaId);
  const snap = await ideaRef.get();
  const creating = !snap.exists;
  if (creating && (body.title === undefined || body.status === undefined || body.order === undefined)) {
    throw new AppError(400, "validation", "title, status and order are required when creating an idea");
  }
  const existing = snap.data() ?? {};
  const newStatus = body.status ?? existing.status;

  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (creating) { data.createdAt = FieldValue.serverTimestamp(); data.by = by; data.decidedAt = null; }
  if (body.title !== undefined) data.title = body.title;
  if (body.rationale !== undefined) data.rationale = body.rationale;
  if (body.status !== undefined) data.status = body.status;
  if (body.order !== undefined) data.order = body.order;
  if (body.originLoopId !== undefined) data.originLoopId = body.originLoopId;
  if (body.builtInLoopId !== undefined) data.builtInLoopId = body.builtInLoopId;
  // decidedAt = the FIRST transition into accepted/rejected (overrides the create-time null).
  if ((newStatus === "accepted" || newStatus === "rejected") && !existing.decidedAt) {
    data.decidedAt = FieldValue.serverTimestamp();
  }

  await ideaRef.set(data, { merge: true });
}

export interface IdeaView {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  decidedAt: string | null;
  [k: string]: unknown;
}

/**
 * List ALL ideas, sorted in memory: status band (accepted → proposed → rejected → done),
 * then order, then createdAt. Ideas are tens, not thousands — single collection read,
 * no composite index (consistent with the existing YAGNI-on-indexes decision).
 * Server timestamps serialized to ISO strings like the messages GET.
 */
export async function listIdeas(teamId: string, slug: string): Promise<IdeaView[]> {
  const { baseRef } = await resolveBase(teamId, slug);
  const snap = await baseRef.collection("ideas").get();
  const iso = (v: unknown): string | null => {
    const ts = v as { toDate?: () => Date } | null | undefined;
    return ts?.toDate ? ts.toDate().toISOString() : null;
  };
  const ideas: IdeaView[] = snap.docs.map((d) => {
    const v = d.data();
    return { ...v, id: d.id, createdAt: iso(v.createdAt), updatedAt: iso(v.updatedAt), decidedAt: iso(v.decidedAt) };
  });
  ideas.sort((a, b) =>
    ((BAND[a.status as string] ?? 9) - (BAND[b.status as string] ?? 9))
    || ((a.order as number ?? 0) - (b.order as number ?? 0))
    || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  return ideas;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- ideas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/ideas.ts functions/test/ideas.test.ts
git commit -m "feat(ideas): upsertIdea + listIdeas service (project-direct, decidedAt-once, band sort)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Agent router (PUT + GET) + mount

**Files:**
- Create: `functions/src/routes/ideas.ts`
- Modify: `functions/src/app.ts` (import + ONE project-direct mount — no loop-scoped mount, ideas are never loop-scoped)
- Test: extend `functions/test/ideas.test.ts` with Supertest API tests

- [ ] **Step 1: Write the failing API tests**

Append to `functions/test/ideas.test.ts` (add the imports `request from "supertest"`, `authHeader` from `./helpers.js`, `makeApp` from `../src/app.js` at the top):

```ts
import request from "supertest";
import { authHeader } from "./helpers.js";
import { makeApp } from "../src/app.js";

const app = makeApp();

describe("ideas agent API", () => {
  it("PUT creates an idea and stamps by:'agent' (a client-supplied by is ignored)", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "Dark mode", status: "proposed", order: 100, by: "user" }); // by must be DROPPED
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.title).toBe("Dark mode");
    expect(d.by).toBe("agent"); // from the API-key path, not the body
  });

  it("PUT 400s when creating without the title+status+order trio", async () => {
    await seedProject();
    const res = await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "X", status: "proposed" });
    expect(res.status).toBe(400);
  });

  it("PUT applies a partial update to an existing idea", async () => {
    await seedProject();
    await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "X", status: "proposed", order: 100 });
    const res = await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ status: "done", builtInLoopId: "loop-2" });
    expect(res.status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.status).toBe("done");
    expect(d.builtInLoopId).toBe("loop-2");
    expect(d.title).toBe("X");
  });

  it("PUT 400s on an unknown status enum and 404s on a missing project", async () => {
    await seedProject();
    expect((await request(app).put("/v1/teams/team1/projects/acme/ideas/i1").set(authHeader())
      .send({ title: "X", status: "maybe", order: 1 })).status).toBe(400);
    expect((await request(app).put("/v1/teams/team1/projects/ghost/ideas/i1").set(authHeader())
      .send({ title: "X", status: "proposed", order: 1 })).status).toBe(404);
  });

  it("GET lists ideas band-sorted with serialized timestamps", async () => {
    await seedProject();
    await upsertIdea("team1", "acme", "p1", { title: "P", status: "proposed", order: 5 }, "agent");
    await upsertIdea("team1", "acme", "a1", { title: "A", status: "accepted", order: 99 }, "user");
    await upsertIdea("team1", "acme", "r1", { title: "R", status: "rejected", order: 1 }, "user");
    const res = await request(app).get("/v1/teams/team1/projects/acme/ideas").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ideas.map((i: { id: string }) => i.id)).toEqual(["a1", "p1", "r1"]);
    expect(typeof res.body.ideas[0].createdAt).toBe("string");
    expect(typeof res.body.ideas[0].decidedAt).toBe("string"); // accepted → decided
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- ideas`
Expected: FAIL (route 404s — no mount yet).

- [ ] **Step 3: Implement the router**

`functions/src/routes/ideas.ts`:

```ts
import { Router } from "express";
import { idPattern, ideaBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertIdea, listIdeas } from "../services/ideas.js";

export const ideasRouter = Router({ mergeParams: true }); // agent (API key) — project-direct only

ideasRouter.put("/:ideaId", async (req, res, next) => {
  try {
    const { teamId, slug, ideaId } = req.params as Record<string, string>;
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["ideaId", ideaId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = ideaBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertIdea(teamId, slug, ideaId, parsed.data, "agent"); // by from the auth path
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

ideasRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const ideas = await listIdeas(teamId, slug);
    res.status(200).json({ ok: true, ideas });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Mount in `app.ts`**

Add the import next to the other route imports:

```ts
import { ideasRouter } from "./routes/ideas.js";
```

Add the **project-direct** mount with the other project-direct entity mounts (immediately after `teamRouter.use("/:slug/messages", messagesRouter);`, ~line 53):

```ts
  teamRouter.use("/:slug/ideas", ideasRouter);
```

No loop-scoped mount — ideas are deliberately project-direct only.

- [ ] **Step 5: Run to verify it passes**

Run: `cd functions && npm run test:run -- ideas`
Expected: PASS (service + agent API tests).

- [ ] **Step 6: Commit**

```bash
git add functions/src/routes/ideas.ts functions/src/app.ts functions/test/ideas.test.ts
git commit -m "feat(ideas): agent PUT + GET routes, project-direct mount

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: User PUT on the `/v1/u/` subtree (no `assertWebEditable`)

**Files:**
- Modify: `functions/src/routes/userProjects.ts` (add the ideas PUT handler after the messages POST, ~line 139)
- Test: extend `functions/test/ideas.test.ts` (user-auth mini-app, mirroring `messages.test.ts` ~lines 156-177)

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/ideas.test.ts` (add the imports `express from "express"`, and `makeRequireUser` / `requireMember` / `userProjectsRouter` / `errorHandler` from their `../src/...` modules at the top):

```ts
import express from "express";
import { makeRequireUser } from "../src/requireUser.js";
import { requireMember } from "../src/requireMember.js";
import { userProjectsRouter } from "../src/routes/userProjects.js";
import { errorHandler } from "../src/errors.js";

// User-auth mini-app (mirrors messages.test.ts / userProjects.test.ts pattern)
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
  await db().doc(`teams/team1/members/${uid}`).set({ uid, role: "member" });
}

describe("PUT /v1/u/teams/:teamId/projects/:slug/ideas/:ideaId — user steer", () => {
  it("member 200: creates with by:'user' (client-supplied by ignored)", async () => {
    await seedProject();
    await seedUserMember();
    const res = await request(userApp()).put("/v1/u/teams/team1/projects/acme/ideas/i1").set(tok("alice"))
      .send({ title: "My idea", status: "proposed", order: 100, by: "agent" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect((await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.by).toBe("user");
  });

  it("member 200: accepts an agent-proposed idea (partial update)", async () => {
    await seedProject();
    await seedUserMember();
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 100 }, "agent");
    const res = await request(userApp()).put("/v1/u/teams/team1/projects/acme/ideas/i1").set(tok("alice"))
      .send({ status: "accepted" });
    expect(res.status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!;
    expect(d.status).toBe("accepted");
    expect(d.decidedAt).not.toBeNull();
    expect(d.by).toBe("agent"); // creator unchanged
  });

  it("non-member 403", async () => {
    await seedProject();
    await seedUserMember();
    await db().doc("users/bob").set({ email: "b@x.com", isAllowed: true });
    const res = await request(userApp()).put("/v1/u/teams/team1/projects/acme/ideas/i1").set(tok("bob"))
      .send({ status: "rejected" });
    expect(res.status).toBe(403);
  });

  it("works WHILE the loop owns the vision (visionOwner === 'loop') — the veto, no assertWebEditable", async () => {
    await seedProject();
    await seedUserMember();
    await db().doc("teams/team1/projects/acme").set({ visionOwner: "loop" }, { merge: true });
    await upsertIdea("team1", "acme", "i1", { title: "X", status: "proposed", order: 100 }, "agent");
    const res = await request(userApp()).put("/v1/u/teams/team1/projects/acme/ideas/i1").set(tok("alice"))
      .send({ status: "rejected" });
    expect(res.status).toBe(200); // a goal PUT would 409 here — ideas deliberately do not
    expect((await db().doc("teams/team1/projects/acme/ideas/i1").get()).data()!.status).toBe("rejected");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- ideas`
Expected: FAIL (the `/v1/u/.../ideas/:ideaId` route 404s — no handler yet).

- [ ] **Step 3: Implement**

In `functions/src/routes/userProjects.ts`, add to the imports: `ideaBody` (extend the `../schemas.js` import line) and:

```ts
import { upsertIdea } from "../services/ideas.js";
```

Add after the messages POST handler (end of file, ~line 139):

```ts
// ideas: PUT /:slug/ideas/:ideaId — accept / reject / reorder / add.
// Deliberately NO assertWebEditable: steering must work WHILE the loop owns the
// project (visionOwner === "loop") — that is the whole point of the veto.
userProjectsRouter.put("/:slug/ideas/:ideaId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "ideaId"]);
    const parsed = ideaBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug, ideaId } = req.params as Record<string, string>;
    await upsertIdea(teamId, slug, ideaId, parsed.data, "user"); // by from the auth path
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- ideas`
Expected: PASS (all idea tests). Also run `cd functions && npm run test:run -- userProjects` — expected: PASS (no regression on the existing user routes).

- [ ] **Step 5: Commit**

```bash
git add functions/src/routes/userProjects.ts functions/test/ideas.test.ts
git commit -m "feat(ideas): user PUT on /v1/u/ (member-gated, no assertWebEditable — veto works mid-loop)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rules tests for the ideas subtree

No rules change (the recursive `match /projects/{slug}/{document=**}` already covers `ideas/{id}`). Tests only: member-read / non-member-deny / client-write-deny.

**Files:**
- Modify: `functions/test-rules/rules.test.ts` (extend `seedProjectTree` ~line 249 + the loop-contract `paths` array ~line 299)

- [ ] **Step 1: Seed an idea doc in `seedProjectTree`**

In `functions/test-rules/rules.test.ts`, inside `seedProjectTree`, add next to the project-direct `bugs/b1` seed (~line 249):

```ts
    await fs.doc(`teams/${teamId}/projects/web/ideas/i1`).set({ title: "I", status: "proposed", order: 1, by: "agent" });
```

- [ ] **Step 2: Add the path to the loop-contract describe block**

In `describe("rules: loop-contract subcollections", …)` (~line 296), add `"ideas/i1"` to its `paths` array (after `"bugs/b1"`). The block already asserts read-allow for members, read-deny for non-members, and write-deny for owners over every path. (No entry in the loop-subcollections block — ideas are never loop-scoped.)

- [ ] **Step 3: Run the rules suite to verify it passes**

Run: `cd functions && npm run test:rules`
Expected: PASS (the ideas path is member-readable, non-member-denied, client-write-denied — covered by the recursive rule with no rules change).

- [ ] **Step 4: Commit**

```bash
git add functions/test-rules/rules.test.ts
git commit -m "test(rules): cover ideas subtree (member-read, client-write-deny)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CLI `idea add` / `idea set` / `idea list`

`idea` is a two-word verb group (like `bug add`/`bug set`) — do NOT add to `ONE_WORD`. All three are **project-level** (no `loopSeg`). `idea list` reuses `fetchJson`, which needs a small generalization: it currently hard-codes the `"messages pull"` failure label and JSON-prints `body.messages ?? body`. Add optional `label` + `render` deps (defaults preserve the messages behavior byte-for-byte).

**Files:**
- Modify: `cli/autoloop.mjs` (generalize `fetchJson` ~lines 130-158; add three cases after the `bug set` case ends ~line 477, before `case "commit"`)
- Test: `functions/test/cli.unit.test.ts` (new describe block)

- [ ] **Step 1: Write the failing tests**

Add a describe block to `functions/test/cli.unit.test.ts` (model on the "bug add/set verbs" block — reuse the existing `run`, `tmp`, `saveConfig` imports):

```ts
describe("idea add/set/list verbs", () => {
  function initDir(extra: Record<string, unknown> = {}) {
    const dir = tmp();
    saveConfig(dir, { apiUrl: "http://api", teamId: "acme", projectSlug: "web", currentPhaseId: "p1", currentTaskId: "t1", currentLoopId: null, loops: {}, phases: {}, tasks: {}, ...extra });
    return dir;
  }
  const cap = (jsonBody: any = { ok: true }) => { const c: any = { calls: [] }; c.fetchImpl = async (url: string, init: any) => { c.calls.push({ url, init }); c.url = url; c.init = init; return { ok: true, status: 200, json: async () => jsonBody }; }; return c; };
  const base = (dir: string, c: any, logsOut: string[] = []) => ({ cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: (m: string) => logsOut.push(m), err: () => {}, fetchImpl: c.fetchImpl });

  it("idea add PUTs with defaults status=proposed order=100", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["idea", "add", "idea-dark-mode", "--title", "Dark mode", "--rationale", "users asked", "--origin-loop", "loop-1"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas/idea-dark-mode");
    expect(c.init.method).toBe("PUT");
    expect(JSON.parse(c.init.body)).toMatchObject({ title: "Dark mode", status: "proposed", order: 100, rationale: "users asked", originLoopId: "loop-1" });
  });

  it("idea add is project-level even when currentLoopId is set (no loopSeg)", async () => {
    const dir = initDir({ currentLoopId: "l1" }); const c = cap();
    await run(["idea", "add", "i1", "--title", "X"], base(dir, c));
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas/i1");
  });

  it("idea add reads --rationale-file (wins over --rationale) and validates --status", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "why.md"), "# from file");
    await run(["idea", "add", "i1", "--title", "X", "--rationale", "inline", "--rationale-file", "why.md", "--status", "accepted"], base(dir, c));
    const body = JSON.parse(c.init.body);
    expect(body.rationale).toBe("# from file");
    expect(body.status).toBe("accepted");
    const code = await run(["idea", "add", "i2", "--title", "X", "--status", "maybe"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });

  it("idea add requires --title", async () => {
    const dir = initDir();
    const code = await run(["idea", "add", "i1"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });

  it("idea set PUTs a partial update (done + built-in-loop)", async () => {
    const dir = initDir(); const c = cap();
    expect(await run(["idea", "set", "i1", "--status", "done", "--built-in-loop", "loop-2"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas/i1");
    expect(JSON.parse(c.init.body)).toEqual({ status: "done", builtInLoopId: "loop-2" });
  });

  it("idea set requires at least one field", async () => {
    const dir = initDir();
    const code = await run(["idea", "set", "i1"], { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).toBe(1);
  });

  it("idea list GETs project-level /ideas and prints one line per idea", async () => {
    const dir = initDir({ currentLoopId: "l1" });
    const c = cap({ ok: true, ideas: [
      { id: "a1", status: "accepted", order: 50, title: "A" },
      { id: "p1", status: "proposed", order: 100, title: "P" },
    ] });
    const logs: string[] = [];
    expect(await run(["idea", "list"], base(dir, c, logs))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/ideas");
    expect(c.init.method).toBe("GET");
    expect(logs.join("\n")).toContain("[accepted] 50 a1 — A");
    expect(logs.join("\n")).toContain("[proposed] 100 p1 — P");
  });
});
```

> `writeFileSync` and `join` are already imported at the top of `cli.unit.test.ts` (the `vision import` and `test-run --summary-file` tests use them).

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (no `idea *` cases — dispatch throws "unknown command", URL/body assertions fail). The existing `messages pull` tests must still PASS.

- [ ] **Step 3: Implement**

(a) Generalize `fetchJson` in `cli/autoloop.mjs` — replace its deps destructure and the three failure/print sites (defaults keep `messages pull` behavior identical):

```js
/**
 * Fetch JSON from a GET endpoint and print the result to stdout via log.
 * Best-effort: never throws; on failure prints a warning to err and returns 0.
 * deps: { env, fetchImpl, log, err, label?, render? } — label names the verb in
 * warnings (default "messages pull"); render(body) formats the output (default:
 * JSON of body.messages ?? body).
 */
export async function fetchJson(req, deps) {
  const {
    env = process.env, fetchImpl = fetch, log = (m) => console.log(m), err = (m) => console.error(m),
    label = "messages pull",
    render = (body) => JSON.stringify(body.messages ?? body, null, 2),
  } = deps;
  const key = env.AUTOLOOP_API_KEY;
  if (!key) throw new UsageError("set AUTOLOOP_API_KEY (a key minted via POST /v1/keys)");

  let res;
  try {
    res = await fetchImpl(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    err(`autoloop: ${label} failed (network): ${e.message}`);
    return 0;
  }

  if (res.ok) {
    try {
      const body = await res.json();
      log(render(body));
    } catch (e) {
      err(`autoloop: ${label} failed (parse): ${e.message}`);
    }
    return 0;
  }

  err(`autoloop: ${label} failed (${res.status})`);
  return 0;
}
```

(b) Add the three cases after `case "bug set"` ends (~line 477), before `case "commit"`. Note: NO `loopSeg(cfg)` anywhere — ideas are project-level.

```js
      case "idea add": {
        const id = positionals[2]; validateId("ideaId", id);
        if (!flags.title) throw new UsageError("idea add requires --title <t>");
        const status = flags.status || "proposed";
        if (!["proposed", "accepted", "rejected", "done"].includes(status)) throw new UsageError(`--status must be proposed|accepted|rejected|done, got '${status}'`);
        const order = typeof flags.order === "string" ? Number(flags.order) : 100;
        if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
        const body = { title: flags.title, status, order };
        if (flags["rationale-file"]) {
          try { body.rationale = readFileSync(join(cwd, flags["rationale-file"]), "utf8"); }
          catch (e) { throw new UsageError(`could not read --rationale-file '${flags["rationale-file"]}': ${e.message}`); }
        } else if (flags.rationale) {
          body.rationale = flags.rationale;
        }
        if (flags["origin-loop"]) { validateId("origin-loop", flags["origin-loop"]); body.originLoopId = flags["origin-loop"]; }
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/ideas/${id}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "idea set": {
        const id = positionals[2]; validateId("ideaId", id);
        const body = {};
        if (flags.status) {
          if (!["proposed", "accepted", "rejected", "done"].includes(flags.status)) throw new UsageError(`--status must be proposed|accepted|rejected|done, got '${flags.status}'`);
          body.status = flags.status;
        }
        if (flags.title) body.title = flags.title;
        if (typeof flags.order === "string") {
          const order = Number(flags.order);
          if (!Number.isInteger(order)) throw new UsageError(`--order must be an integer, got '${flags.order}'`);
          body.order = order;
        }
        if (flags.rationale) body.rationale = flags.rationale;
        if (flags["origin-loop"]) { validateId("origin-loop", flags["origin-loop"]); body.originLoopId = flags["origin-loop"]; }
        if (flags["built-in-loop"]) { validateId("built-in-loop", flags["built-in-loop"]); body.builtInLoopId = flags["built-in-loop"]; }
        if (Object.keys(body).length === 0) throw new UsageError("idea set requires at least one of --status/--title/--order/--rationale/--origin-loop/--built-in-loop");
        const cfg = loadConfig(cwd);
        const url = `${resolveApiUrl(cfg, env, flags.url)}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/ideas/${id}`;
        return report({ method: "PUT", url, body },
          { env, fetchImpl, err, strict: !!flags.strict || env.AUTOLOOP_STRICT === "1", teamId: cfg.teamId });
      }
      case "idea list": {
        const cfg = loadConfig(cwd);
        const api = resolveApiUrl(cfg, env, flags.url);
        const url = `${api}/v1/teams/${cfg.teamId}/projects/${cfg.projectSlug}/ideas`;
        return fetchJson({ method: "GET", url }, {
          env, fetchImpl, log, err, label: "idea list",
          render: (b) => (b.ideas ?? []).map((i) => `[${i.status}] ${i.order} ${i.id} — ${i.title}`).join("\n") || "(no ideas)",
        });
      }
```

(There is no `--help` usage block listing verbs in `cli/autoloop.mjs` — nothing to update there.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS — including the pre-existing `messages pull/ack/send` block (guards the `fetchJson` default-behavior refactor).

- [ ] **Step 5: Commit**

```bash
git add cli/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): idea add/set/list verbs (project-level, proposed/100 defaults, formatted list)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Web pure layer — `Idea` type + `ideasView.ts`

Pure, listener-free logic shared by the tab and tests: band-sort, the ↑/↓ reorder plan (with tie-renumbering 10/20/30), and the add-form id derivation (slugify + random suffix on collision).

**Files:**
- Modify: `web/src/dashboard/types.ts` (add `Idea` after `Bug`, ~line 33)
- Create: `web/src/dashboard/ideasView.ts`
- Test: `web/src/dashboard/ideasView.test.ts`

- [ ] **Step 1: Add the `Idea` type**

In `web/src/dashboard/types.ts`, after the `Bug` interface:

```ts
export interface Idea {
  id: string; title?: string; rationale?: string;
  status?: "proposed" | "accepted" | "rejected" | "done"; order?: number;
  by?: "agent" | "user"; originLoopId?: string; builtInLoopId?: string;
  createdAt?: unknown; updatedAt?: unknown; decidedAt?: unknown;
}
```

- [ ] **Step 2: Write the failing tests**

`web/src/dashboard/ideasView.test.ts` (model on `loopView.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { sortIdeas, moveIdea, ideaIdFor } from "./ideasView";
import type { Idea } from "./types";

const ts = (n: number) => ({ toMillis: () => n });

describe("sortIdeas", () => {
  it("sorts by band (accepted, proposed, rejected, done), then order, then createdAt", () => {
    const ideas: Idea[] = [
      { id: "d", status: "done", order: 1 },
      { id: "p-late", status: "proposed", order: 100, createdAt: ts(2) },
      { id: "r", status: "rejected", order: 1 },
      { id: "p-early", status: "proposed", order: 100, createdAt: ts(1) }, // tie → createdAt
      { id: "p-first", status: "proposed", order: 10 },
      { id: "a", status: "accepted", order: 99 },
    ];
    expect(sortIdeas(ideas).map((i) => i.id)).toEqual(["a", "p-first", "p-early", "p-late", "r", "d"]);
  });
  it("does not mutate its input", () => {
    const ideas: Idea[] = [{ id: "b", status: "done", order: 1 }, { id: "a", status: "accepted", order: 1 }];
    sortIdeas(ideas);
    expect(ideas[0].id).toBe("b");
  });
});

describe("moveIdea", () => {
  it("swaps order with the neighbor above within the same band", () => {
    const ideas: Idea[] = [
      { id: "p1", status: "proposed", order: 10 },
      { id: "p2", status: "proposed", order: 20 },
    ];
    expect(moveIdea(ideas, "p2", "up")).toEqual([{ id: "p1", order: 20 }, { id: "p2", order: 10 }]);
  });
  it("renumbers the whole band 10/20/30 when neighbors share an order (CLI defaults of 100), so reorder is never a no-op", () => {
    const ideas: Idea[] = [
      { id: "p1", status: "proposed", order: 100, createdAt: ts(1) },
      { id: "p2", status: "proposed", order: 100, createdAt: ts(2) },
      { id: "p3", status: "proposed", order: 100, createdAt: ts(3) },
    ];
    const writes = moveIdea(ideas, "p3", "up");
    const byId = Object.fromEntries(writes.map((w) => [w.id, w.order]));
    expect(byId.p3).toBe(20); // moved up into slot 2
    expect(byId.p2).toBe(30); // displaced down
    expect(byId.p1 ?? 10).toBe(10); // renumbered (or already there)
    // applying the writes must change the sorted sequence
    const after = ideas.map((i) => ({ ...i, order: byId[i.id] ?? i.order }));
    expect(sortIdeas(after).map((i) => i.id)).toEqual(["p1", "p3", "p2"]);
  });
  it("never crosses bands and is a no-op at the band edge", () => {
    const ideas: Idea[] = [
      { id: "a1", status: "accepted", order: 10 },
      { id: "p1", status: "proposed", order: 10 },
    ];
    expect(moveIdea(ideas, "p1", "up")).toEqual([]);   // top of its band — accepted above is out of reach
    expect(moveIdea(ideas, "a1", "down")).toEqual([]); // bottom of its band
    expect(moveIdea(ideas, "ghost", "up")).toEqual([]);
  });
});

describe("ideaIdFor", () => {
  it("slugifies the title", () => {
    expect(ideaIdFor("Add Dark Mode!", new Set())).toBe("add-dark-mode");
  });
  it("appends a short random suffix on collision", () => {
    expect(ideaIdFor("Dark mode", new Set(["dark-mode"]), () => "ab12")).toBe("dark-mode-ab12");
  });
  it("falls back to 'idea' for an unslugifiable title", () => {
    expect(ideaIdFor("!!!", new Set())).toBe("idea");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npm test -- ideasView`
Expected: FAIL (`./ideasView` does not exist).

- [ ] **Step 4: Implement**

`web/src/dashboard/ideasView.ts`:

```ts
import type { Idea } from "./types";

/** Band ranks: the user's queue first, then the loop's proposals, then the vetoed, then the shipped. */
const BAND: Record<string, number> = { accepted: 0, proposed: 1, rejected: 2, done: 3 };

const millis = (v: unknown): number => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return t?.toMillis ? t.toMillis() : Number.MAX_SAFE_INTEGER;
};

/** Band-sort: accepted → proposed → rejected → done, then order, then createdAt. Pure; does not mutate. */
export function sortIdeas(ideas: Idea[]): Idea[] {
  return [...ideas].sort((a, b) =>
    ((BAND[a.status ?? "proposed"] ?? 9) - (BAND[b.status ?? "proposed"] ?? 9))
    || ((a.order ?? 0) - (b.order ?? 0))
    || (millis(a.createdAt) - millis(b.createdAt)));
}

/**
 * The PUT writes needed to move `id` one step up/down WITHIN its status band.
 * When the band has duplicate orders (e.g. several CLI defaults of 100), the whole
 * band is renumbered 10, 20, 30, … before the swap, so reorder is never a silent no-op.
 * Returns [] at a band edge or for an unknown id. Emits only changed orders.
 */
export function moveIdea(ideas: Idea[], id: string, dir: "up" | "down"): { id: string; order: number }[] {
  const me = ideas.find((i) => i.id === id);
  if (!me) return [];
  const band = sortIdeas(ideas).filter((i) => (i.status ?? "proposed") === (me.status ?? "proposed"));
  const idx = band.findIndex((i) => i.id === id);
  const j = dir === "up" ? idx - 1 : idx + 1;
  if (j < 0 || j >= band.length) return [];
  const orders = band.map((i) => i.order ?? 0);
  const hasTies = new Set(orders).size !== orders.length;
  const next = band.map((i, k) => ({ id: i.id, order: hasTies ? (k + 1) * 10 : (i.order ?? 0) }));
  [next[idx].order, next[j].order] = [next[j].order, next[idx].order];
  return next.filter((w, k) => w.order !== (band[k].order ?? 0));
}

/** Derive an ideaId from a title: slugify, then append a short random suffix on collision. */
export function ideaIdFor(
  title: string,
  taken: Set<string>,
  rand: () => string = () => Math.random().toString(36).slice(2, 6),
): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "idea";
  return taken.has(slug) ? `${slug}-${rand()}` : slug;
}
```

(The slugify expression matches the existing web slugify in `VisionEditableSection.tsx`; the suffix derivation matches `web/src/teams/teamId.ts` `randomSuffix`.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npm test -- ideasView`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/ideasView.ts web/src/dashboard/ideasView.test.ts
git commit -m "feat(web): Idea type + pure ideasView (band sort, tie-renumbering reorder, ideaId derivation)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Web — `useIdeas` hook, `putUserIdea`, `IdeaItem` + `IdeasTab`

**Files:**
- Modify: `web/src/dashboard/hooks.ts` (add `useIdeas` after `useMessages`, ~line 348; extend the types import with `Idea`)
- Modify: `web/src/dashboard/api.ts` (add `putUserIdea` after `putDocument`)
- Create: `web/src/dashboard/components/IdeaItem.tsx`
- Create: `web/src/dashboard/tabs/IdeasTab.tsx`
- Test: `web/src/dashboard/components/ideas.test.tsx`

- [ ] **Step 1: Write the failing component tests**

`web/src/dashboard/components/ideas.test.tsx` (model on `bugs.test.tsx` + the `messages.test.tsx` interaction style):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IdeasTab } from "../tabs/IdeasTab";
import type { Idea } from "../types";

const ideas: Idea[] = [
  { id: "p1", title: "Proposed one", status: "proposed", order: 100, by: "agent", rationale: "because", originLoopId: "loop-1" },
  { id: "a1", title: "Accepted one", status: "accepted", order: 50, by: "user" },
  { id: "r1", title: "Rejected one", status: "rejected", order: 1, by: "user" },
  { id: "d1", title: "Done one", status: "done", order: 1, by: "agent", builtInLoopId: "loop-2" },
];

describe("IdeasTab", () => {
  it("renders rows band-sorted (accepted, proposed, rejected, done) with status chips", () => {
    const { container } = render(<IdeasTab ideas={ideas} onPut={vi.fn()} />);
    const titles = Array.from(container.querySelectorAll(".idearow-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Accepted one", "Proposed one", "Rejected one", "Done one"]);
    for (const s of ["proposed", "accepted", "rejected", "done"]) {
      expect(container.querySelector(`.ideastatus--${s}`)).not.toBeNull();
    }
  });

  it("shows rationale (collapsible) and loop references", () => {
    const { container } = render(<IdeasTab ideas={ideas} onPut={vi.fn()} />);
    expect(container.textContent).toContain("because");
    expect(container.textContent).toContain("loop-1");
    expect(container.textContent).toContain("loop-2");
  });

  it("Accept / Reject call onPut with the status body; rejected/done rows have no buttons", () => {
    const onPut = vi.fn().mockResolvedValue(undefined);
    render(<IdeasTab ideas={ideas} onPut={onPut} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^accept$/i })[0]); // accepted+proposed rows have buttons
    expect(onPut).toHaveBeenCalledWith(expect.any(String), { status: "accepted" });
    fireEvent.click(screen.getAllByRole("button", { name: /^reject$/i })[0]);
    expect(onPut).toHaveBeenCalledWith(expect.any(String), { status: "rejected" });
    expect(screen.getAllByRole("button", { name: /^accept$/i }).length).toBe(2); // only proposed + accepted rows
  });

  it("↑/↓ reorder PUTs new orders, renumbering ties so the move is never a no-op", async () => {
    const onPut = vi.fn().mockResolvedValue(undefined);
    const tied: Idea[] = [
      { id: "p1", title: "P1", status: "proposed", order: 100, createdAt: { toMillis: () => 1 } },
      { id: "p2", title: "P2", status: "proposed", order: 100, createdAt: { toMillis: () => 2 } },
    ];
    render(<IdeasTab ideas={tied} onPut={onPut} />);
    fireEvent.click(screen.getAllByRole("button", { name: "↑" })[1]); // move p2 up
    await waitFor(() => expect(onPut).toHaveBeenCalled());
    const orders = Object.fromEntries(onPut.mock.calls.map(([id, body]: [string, { order: number }]) => [id, body.order]));
    expect(orders.p2).toBeLessThan(orders.p1 ?? Infinity); // p2 now sorts first
  });

  it("add-idea form posts a proposed idea with a slugified id", async () => {
    const onPut = vi.fn().mockResolvedValue(undefined);
    render(<IdeasTab ideas={[]} onPut={onPut} />);
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "Add Dark Mode" } });
    fireEvent.change(screen.getByPlaceholderText(/rationale/i), { target: { value: "users asked" } });
    fireEvent.click(screen.getByRole("button", { name: /add idea/i }));
    await waitFor(() => expect(onPut).toHaveBeenCalledWith("add-dark-mode",
      { title: "Add Dark Mode", rationale: "users asked", status: "proposed", order: 100 }));
  });

  it("shows an empty state when there are no ideas", () => {
    render(<IdeasTab ideas={[]} onPut={vi.fn()} />);
    expect(screen.getByText(/no ideas/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- ideas`
Expected: FAIL (`../tabs/IdeasTab` does not exist; `ideasView` tests still PASS).

- [ ] **Step 3: Implement**

(a) `web/src/dashboard/api.ts` — add after `putDocument`/`deleteDocument`:

```ts
export async function putUserIdea(teamId: string, slug: string, id: string, body: object): Promise<void> {
  await ok(await fetch(u(teamId, slug, `/ideas/${id}`), { method: "PUT", headers: await headers(), body: JSON.stringify(body) }));
}
```

(b) `web/src/dashboard/hooks.ts` — add `Idea` to the types import and add after `useMessages` (project-level listener, like `useMessages`; sorting stays in `ideasView`):

```ts
export function useIdeas(teamId: string, slug: string): Result<Idea[]> {
  const [data, setData] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "ideas"), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Idea[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}
```

(c) `web/src/dashboard/components/IdeaItem.tsx`:

```tsx
import { Markdown } from "./Markdown";
import type { Idea } from "../types";

export function IdeaItem({ idea, canMoveUp, canMoveDown, onPut, onMove }: {
  idea: Idea;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPut: (id: string, body: object) => Promise<void>;
  onMove: (id: string, dir: "up" | "down") => void;
}) {
  const status = idea.status ?? "proposed";
  const actionable = status === "proposed" || status === "accepted";
  return (
    <div className={`idearow card idea--${status}`}>
      <div className="idearow-head">
        <span className={`ideastatus ideastatus--${status}`}>{status}</span>
        <span className="idearow-title">{idea.title ?? idea.id}</span>
        {idea.by && <span className="idearow-by dim">{idea.by}</span>}
        {actionable && (
          <span className="idearow-actions">
            <button type="button" className="btn btn--small" onClick={() => void onPut(idea.id, { status: "accepted" })}>Accept</button>
            <button type="button" className="btn btn--small" onClick={() => void onPut(idea.id, { status: "rejected" })}>Reject</button>
            <button type="button" className="btn btn--small" disabled={!canMoveUp} onClick={() => onMove(idea.id, "up")}>↑</button>
            <button type="button" className="btn btn--small" disabled={!canMoveDown} onClick={() => onMove(idea.id, "down")}>↓</button>
          </span>
        )}
      </div>
      {idea.rationale && (
        <details className="idearow-rationale">
          <summary className="dim">rationale</summary>
          <Markdown>{idea.rationale}</Markdown>
        </details>
      )}
      {(idea.originLoopId || idea.builtInLoopId) && (
        <div className="idearow-refs dim">
          {idea.originLoopId && <span>from {idea.originLoopId}</span>}
          {idea.builtInLoopId && <span>built in {idea.builtInLoopId}</span>}
        </div>
      )}
    </div>
  );
}
```

(d) `web/src/dashboard/tabs/IdeasTab.tsx`:

```tsx
import { useState } from "react";
import { IdeaItem } from "../components/IdeaItem";
import { ErrorNote } from "../components/ErrorNote";
import { sortIdeas, moveIdea, ideaIdFor } from "../ideasView";
import type { Idea } from "../types";

export function IdeasTab({ ideas, onPut }: {
  ideas: Idea[];
  onPut: (id: string, body: object) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = sortIdeas(ideas);

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Idea update failed"); }
    finally { setBusy(false); }
  }

  function handleMove(id: string, dir: "up" | "down") {
    const writes = moveIdea(ideas, id, dir);
    if (writes.length === 0) return;
    void guard(async () => { for (const w of writes) await onPut(w.id, { order: w.order }); });
  }

  async function handleAdd() {
    if (!title.trim()) return;
    const id = ideaIdFor(title.trim(), new Set(ideas.map((i) => i.id)));
    const body: Record<string, unknown> = { title: title.trim(), status: "proposed", order: 100 };
    if (rationale.trim()) body.rationale = rationale.trim();
    await guard(async () => { await onPut(id, body); setTitle(""); setRationale(""); });
  }

  const bandIndex = (id: string) => {
    const me = sorted.find((i) => i.id === id);
    const band = sorted.filter((i) => (i.status ?? "proposed") === (me?.status ?? "proposed"));
    return { idx: band.findIndex((i) => i.id === id), len: band.length };
  };

  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Ideas</h2></div>
      {error && <ErrorNote message={error} />}
      {sorted.length === 0 ? <div className="empty">No ideas yet.</div> : (
        <div className="idealist">
          {sorted.map((i) => {
            const { idx, len } = bandIndex(i.id);
            return <IdeaItem key={i.id} idea={i} canMoveUp={idx > 0} canMoveDown={idx < len - 1}
              onPut={onPut} onMove={handleMove} />;
          })}
        </div>
      )}
      <div className="ideacompose">
        <input className="ideacompose-title" placeholder="Idea title…" value={title}
          onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <textarea className="ideacompose-rationale" placeholder="Rationale (optional)…" rows={2}
          value={rationale} onChange={(e) => setRationale(e.target.value)} disabled={busy} />
        <button type="button" className="btn btn--primary" onClick={() => void handleAdd()}
          disabled={busy || !title.trim()}>Add idea</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- ideas`
Expected: PASS (component + ideasView tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/hooks.ts web/src/dashboard/api.ts web/src/dashboard/components/IdeaItem.tsx web/src/dashboard/tabs/IdeasTab.tsx web/src/dashboard/components/ideas.test.tsx
git commit -m "feat(web): Ideas tab — useIdeas hook, putUserIdea, accept/reject/reorder + add-idea form

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Tab registration in `Tabs` + `ProjectDetail`

Ideas is project-level data, like Messages — no LoopSelector involvement, not loop-scoped.

**Files:**
- Modify: `web/src/dashboard/components/Tabs.tsx` (TabKey union + TABS entry after `bugs`)
- Modify: `web/src/dashboard/ProjectDetail.tsx` (hook + render + tabLoading + dataError)
- Test: `web/src/dashboard/components/shell.test.tsx` (extend the Tabs test, ~line 11)

- [ ] **Step 1: Extend the failing Tabs test**

In `web/src/dashboard/components/shell.test.tsx`, in the `Tabs` describe, add `"Ideas"` to the asserted tab list:

```ts
    for (const t of ["Dashboard", "Vision", "Loops", "Bugs", "Ideas", "Messages"]) expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
```

Run: `cd web && npm test -- shell`
Expected: FAIL (no Ideas tab).

- [ ] **Step 2: Register the tab**

`web/src/dashboard/components/Tabs.tsx`:

```ts
export type TabKey = "dashboard" | "vision" | "loops" | "tests" | "bugs" | "ideas" | "messages";
```

and in `TABS`, after the `bugs` entry:

```ts
  { key: "ideas", label: "Ideas" },
```

- [ ] **Step 3: Wire `ProjectDetail`**

In `web/src/dashboard/ProjectDetail.tsx`:
- extend the hooks import with `useIdeas`, the api import with `putUserIdea`, and the tabs imports with `IdeasTab` (`import { IdeasTab } from "./tabs/IdeasTab";`)
- add beside the other project-level hooks (~line 67): `const ideas = useIdeas(teamId, slug);`
- add `|| ideas.error` to the `dataError` chain (~line 76)
- add a `tabLoading` arm (~line 84): `: tab === "ideas" ? (ideas.loading && ideas.data.length === 0)`
- render after the bugs tab (~line 116):

```tsx
                {tab === "ideas" && <IdeasTab ideas={ideas.data} onPut={(id, body) => putUserIdea(teamId, slug, id, body)} />}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test`
Expected: PASS — the full web suite (shell, ideas, ideasView, and all pre-existing tests; `tsc` issues would surface in Task 11's build).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/components/Tabs.tsx web/src/dashboard/ProjectDetail.tsx web/src/dashboard/components/shell.test.tsx
git commit -m "feat(web): register Ideas tab in Tabs + ProjectDetail (project-level, like Messages)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Driver skill — Step 3b ideas protocol + plugin bump

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md` (the "Generate 5 new improvement ideas" paragraph in Step 3b, ~lines 206-210)
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` (version `0.10.1` → `0.11.0`)
- Modify (generated): `web/public/skill/autoloop/SKILL.md` (via the sync script)

- [ ] **Step 1: Replace the prose-only ideas instruction**

In `plugins/autoloop/skills/autoloop/SKILL.md` Step 3b, replace the paragraph (~lines 206-210):

> Otherwise, **immediately start the next loop.** Autoloop is a loop — running is the default, stopping is the exception. Generate 5 new improvement ideas based on what's already been built, open `loop start loop-YYYY-MM-DD-<n>` with the next order number, plan its tasks, and go back to Step 2. Do NOT ask the user whether to continue. Do NOT suggest the next round as an option. Just run it.

with:

````markdown
Otherwise, **immediately start the next loop.** Autoloop is a loop — running is
the default, stopping is the exception.

**Ideas backlog (durable between loops — the user steers it from the dashboard):**

1. **Propose (at loop close):** run `autoloop idea list` first, then generate **at
   least 5** improvement ideas from what this loop built and learned. Skip any idea
   that semantically duplicates an existing non-rejected idea in the list. Record
   each new one (defaults: `--status proposed --order 100`):
   ```bash
   autoloop idea add <idea-slug> --title "<imperative summary>" \
     --rationale "<the learning that produced it>" --origin-loop <loopId>
   ```
2. **Pick (at the next loop start):** run `autoloop idea list`; build the FIRST
   `accepted` idea, else the FIRST `proposed` idea (the list is already ordered:
   accepted → proposed, by the user's priority). **Never build a `rejected` idea.**
   The chosen idea's title + rationale seed the new loop's `--goal` and plan.
3. **Mark done (when the idea ships):** when the loop that built it closes with its
   scenarios met:
   ```bash
   autoloop idea set <idea-slug> --status done --built-in-loop <loopId>
   ```

Open `loop start loop-YYYY-MM-DD-<n>` with the next order number, plan its tasks,
and go back to Step 2. Do NOT ask the user whether to continue. Do NOT suggest the
next round as an option. Just run it.
````

- [ ] **Step 2: Bump the plugin version**

In `plugins/autoloop/.claude-plugin/plugin.json`: `"version": "0.10.1"` → `"version": "0.11.0"`.

- [ ] **Step 3: Sync the skill copy**

Run: `bash scripts/sync-autoloop-cli.sh`
Then: `diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && echo IDENTICAL`
Expected: `IDENTICAL`.

- [ ] **Step 4: Commit**

```bash
git add plugins/autoloop/skills/autoloop/SKILL.md plugins/autoloop/.claude-plugin/plugin.json web/public/skill/autoloop/SKILL.md web/public/skill/autoloop.mjs plugins/autoloop/bin/autoloop
git commit -m "feat(skill): durable ideas backlog — propose at close, pick accepted-first, never rejected (0.11.0)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(The sync script also refreshes the two CLI copies with Task 6's verbs — include them here so every commit leaves the copies identical.)

---

### Task 11: Full gates

**Files:** none new — verification only (plus any CLI copy drift the sync fixes).

- [ ] **Step 1: Re-sync and verify the three CLI copies are identical**

Run: `bash scripts/sync-autoloop-cli.sh`
Then: `diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && diff cli/autoloop.mjs web/public/skill/autoloop.mjs && echo IDENTICAL`
Expected: `IDENTICAL` (no diff output). If the sync changed anything, commit it:

```bash
git add plugins/autoloop/bin/autoloop web/public/skill/autoloop.mjs
git commit -m "chore(cli): sync autoloop CLI copies (idea verbs)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Functions build + full suite**

Run: `cd functions && npm run build && npm test`
Expected: build clean; ALL suites green — including the pre-existing `messages` and `cli.unit` suites (guards the `fetchJson` generalization) and `userProjects` (guards the new user route).

- [ ] **Step 3: Rules suite**

Run: `cd functions && npm run test:rules`
Expected: PASS (ideas path covered, no rules change).

- [ ] **Step 4: Web build + full suite**

Run: `cd web && npm run build && npm test`
Expected: `tsc -b` clean (catches any type drift from the new tab/hook), Vite build clean (note: `prebuild` re-copies the CLI — `git status` must stay clean afterward), all web tests green.

- [ ] **Step 5: Working tree clean**

Run: `git status --porcelain`
Expected: empty (everything committed, generated copies in sync).

---

## Definition of done

- `idea` entity: `PUT …/projects/:slug/ideas/:ideaId` (agent) idempotent, required-on-create trio (title+status+order), `decidedAt` stamped once on first accept/reject (including create-as-accepted/rejected) and stable across re-PUTs, `by` stamped from the auth path and never from the body.
- `GET …/projects/:slug/ideas` returns all ideas band-sorted (accepted → proposed → rejected → done, then order, then createdAt) with serialized timestamps.
- `PUT /v1/u/…/ideas/:ideaId`: member 200 with `by:"user"` on create, non-member 403, and works while `visionOwner === "loop"` (no `assertWebEditable`).
- Rules unchanged; the ideas subtree is member-readable and client-write-denied (tested).
- `autoloop idea add` (defaults `proposed`/100, `--origin-loop`, `--rationale[-file]`), `idea set` (partial, `--built-in-loop`), `idea list` (one formatted line per idea) — all project-level; the three CLI copies identical.
- Web: Ideas tab after Bugs — band-sorted rows with status chips, collapsible markdown rationale, loop refs; Accept/Reject/↑↓ on proposed+accepted rows via `putUserIdea` with tie-renumbering (10/20/30) so reorder never no-ops; add-idea form posting `proposed` with a slugified id + random suffix on collision; empty state for idea-less projects.
- Driver skill Step 3b: propose ≥5 deduped ideas at loop close (`--origin-loop`), pick accepted-first-then-proposed at loop start, never build rejected, mark `done --built-in-loop` when shipped; plugin bumped to 0.11.0; skill copy synced.
- `functions` build + full suite + rules suite green; web build + suite green; zero regression.

## Out of scope (separate sub-projects in this batch / future)

- Vision growth diffs (`visionChanges`) — its own spec; an accepted idea often *leads* to a vision change, but the entities are independent.
- Notifications on idea proposal (could ride the existing notifier later).
- Cross-project idea sharing; idea comments/threads (the Messages tab covers dialogue).
- Independent verification, preview + trends, product map, resumable loops (plans 1, 3-6 of this batch).
