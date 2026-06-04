# Autoloop — Admin Allowlist (UI-E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Admins view all users and grant/revoke `users/{uid}.isAllowed` — via a new ID-token + `isAdmin`-gated admin API (Admin SDK, no rules change) and an `/admin` page.

**Architecture:** Backend: `requireAdmin` (verify token + `isAllowed && isAdmin`) + `adminRouter` (`GET /v1/admin/users`, `PUT /v1/admin/users/{uid}` merge-set `isAllowed`+optional `email`). Frontend: `AuthProvider` exposes optional `isAdmin`; AppShell shows an Admin link when admin; `/admin` page (admin client + props-only components incl. a grant-by-UID input for un-provisioned users).

**Tech Stack:** Backend = Cloud Functions (TS, Express, Zod, Admin SDK), Vitest + Firestore emulator. Frontend = Vite+React+TS, Vitest+jsdom+RTL.

**Reference spec:** `docs/superpowers/specs/2026-06-02-admin-allowlist-design.md`.

---

## Conventions

- Backend tasks run in `functions/` (`npm test` self-launches emulator; `npm run test:run -- <filter>` with a background emulator for the inner loop). Frontend tasks run in `web/`.
- Backend: `requireAdmin` is glue tested via injected stub verifier + emulator; `adminRouter` via Supertest+emulator. Frontend: presentational components unit-tested; `admin/client.ts` + `AdminPage` glue (build-only); App.test firebase-free via a hoisted `vi.mock("./admin/client", …)`.

---

## Task 1: `requireAdmin` middleware (backend)

**Files:** Create `functions/src/requireAdmin.ts`; Test `functions/test/requireAdmin.test.ts`

> Emulator: background `npm run emulators` on 8080, then `npm run test:run -- requireAdmin`.

- [ ] **Step 1: Failing test `functions/test/requireAdmin.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { makeRequireAdmin } from "../src/requireAdmin.js";
import { errorHandler } from "../src/errors.js";

const stub = async (t: string) => { const m = t.match(/^good-(.+)$/); if (!m) throw new Error("bad"); return { uid: m[1] }; };
function app() {
  const a = express(); a.use(express.json());
  a.use("/admin", makeRequireAdmin(stub), (req, res) => res.json({ uid: req.uid }));
  a.use(errorHandler); return a;
}
async function setUser(uid: string, isAllowed: boolean, isAdmin: boolean) {
  await db().doc(`users/${uid}`).set({ email: `${uid}@x.com`, isAllowed, isAdmin });
}

describe("requireAdmin", () => {
  it("401 no token / bad token", async () => {
    expect((await request(app()).get("/admin")).status).toBe(401);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer nope")).status).toBe(401);
  });
  it("403 when not allowed or not admin", async () => {
    await setUser("u1", true, false);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer good-u1")).status).toBe(403);
    await setUser("u2", false, true);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer good-u2")).status).toBe(403);
    expect((await request(app()).get("/admin").set("Authorization", "Bearer good-ghost")).status).toBe(403);
  });
  it("200 + req.uid for an allowed admin", async () => {
    await setUser("boss", true, true);
    const res = await request(app()).get("/admin").set("Authorization", "Bearer good-boss");
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe("boss");
  });
});
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement `functions/src/requireAdmin.ts`**

```typescript
import type { RequestHandler } from "express";
import { getAuth } from "firebase-admin/auth";
import { db } from "./firestore.js";
import { AppError } from "./errors.js";

export type TokenVerifier = (idToken: string) => Promise<{ uid: string }>;
const defaultVerifier: TokenVerifier = (idToken) => getAuth().verifyIdToken(idToken);

