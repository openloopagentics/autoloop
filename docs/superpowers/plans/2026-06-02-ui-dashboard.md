# Daloop UI — Status Dashboard (UI-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** A live, read-only dashboard in the existing `web/` SPA showing the user's teams → projects → phases → commits via Firestore listeners.

**Architecture:** Pure `statusColor` + props-only presentational components (unit-tested with fixtures); Firebase `onSnapshot` hooks in one module (glue, build-verified); thin keyed containers (one listener per child component → fixed hook count, no rules-of-hooks violation) wire hooks to components; routes added under the existing `AppShell`.

**Tech Stack:** React 18 + TS, react-router-dom v6, Firebase web SDK v11, Vitest + jsdom + RTL. Run from `web/`.

**Reference spec:** `docs/superpowers/specs/2026-06-02-ui-dashboard-design.md`. Builds on UI-A (`web/src/auth/*`, `App.tsx`, `firebase.ts` exporting `db`/`auth`).

---

## Conventions

- Tests live beside source under `web/src/dashboard/`. Run `npm test -- <filter>` from `web/`.
- Presentational components + `statusColor` are unit-tested. Hooks (`hooks.ts`) and the page/container wrappers are Firebase glue — not unit-tested; verified by `npm run build` + full `npm test` staying green.
- Tasks 1–4 are additive pure/component code (suite stays green). Task 5 adds hooks (build-only). Task 6 wires pages/containers + routes.

---

## Task 1: `statusColor` (pure)

**Files:** Create `web/src/dashboard/status.ts`; Test `web/src/dashboard/status.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { statusColor } from "./status";

describe("statusColor", () => {
  it("maps each status to a color class", () => {
    expect(statusColor("queued")).toBe("gray");
    expect(statusColor("running")).toBe("blue");
    expect(statusColor("blocked")).toBe("red");
    expect(statusColor("paused")).toBe("amber");
    expect(statusColor("completed")).toBe("green");
    expect(statusColor("failed")).toBe("red");
    expect(statusColor("cancelled")).toBe("gray");
  });
  it("defaults to gray for an unknown status", () => {
    expect(statusColor("???")).toBe("gray");
  });
});
```

- [ ] **Step 2: RED** — `npm test -- status` → FAIL.

- [ ] **Step 3: Implement `web/src/dashboard/status.ts`**

```typescript
const COLORS: Record<string, string> = {
  queued: "gray", running: "blue", blocked: "red", paused: "amber",
  completed: "green", failed: "red", cancelled: "gray",
};

export function statusColor(status: string): string {
  return COLORS[status] ?? "gray";
}
```

- [ ] **Step 4: GREEN** — PASS.
- [ ] **Step 5: Commit** — `git add web/src/dashboard/status.ts web/src/dashboard/status.test.ts && git commit -m "feat(web): dashboard statusColor table"`

---

## Task 2: Shared presentational components

**Files:** Create `web/src/dashboard/components/{StatusBadge,EmptyState,ErrorNote,Spinner}.tsx`; Test `web/src/dashboard/components/shared.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { EmptyState } from "./EmptyState";
import { ErrorNote } from "./ErrorNote";
import { Spinner } from "./Spinner";

describe("shared components", () => {
  it("StatusBadge shows the status text and a color data attr", () => {
    render(<StatusBadge status="running" />);
    const el = screen.getByText("running");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-color", "blue");
  });
  it("EmptyState renders its message", () => {
    render(<EmptyState message="No teams" />);
    expect(screen.getByText("No teams")).toBeInTheDocument();
  });
  it("ErrorNote renders its message with role=alert", () => {
    render(<ErrorNote message="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
  it("Spinner has role=status", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement the four components**

`StatusBadge.tsx`:
```tsx
import { statusColor } from "../status";
export function StatusBadge({ status }: { status: string }) {
  return <span data-color={statusColor(status)} className={`badge badge-${statusColor(status)}`}>{status}</span>;
}
```
`EmptyState.tsx`:
```tsx
export function EmptyState({ message }: { message: string }) {
  return <p className="empty">{message}</p>;
}
```
`ErrorNote.tsx`:
```tsx
export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="error">{message}</p>;
}
```
`Spinner.tsx`:
```tsx
export function Spinner() {
  return <p role="status">Loading…</p>;
}
```

- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** — `git add web/src/dashboard/components && git commit -m "feat(web): shared dashboard components (badge/empty/error/spinner)"`

---

## Task 3: TeamSection + ProjectCard

**Files:** Create `web/src/dashboard/components/{ProjectCard,TeamSection}.tsx` + types `web/src/dashboard/types.ts`; Test `web/src/dashboard/components/team.test.tsx`

- [ ] **Step 1: types `web/src/dashboard/types.ts`**

```typescript
export interface TeamRef { teamId: string; role: string; }
export interface Team { name?: string; }
export interface Project { slug: string; title?: string; status?: string; currentPhaseId?: string | null; design?: { format: "markdown" | "url"; content: string } | null; }
export interface Phase { name?: string; order?: number; status?: string; startedAt?: unknown; endedAt?: unknown; }
export interface Commit { sha: string; message?: string; author?: string; committedAt?: unknown; }
```

- [ ] **Step 2: Failing test `team.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectCard } from "./ProjectCard";
import { TeamSection } from "./TeamSection";

