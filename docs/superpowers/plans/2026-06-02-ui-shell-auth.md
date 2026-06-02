# Daloop UI — App Shell & Auth (UI-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite+React+TS SPA (`web/`) with Google sign-in, a flash-free `isAllowed` access gate, an authenticated app shell with nav placeholders, and Firebase Hosting deploy.

**Architecture:** A pure `deriveAccess` decides one of four states (loading/signed-out/pending/allowed) from two resolution signals (auth resolved, user-doc resolved). A firebase-free `AuthContext`/`useAuth` seam is what every screen and test consumes; `AuthProvider` is the only Firebase glue (onAuthStateChanged + a `users/{uid}` onSnapshot, with listener-teardown and error handling). Tests mock the seam with a plain context value — no Firebase.

**Tech Stack:** Vite, React 18, TypeScript, react-router-dom v6, Firebase web SDK v11, Vitest + jsdom + React Testing Library. Firebase Hosting (same project, `daloop-42b47`).

**Reference spec:** `docs/superpowers/specs/2026-06-02-ui-shell-auth-design.md`

---

## Background / conventions

- New top-level `web/` package, independent of `functions/` (no npm workspaces). Run UI commands from `web/`.
- **Test seam split (important):** `auth/gate.ts` (pure) and `auth/context.tsx` (AuthContext + `useAuth`, types) are **firebase-free** — screens, `App`, and tests import only these. `auth/AuthProvider.tsx` (and `firebase.ts`) hold all Firebase imports and are loaded only by `main.tsx` (the real entry), never by tests. This keeps tests from ever importing `firebase`.
- Tests: `npm test` in `web/` runs `vitest run`. Vitest uses esbuild (no type-check); `npm run build` runs `tsc -b && vite build` for type-checking + bundle.

## File structure

| File | Responsibility |
|---|---|
| `web/package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html`, `.env.example`, `.gitignore`, `src/setupTests.ts` | scaffold + test harness |
| `web/src/auth/gate.ts` | pure `deriveAccess` + `AccessState` type |
| `web/src/auth/context.tsx` | `AuthContext`, `useAuth`, `AuthValue`/`AuthUser` types (firebase-free) |
| `web/src/routes/{SignIn,RequestAccess,AppShell,Home}.tsx` | screens consuming `useAuth()` |
| `web/src/App.tsx` | root: switch on `useAuth().state` → spinner/SignIn/RequestAccess/router(AppShell) |
| `web/src/firebase.ts` | `initializeApp` → `auth`, `db` |
| `web/src/auth/AuthProvider.tsx` | Firebase wiring → provides `AuthContext` value |
| `web/src/main.tsx` | real entry: `<AuthProvider><App/></AuthProvider>` |
| `firebase.json` | add `hosting` block + `predeploy` build hook |

---

## Task 1: Scaffold the web/ package + test harness