/** Verify ID token, require users/{uid}.isAllowed && isAdmin, set req.uid. */
export function makeRequireAdmin(verify: TokenVerifier = defaultVerifier): RequestHandler {
  return async (req, _res, next) => {
    try {
      const auth = req.headers["authorization"];
      const token = typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length).trim() : undefined;
      if (!token) throw new AppError(401, "unauthorized", "missing ID token");
      let uid: string;
      try { ({ uid } = await verify(token)); } catch { throw new AppError(401, "unauthorized", "invalid ID token"); }
      const snap = await db().doc(`users/${uid}`).get();
      const d = snap.data();
      if (!snap.exists || d?.isAllowed !== true || d?.isAdmin !== true) {
        throw new AppError(403, "forbidden", "admin access required");
      }
      req.uid = uid;
      next();
    } catch (err) { next(err); }
  };
}
```

- [ ] **Step 4: GREEN.** **Step 5: Commit** — `git add functions/src/requireAdmin.ts functions/test/requireAdmin.test.ts && git commit -m "feat(api): requireAdmin middleware (isAllowed + isAdmin)"`

---

## Task 2: admin routes + mount (backend)

**Files:** Create `functions/src/routes/admin.ts`; Modify `functions/src/app.ts`; Test `functions/test/admin.test.ts`

> Emulator: `npm run test:run -- admin` (background emulator) / `npm test`.

- [ ] **Step 1: Failing test `functions/test/admin.test.ts`** — mounts `adminRouter` behind a stub-uid middleware (tests the router; `requireAdmin` is tested separately).

```typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import "./helpers.js";
import { db } from "../src/firestore.js";
import { adminRouter } from "../src/routes/admin.js";
import { errorHandler } from "../src/errors.js";

function app() {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { req.uid = "boss"; next(); });
  a.use("/v1/admin", adminRouter);
  a.use(errorHandler); return a;
}

describe("admin routes", () => {
  it("GET /users lists users with flags", async () => {
    await db().doc("users/a").set({ email: "a@x.com", isAllowed: true, isAdmin: false });
    await db().doc("users/b").set({ email: "b@x.com", isAllowed: false });
    const res = await request(app()).get("/v1/admin/users");
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.users.map((u: any) => [u.uid, u]));
    expect(byId.a).toMatchObject({ email: "a@x.com", isAllowed: true, isAdmin: false });
    expect(byId.b).toMatchObject({ isAllowed: false, isAdmin: false });
  });
  it("PUT sets isAllowed on an existing user", async () => {
    await db().doc("users/a").set({ email: "a@x.com", isAllowed: false, isAdmin: false });
    expect((await request(app()).put("/v1/admin/users/a").send({ isAllowed: true })).status).toBe(200);
    const d = (await db().doc("users/a").get()).data()!;
    expect(d.isAllowed).toBe(true);
    expect(d.isAdmin).toBe(false); // untouched
  });
  it("PUT creates a doc (with email) for an un-provisioned uid", async () => {
    expect((await request(app()).put("/v1/admin/users/NewUid_123").send({ isAllowed: true, email: "n@x.com" })).status).toBe(200);
    const d = (await db().doc("users/NewUid_123").get()).data()!;
    expect(d).toMatchObject({ isAllowed: true, email: "n@x.com" });
  });
  it("400 on a non-boolean isAllowed", async () => {
    expect((await request(app()).put("/v1/admin/users/a").send({ isAllowed: "yes" })).status).toBe(400);
  });
});
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement `functions/src/routes/admin.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";

const UID = /^[A-Za-z0-9._-]+$/; // Firebase uids are alnum; allow safe punctuation
const putBody = z.object({ isAllowed: z.boolean(), email: z.string().optional() });

export const adminRouter = Router();

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const q = await db().collection("users").get();
    res.status(200).json({
      users: q.docs.map((d) => ({
        uid: d.id, email: d.data().email, isAllowed: d.data().isAllowed === true, isAdmin: d.data().isAdmin === true,
      })),
    });
  } catch (err) { next(err); }
});

adminRouter.put("/users/:uid", async (req, res, next) => {
  try {
    const uid = req.params.uid;
    if (!UID.test(uid)) throw new AppError(400, "validation", "invalid uid");
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const data: Record<string, unknown> = { isAllowed: parsed.data.isAllowed };
    if (parsed.data.email !== undefined) data.email = parsed.data.email;
    await db().doc(`users/${uid}`).set(data, { merge: true }); // never touches isAdmin
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Mount in `functions/src/app.ts`** — add `import { makeRequireAdmin } from "./requireAdmin.js";` and `import { adminRouter } from "./routes/admin.js";`, then `app.use("/v1/admin", makeRequireAdmin(), adminRouter);` (after the keys mount, before the catch-all 404).

- [ ] **Step 5: GREEN** — `npm run test:run -- admin` then full `npm test` green; `npm run build` clean.
- [ ] **Step 6: Commit** — `git add functions/src/routes/admin.ts functions/src/app.ts functions/test/admin.test.ts && git commit -m "feat(api): admin allowlist endpoints (list users, set isAllowed)"`

---

## Task 3: AuthProvider isAdmin + AppShell Admin link (frontend)

**Files:** Modify `web/src/auth/context.tsx`, `web/src/auth/AuthProvider.tsx`, `web/src/routes/AppShell.tsx`; Test `web/src/routes/screens.test.tsx` (extend)

- [ ] **Step 1: Add a failing assertion** to the AppShell test in `web/src/routes/screens.test.tsx`:

```tsx
it("AppShell shows the Admin link only when isAdmin", async () => {
  withAuth({ isAdmin: false }, <AppShell />);
  expect(screen.queryByRole("link", { name: /admin/i })).toBeNull();
  // re-render as admin
  cleanup();
  withAuth({ isAdmin: true }, <AppShell />);
  expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
});
```
(Import `cleanup` from `@testing-library/react` if not present; `withAuth` already spreads `partial` over the AuthValue — `isAdmin` is optional so this compiles.)

- [ ] **Step 2: RED** — `npm test -- screens` → FAIL (no Admin link).
- [ ] **Step 3: Implement**

`context.tsx` — add to `AuthValue`:
```typescript
  isAdmin?: boolean;