function wrap(node: React.ReactNode) { return render(<MemoryRouter>{node}</MemoryRouter>); }

describe("ProjectCard", () => {
  it("shows title, status, current phase, and links to detail", () => {
    wrap(<ProjectCard teamId="t1" project={{ slug: "web", title: "Web", status: "running", currentPhaseId: "build" }} />);
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/build/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard/t1/web");
  });
  it("shows 'no active phase' when currentPhaseId is null", () => {
    wrap(<ProjectCard teamId="t1" project={{ slug: "web", title: "Web", status: "queued", currentPhaseId: null }} />);
    expect(screen.getByText(/no active phase/i)).toBeInTheDocument();
  });
});

describe("TeamSection", () => {
  const team = { name: "Acme" };
  it("spinner when loading, error when error, empty when no projects, cards when populated", () => {
    const { rerender } = wrap(<TeamSection team={team} projects={[]} loading={true} error={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<MemoryRouter><TeamSection team={team} projects={[]} loading={false} error={"x"} /></MemoryRouter>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<MemoryRouter><TeamSection team={team} projects={[]} loading={false} error={null} /></MemoryRouter>);
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    rerender(<MemoryRouter><TeamSection team={team} projects={[{ slug: "web", title: "Web", status: "running", currentPhaseId: "build" }]} loading={false} error={null} /></MemoryRouter>);
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement**

`ProjectCard.tsx`:
```tsx
import { Link } from "react-router-dom";
import { StatusBadge } from "./StatusBadge";
import type { Project } from "../types";

export function ProjectCard({ teamId, project }: { teamId: string; project: Project }) {
  return (
    <Link to={`/dashboard/${teamId}/${project.slug}`} className="project-card">
      <span className="title">{project.title ?? project.slug}</span>
      {project.status && <StatusBadge status={project.status} />}
      <span className="phase">{project.currentPhaseId ? `phase: ${project.currentPhaseId}` : "no active phase"}</span>
    </Link>
  );
}
```
`TeamSection.tsx`:
```tsx
import { ProjectCard } from "./ProjectCard";
import { Spinner } from "./Spinner";
import { ErrorNote } from "./ErrorNote";
import { EmptyState } from "./EmptyState";
import type { Project, Team } from "../types";

export function TeamSection(props: {
  teamId?: string; team: Team; projects: Project[]; loading: boolean; error: string | null;
}) {
  const { teamId = "", team, projects, loading, error } = props;
  return (
    <section className="team-section">
      <h2>{team.name ?? teamId}</h2>
      {loading ? <Spinner />
        : error ? <ErrorNote message={error} />
        : projects.length === 0 ? <EmptyState message="No projects yet" />
        : projects.map((p) => <ProjectCard key={p.slug} teamId={teamId} project={p} />)}
    </section>
  );
}
```

- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** — `git add web/src/dashboard/types.ts web/src/dashboard/components/ProjectCard.tsx web/src/dashboard/components/TeamSection.tsx web/src/dashboard/components/team.test.tsx && git commit -m "feat(web): ProjectCard + TeamSection"`

---

## Task 4: ProjectHeader + PhaseItem + CommitItem

**Files:** Create `web/src/dashboard/components/{ProjectHeader,PhaseItem,CommitItem}.tsx`; Test `web/src/dashboard/components/detail.test.tsx`

- [ ] **Step 1: Failing test `detail.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectHeader } from "./ProjectHeader";
import { PhaseItem } from "./PhaseItem";
import { CommitItem } from "./CommitItem";

describe("ProjectHeader", () => {
  it("renders a link for url design and preformatted for markdown", () => {
    const { rerender } = render(<ProjectHeader project={{ slug: "web", title: "Web", status: "running", design: { format: "url", content: "https://x/plan" } }} />);
    expect(screen.getByRole("link", { name: /plan/i })).toHaveAttribute("href", "https://x/plan");
    rerender(<ProjectHeader project={{ slug: "web", title: "Web", status: "running", design: { format: "markdown", content: "# Plan" } }} />);
    expect(screen.getByText("# Plan")).toBeInTheDocument();
  });
});

describe("PhaseItem", () => {
  it("shows phase name+status and its commits, or empty", () => {
    const { rerender } = render(<PhaseItem phase={{ name: "Build", order: 1, status: "running" }} commits={[{ sha: "abcdef1", message: "init", author: "a" }]} />);
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("init")).toBeInTheDocument();
    rerender(<PhaseItem phase={{ name: "Build", order: 1, status: "running" }} commits={[]} />);
    expect(screen.getByText(/no commits yet/i)).toBeInTheDocument();
  });
});

describe("CommitItem", () => {
  it("shows short sha, message, author", () => {
    render(<CommitItem commit={{ sha: "deadbeefcafe", message: "fix", author: "alice" }} />);
    expect(screen.getByText("fix")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText(/deadbee/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

`CommitItem.tsx`:
```tsx
import type { Commit } from "../types";
export function CommitItem({ commit }: { commit: Commit }) {
  return (
    <li className="commit">
      <code>{commit.sha.slice(0, 7)}</code> <span>{commit.message}</span> <em>{commit.author}</em>
    </li>
  );
}
```
`PhaseItem.tsx`:
```tsx
import { StatusBadge } from "./StatusBadge";
import { CommitItem } from "./CommitItem";
import { EmptyState } from "./EmptyState";
import type { Phase, Commit } from "../types";

export function PhaseItem({ phase, commits }: { phase: Phase; commits: Commit[] }) {
  return (
    <div className="phase">
      <h3>{phase.name} {phase.status && <StatusBadge status={phase.status} />}</h3>
      {commits.length === 0 ? <EmptyState message="No commits yet" />
        : <ul>{commits.map((c) => <CommitItem key={c.sha} commit={c} />)}</ul>}
    </div>
  );
}
```
`ProjectHeader.tsx`:
```tsx
import { StatusBadge } from "./StatusBadge";
import type { Project } from "../types";

export function ProjectHeader({ project }: { project: Project }) {
  return (
    <header className="project-header">
      <h1>{project.title ?? project.slug} {project.status && <StatusBadge status={project.status} />}</h1>
      {project.design?.format === "url"
        ? <a href={project.design.content}>{project.design.content}</a>
        : project.design
          ? <pre>{project.design.content}</pre>
          : null}
    </header>
  );
}
```

- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** — `git add web/src/dashboard/components/ProjectHeader.tsx web/src/dashboard/components/PhaseItem.tsx web/src/dashboard/components/CommitItem.tsx web/src/dashboard/components/detail.test.tsx && git commit -m "feat(web): ProjectHeader + PhaseItem + CommitItem"`

---

## Task 5: Firestore data hooks (glue)

**Files:** Create `web/src/dashboard/hooks.ts`

No unit tests (Firebase glue). Verified by `npm run build`.

- [ ] **Step 1: Implement `web/src/dashboard/hooks.ts`**

```typescript
import { useEffect, useState } from "react";
import {
  collection, collectionGroup, doc, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Commit, Phase, Project, Team, TeamRef } from "./types";

interface Result<T> { data: T; loading: boolean; error: string | null; }

export function useMyTeams(): Result<TeamRef[]> {
  const [data, setData] = useState<TeamRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    const q = query(collectionGroup(db, "members"), where("uid", "==", uid));
    return onSnapshot(q,
      (snap) => {
        setData(snap.docs.map((d) => ({ teamId: d.ref.parent.parent?.id ?? "", role: d.data().role })).filter((t) => t.teamId));
        setLoading(false);
      },
      (e) => { setError(e.message); setLoading(false); });
  }, []);
  return { data, loading, error };
}

export function useTeam(teamId: string): Result<Team | null> {
  const [data, setData] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(doc(db, "teams", teamId),
      (snap) => { setData(snap.exists() ? (snap.data() as Team) : null); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId]);
  return { data, loading, error };
}

export function useTeamProjects(teamId: string): Result<Project[]> {
  const [data, setData] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(collection(db, "teams", teamId, "projects"),
      (snap) => { setData(snap.docs.map((d) => ({ slug: d.id, ...(d.data() as object) })) as Project[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId]);
  return { data, loading, error };
}

export function useProject(teamId: string, slug: string): Result<Project | null | undefined> {
  const [data, setData] = useState<Project | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(doc(db, "teams", teamId, "projects", slug),
      (snap) => { setData(snap.exists() ? ({ slug: snap.id, ...(snap.data() as object) } as Project) : null); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function usePhases(teamId: string, slug: string): Result<Phase[]> {
  const [data, setData] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "phases"), orderBy("order"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Phase[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useCommits(teamId: string, slug: string, phaseId: string): Result<Commit[]> {
  const [data, setData] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "phases", phaseId, "commits"), orderBy("createdAt", "desc"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, phaseId]);
  return { data, loading, error };
}
```

> Note: `Phase` needs an `id` to key commits — add `id?: string` to the `Phase` type in `types.ts` (the container uses `phase.id` for the `useCommits` call and the React key).

- [ ] **Step 2: Build** — `npm run build` → clean.
- [ ] **Step 3: Commit** — `git add web/src/dashboard/hooks.ts web/src/dashboard/types.ts && git commit -m "feat(web): dashboard Firestore listener hooks"`

---

## Task 6: Pages, containers, and routing

**Files:** Create `web/src/dashboard/{DashboardHome,ProjectDetail}.tsx`; Modify `web/src/App.tsx`

Thin glue (not unit-tested). Each container calls exactly one set of hooks (fixed count).

- [ ] **Step 1: `web/src/dashboard/DashboardHome.tsx`**

```tsx
import { useMyTeams, useTeam, useTeamProjects } from "./hooks";
import { TeamSection } from "./components/TeamSection";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import type { TeamRef } from "./types";

function TeamSectionContainer({ teamRef }: { teamRef: TeamRef }) {
  const team = useTeam(teamRef.teamId);
  const projects = useTeamProjects(teamRef.teamId);
  return (
    <TeamSection
      teamId={teamRef.teamId}
      team={team.data ?? {}}
      projects={projects.data}
      loading={team.loading || projects.loading}
      error={team.error ?? projects.error}
    />
  );
}

export function DashboardHome() {
  const { data: teams, loading, error } = useMyTeams();
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (teams.length === 0) return <EmptyState message="You're not on a team yet." />;
  return <>{teams.map((t) => <TeamSectionContainer key={t.teamId} teamRef={t} />)}</>;
}
```

- [ ] **Step 2: `web/src/dashboard/ProjectDetail.tsx`**

```tsx
import { useParams } from "react-router-dom";
import { useProject, usePhases, useCommits } from "./hooks";
import { ProjectHeader } from "./components/ProjectHeader";
import { PhaseItem } from "./components/PhaseItem";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import type { Phase } from "./types";

function PhaseItemContainer({ teamId, slug, phase }: { teamId: string; slug: string; phase: Phase & { id?: string } }) {
  const { data: commits } = useCommits(teamId, slug, phase.id ?? "");
  return <PhaseItem phase={phase} commits={commits} />;
}

export function ProjectDetail() {
  const { teamId = "", slug = "" } = useParams();
  const project = useProject(teamId, slug);
  const phases = usePhases(teamId, slug);
  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorNote message={project.error} />;
  if (project.data === null) return <EmptyState message="Project not found." />;
  return (
    <div>
      {project.data && <ProjectHeader project={project.data} />}
      {phases.loading ? <Spinner />
        : phases.error ? <ErrorNote message={phases.error} />
        : phases.data.length === 0 ? <EmptyState message="No phases yet." />
        : phases.data.map((p) => <PhaseItemContainer key={(p as { id?: string }).id} teamId={teamId} slug={slug} phase={p} />)}
    </div>
  );
}
```

- [ ] **Step 3: Wire routes in `web/src/App.tsx`**

Replace the `dashboard` placeholder route and add the detail route + an index redirect:
```tsx
import { Navigate } from "react-router-dom";
import { DashboardHome } from "./dashboard/DashboardHome";
import { ProjectDetail } from "./dashboard/ProjectDetail";
// ...inside <Route element={<AppShell />}> :
//   <Route index element={<Navigate to="/dashboard" replace />} />
//   <Route path="dashboard" element={<DashboardHome />} />
//   <Route path="dashboard/:teamId/:slug" element={<ProjectDetail />} />
//   <Route path="teams" element={<ComingSoon />} />
//   <Route path="keys" element={<ComingSoon />} />
```
(Remove the old `Home` import/route and the `dashboard → ComingSoon` placeholder; keep `ComingSoon` for teams/keys. `Home.tsx` can be deleted or left unused — delete it and its mention.)

> **App.test.tsx must be updated — and a plain assertion change is NOT enough.**
> Once `App.tsx` statically imports `DashboardHome`, the import chain
> `App → DashboardHome → hooks.ts → firebase.ts` runs at load time, and
> `firebase.ts`'s top-level `getAuth(app)` throws `auth/invalid-api-key` under the
> blank test env — crashing `App.test.tsx` at IMPORT time (it won't even collect).
> Fix: add a **hoisted `vi.mock("./dashboard/hooks", …)`** at the very top of
> `App.test.tsx` (vi.mock factories hoist above imports, so they intercept before
> `firebase.ts` loads). Stub all six hooks:
> ```ts
> import { vi } from "vitest";
> vi.mock("./dashboard/hooks", () => ({
>   useMyTeams: () => ({ data: [], loading: false, error: null }),
>   useTeam: () => ({ data: null, loading: false, error: null }),
>   useTeamProjects: () => ({ data: [], loading: false, error: null }),
>   useProject: () => ({ data: null, loading: false, error: null }),
>   usePhases: () => ({ data: [], loading: false, error: null }),
>   useCommits: () => ({ data: [], loading: false, error: null }),
> }));
> ```
> AND change the "allowed" assertion from `/pick a section/` (Home is removed) to
> assert the AppShell nav renders, e.g. `getByRole("link", { name: /dashboard/i })`.
> (With the mock, `DashboardHome` renders its no-teams `EmptyState` — fine; the
> assertion just checks the nav.) Verified: App.test 4/4 green with this. The
> dashboard data path is covered by the component tests, not App.test.

- [ ] **Step 4: Build + full test**

`npm run build` → clean. `npm test` → all green (status, shared, team, detail, App updated, context, gate, smoke).

- [ ] **Step 5: Commit** — `git add web/src/dashboard/DashboardHome.tsx web/src/dashboard/ProjectDetail.tsx web/src/App.tsx web/src/App.test.tsx && git rm web/src/routes/Home.tsx 2>/dev/null; git commit -m "feat(web): dashboard pages + routes (live teams/projects/phases/commits)"`

---

## Done criteria

- `npm test` green (statusColor + all presentational components + updated App); `npm run build` clean.
- `/dashboard` lists the user's teams (keyed) with live projects; `/dashboard/:teamId/:slug` shows the project header + ordered phases + their commits; not-found, empty, loading, and error states all render.
- No rules-of-hooks violation (one listener set per keyed container component); commits ordered by `createdAt` (no dropped docs).
- Backend/rules/CLI untouched.