**Files:** Create `web/package.json`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/vite.config.ts`, `web/index.html`, `web/.env.example`, `web/.gitignore`, `web/src/setupTests.ts`, `web/src/smoke.test.tsx`

- [ ] **Step 1: `web/package.json`**

```json
{
  "name": "daloop-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "firebase": "^11.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `web/vite.config.ts`** (Vitest config inline)

```typescript
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, setupFiles: "./src/setupTests.ts" },
});
```

- [ ] **Step 3: tsconfigs**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```
`web/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true
  },
  "include": ["vite.config.ts"]
}
```

> NOTE: do NOT add `"noEmit": true` here. A `composite` referenced project must emit
> (it produces `.tsbuildinfo`/declarations for `tsc -b`); `composite` + `noEmit`
> fails with TS6310 and breaks `npm run build`. The root `tsconfig.json` keeps
> `noEmit: true`, so no JS is emitted from `src/`.

- [ ] **Step 4: `web/index.html`, `web/src/setupTests.ts`, `web/.env.example`, `web/.gitignore`**

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Daloop</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```
`web/src/setupTests.ts`:
```typescript
import "@testing-library/jest-dom";
```
`web/.env.example`:
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```
`web/.gitignore`:
```
node_modules/
dist/
.env
```

- [ ] **Step 5: Smoke test `web/src/smoke.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("harness", () => {
  it("renders with RTL + jsdom", () => {
    render(<p>hello daloop</p>);
    expect(screen.getByText("hello daloop")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Install + run** — `cd web && npm install && npm test` → 1 test passes.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/tsconfig.json web/tsconfig.node.json web/vite.config.ts web/index.html web/.env.example web/.gitignore web/src/setupTests.ts web/src/smoke.test.tsx web/package-lock.json
git commit -m "chore(web): scaffold Vite+React+TS SPA with Vitest+RTL harness"
```

---

## Task 2: Pure access gate (`gate.ts`)

**Files:** Create `web/src/auth/gate.ts`; Test `web/src/auth/gate.test.ts`

- [ ] **Step 1: Failing test `web/src/auth/gate.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { deriveAccess } from "./gate";

const u = { uid: "u1", email: "u@x.com" };

describe("deriveAccess", () => {
  it("loading until auth resolves", () => {
    expect(deriveAccess({ authResolved: false, user: null, userDocResolved: false, isAllowed: false })).toBe("loading");
  });
  it("signed-out when auth resolved and no user", () => {
    expect(deriveAccess({ authResolved: true, user: null, userDocResolved: false, isAllowed: false })).toBe("signed-out");
  });
  it("loading while the user doc is not yet resolved (flash-prevention)", () => {
    expect(deriveAccess({ authResolved: true, user: u, userDocResolved: false, isAllowed: false })).toBe("loading");
  });
  it("allowed when user doc resolved and isAllowed", () => {
    expect(deriveAccess({ authResolved: true, user: u, userDocResolved: true, isAllowed: true })).toBe("allowed");
  });
  it("pending when user doc resolved but not allowed (missing or false)", () => {
    expect(deriveAccess({ authResolved: true, user: u, userDocResolved: true, isAllowed: false })).toBe("pending");
  });
});
```

- [ ] **Step 2: RED** — `npm test -- gate` → FAIL.

- [ ] **Step 3: Implement `web/src/auth/gate.ts`**

```typescript
export type AccessState = "loading" | "signed-out" | "pending" | "allowed";

export interface AccessUser {
  uid: string;
  email: string | null;
}

export interface AccessInputs {
  authResolved: boolean;
  user: AccessUser | null;
  userDocResolved: boolean;
  isAllowed: boolean;
}

export function deriveAccess(i: AccessInputs): AccessState {
  if (!i.authResolved) return "loading";
  if (!i.user) return "signed-out";
  if (!i.userDocResolved) return "loading"; // flash-prevention: don't show "pending" before the doc loads
  return i.isAllowed ? "allowed" : "pending";
}
```

- [ ] **Step 4: GREEN** — `npm test -- gate` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/auth/gate.ts web/src/auth/gate.test.ts
git commit -m "feat(web): pure deriveAccess gate (flash-free four-state)"
```

---

## Task 3: Auth context + `useAuth` seam (firebase-free)

**Files:** Create `web/src/auth/context.tsx`; Test `web/src/auth/context.test.tsx`

- [ ] **Step 1: Failing test `web/src/auth/context.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthContext, useAuth, type AuthValue } from "./context";

function Probe() {
  const { state, user } = useAuth();
  return <div>{state}:{user?.email ?? "none"}</div>;
}

const value: AuthValue = {
  state: "allowed", user: { uid: "u1", email: "u@x.com" }, isAllowed: true,
  signIn: async () => {}, signOut: async () => {}, signInError: null,
};

describe("useAuth", () => {
  it("reads the provided context value", () => {
    render(<AuthContext.Provider value={value}><Probe /></AuthContext.Provider>);
    expect(screen.getByText("allowed:u@x.com")).toBeInTheDocument();
  });
  it("throws when used outside a provider", () => {
    expect(() => render(<Probe />)).toThrow(/useAuth must be used within/);
  });
});
```

- [ ] **Step 2: RED** — `npm test -- context` → FAIL.

- [ ] **Step 3: Implement `web/src/auth/context.tsx`**

```tsx
import { createContext, useContext } from "react";
import type { AccessState, AccessUser } from "./gate";

export type AuthUser = AccessUser;

export interface AuthValue {
  state: AccessState;
  user: AuthUser | null;
  isAllowed: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  signInError: string | null;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
```

- [ ] **Step 4: GREEN** — `npm test -- context` → PASS. (The "throws outside provider" test logs a React error boundary warning; that's expected.)

- [ ] **Step 5: Commit**

```bash
git add web/src/auth/context.tsx web/src/auth/context.test.tsx
git commit -m "feat(web): firebase-free AuthContext + useAuth seam"
```

---

## Task 4: Screens (SignIn / RequestAccess / AppShell / Home)

**Files:** Create `web/src/routes/{SignIn,RequestAccess,AppShell,Home}.tsx`; Test `web/src/routes/screens.test.tsx`

- [ ] **Step 1: Failing test `web/src/routes/screens.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthValue } from "../auth/context";
import { SignIn } from "./SignIn";
import { RequestAccess } from "./RequestAccess";
import { AppShell } from "./AppShell";

function withAuth(partial: Partial<AuthValue>, node: React.ReactNode) {
  const value: AuthValue = {
    state: "allowed", user: { uid: "u1", email: "u@x.com" }, isAllowed: true,
    signIn: async () => {}, signOut: async () => {}, signInError: null, ...partial,
  };
  return render(<AuthContext.Provider value={value}><MemoryRouter>{node}</MemoryRouter></AuthContext.Provider>);
}

describe("SignIn", () => {
  it("calls signIn on click and shows an error when present", async () => {
    const signIn = vi.fn();
    withAuth({ signIn, signInError: "popup blocked" }, <SignIn />);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(signIn).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("popup blocked");
  });
});

describe("RequestAccess", () => {
  it("shows the user's email and uid", () => {
    withAuth({ user: { uid: "abc123", email: "p@x.com" } }, <RequestAccess />);
    expect(screen.getByText(/p@x.com/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });
});

describe("AppShell", () => {
  it("renders nav + email and Sign out calls signOut", async () => {
    const signOut = vi.fn();
    withAuth({ signOut }, <AppShell />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText("u@x.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: RED** — `npm test -- screens` → FAIL.

- [ ] **Step 3: Implement the four screens**

`web/src/routes/SignIn.tsx`:
```tsx
import { useAuth } from "../auth/context";

export function SignIn() {
  const { signIn, signInError } = useAuth();
  return (
    <main>
      <h1>Daloop</h1>
      <button onClick={() => void signIn()}>Sign in with Google</button>
      {signInError && <p role="alert">{signInError}</p>}
    </main>
  );
}
```
`web/src/routes/RequestAccess.tsx`:
```tsx
import { useAuth } from "../auth/context";

export function RequestAccess() {
  const { user, signOut } = useAuth();
  return (
    <main>
      <h1>Access pending</h1>
      <p>Ask an admin to grant Daloop access to your account:</p>
      <p>Email: <code>{user?.email}</code></p>
      <p>User ID: <code>{user?.uid}</code></p>
      <button onClick={() => void signOut()}>Sign out</button>
    </main>
  );
}
```
`web/src/routes/AppShell.tsx`:
```tsx
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/context";

export function AppShell() {
  const { user, signOut } = useAuth();
  return (
    <div>
      <header>
        <span>Daloop</span>
        <nav>
          <NavLink to="/">Home</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/teams">Teams</NavLink>
          <NavLink to="/keys">API Keys</NavLink>
        </nav>
        <span>{user?.email}</span>
        <button onClick={() => void signOut()}>Sign out</button>
      </header>
      <main><Outlet /></main>
    </div>
  );
}
```
`web/src/routes/Home.tsx`:
```tsx
export function Home() {
  return <p>Daloop — pick a section.</p>;
}
```

- [ ] **Step 4: GREEN** — `npm test -- screens` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/SignIn.tsx web/src/routes/RequestAccess.tsx web/src/routes/AppShell.tsx web/src/routes/Home.tsx web/src/routes/screens.test.tsx
git commit -m "feat(web): SignIn, RequestAccess, AppShell, Home screens"
```

---

## Task 5: App root — gate rendering + routing

**Files:** Create `web/src/App.tsx`; Test `web/src/App.test.tsx`

- [ ] **Step 1: Failing test `web/src/App.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthContext, type AuthValue } from "./auth/context";
import { App } from "./App";

function renderState(partial: Partial<AuthValue>) {
  const value: AuthValue = {
    state: "loading", user: null, isAllowed: false,
    signIn: async () => {}, signOut: async () => {}, signInError: null, ...partial,
  };
  return render(<AuthContext.Provider value={value}><App /></AuthContext.Provider>);
}

describe("App gate", () => {
  it("loading -> spinner", () => {
    renderState({ state: "loading" });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("signed-out -> SignIn", () => {
    renderState({ state: "signed-out" });
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
  it("pending -> RequestAccess with email+uid", () => {
    renderState({ state: "pending", user: { uid: "abc123", email: "p@x.com" } });
    expect(screen.getByText(/p@x.com/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });
  it("allowed -> AppShell + Home", () => {
    renderState({ state: "allowed", user: { uid: "u1", email: "u@x.com" }, isAllowed: true });
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/pick a section/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED** — `npm test -- App` → FAIL.

- [ ] **Step 3: Implement `web/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuth } from "./auth/context";
import { SignIn } from "./routes/SignIn";
import { RequestAccess } from "./routes/RequestAccess";
import { AppShell } from "./routes/AppShell";
import { Home } from "./routes/Home";

function ComingSoon() {
  return <p>Coming soon.</p>;
}

export function App() {
  const { state } = useAuth();
  if (state === "loading") return <p role="status">Loading…</p>;
  if (state === "signed-out") return <SignIn />;
  if (state === "pending") return <RequestAccess />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<ComingSoon />} />
          <Route path="teams" element={<ComingSoon />} />
          <Route path="keys" element={<ComingSoon />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: GREEN** — `npm test -- App` → PASS. Then full `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): App root gate rendering + router"
```

---

## Task 6: Firebase wiring (`firebase.ts`, `AuthProvider.tsx`, `main.tsx`)

**Files:** Create `web/src/firebase.ts`, `web/src/auth/AuthProvider.tsx`, `web/src/main.tsx`

This is the Firebase glue (no unit tests per the spec — the decision logic lives in the tested `gate.ts`); correctness is verified by `npm run build` (type-check) and a manual smoke later.

- [ ] **Step 1: `web/src/firebase.ts`**

```typescript
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
```

- [ ] **Step 2: `web/src/auth/AuthProvider.tsx`** (implements the spec's contract: two flags, listener teardown, error handling, signIn/signOut error handling)

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as fbSignOut,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase";
import { AuthContext, type AuthUser } from "./context";
import { deriveAccess } from "./gate";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authResolved, setAuthResolved] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userDocResolved, setUserDocResolved] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const unsubDoc = useRef<null | (() => void)>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      // Tear down any prior users/{uid} listener and reset doc state.
      if (unsubDoc.current) { unsubDoc.current(); unsubDoc.current = null; }
      setUserDocResolved(false);
      setIsAllowed(false);
      setAuthResolved(true);
      if (!u) { setUser(null); return; }
      setUser({ uid: u.uid, email: u.email });
      unsubDoc.current = onSnapshot(
        doc(db, "users", u.uid),
        (snap) => { setIsAllowed(snap.exists() && snap.data().isAllowed === true); setUserDocResolved(true); },
        (err) => { console.error("users doc listener:", err); setIsAllowed(false); setUserDocResolved(true); },
      );
    });
    return () => { unsubAuth(); if (unsubDoc.current) unsubDoc.current(); };
  }, []);

  const signIn = async () => {
    setSignInError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      setSignInError((e as Error).message ?? "Sign-in failed");
    }
  };

  const signOut = async () => {
    try { await fbSignOut(auth); } catch (e) { console.error("sign out:", e); }
  };

  const state = deriveAccess({ authResolved, user, userDocResolved, isAllowed });
  return (
    <AuthContext.Provider value={{ state, user, isAllowed, signIn, signOut, signInError }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 3: `web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth/AuthProvider";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Build + full test**

Run: `cd web && npm run build` → type-checks and produces `web/dist` with no errors. Run `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/firebase.ts web/src/auth/AuthProvider.tsx web/src/main.tsx
git commit -m "feat(web): Firebase auth wiring (AuthProvider) + entry"
```

---

## Task 7: Hosting config + docs

**Files:** Modify `firebase.json`; Modify `README.md`

- [ ] **Step 1: Add the `hosting` block to `firebase.json`** (keep `functions` + `firestore` unchanged; add a sibling key)

```json
"hosting": {
  "public": "web/dist",
  "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
  "predeploy": ["npm --prefix web run build"],
  "rewrites": [{ "source": "**", "destination": "/index.html" }]
}
```

- [ ] **Step 2: Validate** — `node -e "require('./firebase.json'); console.log('ok')"` → `ok`. (No `/v1` rewrite is added — the API is reached by its own Cloud Functions URL.)

- [ ] **Step 3: README — add a "Web UI" section**

Document: the `web/` Vite SPA; `cd web && npm install`, `npm run dev` (local), `npm test`, `npm run build`; the `VITE_FIREBASE_*` config in `web/.env` (public client config); deploy via `firebase deploy --only hosting` (the predeploy hook builds). One-time console setup: enable the **Google** sign-in provider in Firebase Auth and add the Hosting domain(s) **and `localhost`** to Auth → authorized domains. Note access is gated by `users/{uid}.isAllowed` (provisioned manually for now).

- [ ] **Step 4: Commit**

```bash
git add firebase.json README.md
git commit -m "feat(web): Firebase Hosting config + docs"
```

---

## Done criteria

- `cd web && npm test` passes (gate, context, screens, App, smoke); `npm run build` is clean and produces `web/dist`.
- The gate is flash-free: a signed-in user with an unresolved user-doc shows the spinner, never RequestAccess; sign-out and uid-switch reset cleanly (covered by `deriveAccess` branches + the `AuthProvider` contract).
- `firebase.json` has a `hosting` block with a `predeploy` build hook and the SPA rewrite; no `/v1` rewrite.
- README documents setup, local dev, test, build, deploy, and the one-time Google-provider + authorized-domains steps.
- Functions/API/rules and the CLI are untouched.

## Manual verification (after deploy, optional — not a TDD task)

`firebase deploy --only hosting`, open the Hosting URL: signed-out shows Sign in; after Google sign-in a not-allowlisted account shows the request-access screen with its uid; flip `users/{uid}.isAllowed=true` in the console and the app advances to the shell live.