```
`AuthProvider.tsx` — add `isAdmin` state and set it in the snapshot handler + reset on auth change:
```tsx
  const [isAdmin, setIsAdmin] = useState(false);
  // in onAuthStateChanged, alongside resets:
  setIsAdmin(false);
  // in the users/{uid} onSnapshot success handler, alongside setIsAllowed:
  setIsAdmin(snap.exists() && snap.data().isAdmin === true);
  // in the value:
  value={{ state, user, isAllowed, isAdmin, signIn, signOut, signInError }}
```
`AppShell.tsx` — show the Admin link conditionally:
```tsx
  const { user, isAdmin, signOut } = useAuth();
  // in <nav>, after the API Keys link:
  {isAdmin && <NavLink to="/admin">Admin</NavLink>}
```

- [ ] **Step 4: GREEN** — `npm test -- screens` → PASS; full `npm test` green (other fixtures unaffected — `isAdmin` is optional).
- [ ] **Step 5: Commit** — `git add web/src/auth/context.tsx web/src/auth/AuthProvider.tsx web/src/routes/AppShell.tsx web/src/routes/screens.test.tsx && git commit -m "feat(web): expose isAdmin + conditional Admin nav link"`

---

## Task 4: Admin presentational components

**Files:** Create `web/src/admin/types.ts`, `web/src/admin/components/{UserRow,UserList,GrantByUidForm}.tsx`; Test `web/src/admin/components/admin.test.tsx`

- [ ] **Step 1: `web/src/admin/types.ts`**

```typescript
export interface AdminUser { uid: string; email?: string; isAllowed: boolean; isAdmin: boolean; }
```

- [ ] **Step 2: Failing test `admin.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserRow } from "./UserRow";
import { UserList } from "./UserList";
import { GrantByUidForm } from "./GrantByUidForm";

describe("UserRow", () => {
  it("shows email or uid; Allow on a disallowed user emits true", async () => {
    const onSet = vi.fn();
    render(<UserRow user={{ uid: "u1", email: "e@x.com", isAllowed: false, isAdmin: false }} onSetAllowed={onSet} />);
    expect(screen.getByText(/e@x.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /allow/i }));
    expect(onSet).toHaveBeenCalledWith("u1", true);
  });
  it("falls back to uid; Revoke on an allowed user emits false", async () => {
    const onSet = vi.fn();
    render(<UserRow user={{ uid: "u2", isAllowed: true, isAdmin: true }} onSetAllowed={onSet} />);
    expect(screen.getByText(/u2/)).toBeInTheDocument();
    expect(screen.getByText(/admin/i)).toBeInTheDocument(); // admin badge
    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));
    expect(onSet).toHaveBeenCalledWith("u2", false);
  });
});

describe("UserList", () => {
  it("empty vs populated", () => {
    const { rerender } = render(<UserList users={[]} onSetAllowed={() => {}} />);
    expect(screen.getByText(/no users/i)).toBeInTheDocument();
    rerender(<UserList users={[{ uid: "u1", isAllowed: true, isAdmin: false }]} onSetAllowed={() => {}} />);
    expect(screen.getByText(/u1/)).toBeInTheDocument();
  });
});

describe("GrantByUidForm", () => {
  it("emits uid + email", async () => {
    const onGrant = vi.fn();
    render(<GrantByUidForm onGrant={onGrant} />);
    await userEvent.type(screen.getByLabelText(/uid/i), "NewUid");
    await userEvent.type(screen.getByLabelText(/email/i), "n@x.com");
    await userEvent.click(screen.getByRole("button", { name: /grant/i }));
    expect(onGrant).toHaveBeenCalledWith("NewUid", "n@x.com");
  });
});
```

- [ ] **Step 3: Implement**

`UserRow.tsx`:
```tsx
import type { AdminUser } from "../types";
export function UserRow({ user, onSetAllowed }: { user: AdminUser; onSetAllowed: (uid: string, next: boolean) => void }) {
  return (
    <li className="user-row">
      <span>{user.email ?? user.uid}</span>
      {user.isAdmin && <span className="badge">admin</span>}
      <span>{user.isAllowed ? "allowed" : "not allowed"}</span>
      <button onClick={() => onSetAllowed(user.uid, !user.isAllowed)}>
        {user.isAllowed ? "Revoke" : "Allow"}
      </button>
    </li>
  );
}
```
`UserList.tsx`:
```tsx
import { UserRow } from "./UserRow";
import { EmptyState } from "../../dashboard/components/EmptyState";
import type { AdminUser } from "../types";
export function UserList({ users, onSetAllowed }: { users: AdminUser[]; onSetAllowed: (uid: string, next: boolean) => void }) {
  if (users.length === 0) return <EmptyState message="No users." />;
  return <ul>{users.map((u) => <UserRow key={u.uid} user={u} onSetAllowed={onSetAllowed} />)}</ul>;
}
```
`GrantByUidForm.tsx`:
```tsx
import { useState } from "react";
export function GrantByUidForm({ onGrant }: { onGrant: (uid: string, email: string) => void }) {
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (uid.trim()) onGrant(uid.trim(), email.trim()); setUid(""); setEmail(""); }}>
      <label>UID <input value={uid} onChange={(e) => setUid(e.target.value)} /></label>
      <label>Email <input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <button type="submit">Grant access</button>
    </form>
  );
}
```

- [ ] **Step 4: GREEN.** **Step 5: Commit** — `git add web/src/admin/types.ts web/src/admin/components && git commit -m "feat(web): admin user-row/list + grant-by-uid components"`

---

## Task 5: Admin client (frontend glue)

**Files:** Create `web/src/admin/client.ts`

- [ ] **Step 1: Implement** (mirrors `keys/client.ts`)

```typescript
import { auth } from "../firebase";
import type { AdminUser } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function headers(): Promise<HeadersInit> {
  const token = await auth.currentUser!.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = (await res.json())?.error?.message ?? message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
export async function listUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${BASE}/v1/admin/users`, { headers: await headers() });
  return (await parse<{ users: AdminUser[] }>(res)).users;
}
export async function setAllowed(uid: string, isAllowed: boolean, email?: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/admin/users/${uid}`, {
    method: "PUT", headers: await headers(),
    body: JSON.stringify(email ? { isAllowed, email } : { isAllowed }),
  });
  await parse<unknown>(res);
}
```

- [ ] **Step 2: Build** — clean. **Step 3: Commit** — `git add web/src/admin/client.ts && git commit -m "feat(web): admin client (list users / set allowed)"`

---

## Task 6: AdminPage + route + App.test

**Files:** Create `web/src/admin/AdminPage.tsx`; Modify `web/src/App.tsx`, `web/src/App.test.tsx`

- [ ] **Step 1: `web/src/admin/AdminPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { listUsers, setAllowed } from "./client";
import { UserList } from "./components/UserList";
import { GrantByUidForm } from "./components/GrantByUidForm";
import { Spinner } from "../dashboard/components/Spinner";
import { ErrorNote } from "../dashboard/components/ErrorNote";
import type { AdminUser } from "./types";

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try { setUsers(await listUsers()); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const act = (p: Promise<unknown>) => p.then(refresh).catch((e) => setError((e as Error).message));

  return (
    <div>
      <h1>Admin — allowlist</h1>
      <h2>Grant access by UID</h2>
      <GrantByUidForm onGrant={(uid, email) => act(setAllowed(uid, true, email || undefined))} />
      {error && <ErrorNote message={error} />}
      {loading ? <Spinner /> : <UserList users={users} onSetAllowed={(uid, next) => act(setAllowed(uid, next))} />}
    </div>
  );
}
```

- [ ] **Step 2: Wire route in `web/src/App.tsx`** — `import { AdminPage } from "./admin/AdminPage";` and add `<Route path="admin" element={<AdminPage />} />` inside the AppShell layout route.

- [ ] **Step 3: Update `web/src/App.test.tsx`** — add the hoisted mock:

```ts
vi.mock("./admin/client", () => ({
  listUsers: () => Promise.resolve([]),
  setAllowed: vi.fn(),
}));
```
(alongside `./dashboard/hooks`, `./teams/hooks`, `./teams/actions`, `./keys/client`.)

- [ ] **Step 4: Build + full test** — `cd web && npm run build` clean; `npm test` all green.
- [ ] **Step 5: Commit** — `git add web/src/admin/AdminPage.tsx web/src/App.tsx web/src/App.test.tsx && git commit -m "feat(web): AdminPage + /admin route"`

---

## Task 7: README

**Files:** Modify `README.md`

- [ ] **Step 1:** Add an "Admin allowlist" note: the `/admin` page (admins only); the admin API `/v1/admin/*` is ID-token + `isAdmin`-gated and only toggles `isAllowed` (never `isAdmin`); the **first admin is bootstrapped manually** (set `users/{uid}.isAdmin = true` in the Firebase console); grant access to a never-seen user via the "grant by UID" input using the uid shown on their request-access screen.
- [ ] **Step 2: Commit** — `git add README.md && git commit -m "docs: document the admin allowlist + first-admin bootstrap"`

---

## Done criteria

- `cd functions && npm test` green (requireAdmin + admin routes); `cd web && npm test` green (admin components + updated AppShell/App); both `npm run build` clean.
- An admin can list users, toggle `isAllowed`, and grant a never-provisioned user by UID; the Admin nav link shows only for admins; the admin API is 401/403-gated and never changes `isAdmin`.
- No Firestore rules change; `users/` stays client-locked (all admin ops via the Admin SDK API).

## Operational (after merge)
`firebase deploy --only functions,hosting`. Bootstrap the first admin once in the console (`users/{uid}.isAdmin = true`).
