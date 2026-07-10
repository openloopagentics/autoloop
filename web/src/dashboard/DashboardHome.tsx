import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMyTeams } from "./hooks";
import { TeamTiles, type ProjectFilter } from "./components/TeamTiles";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import { NewProjectForm } from "./components/edit/NewProjectForm";
import { putProject, deleteProject } from "./api";

type Counts = { visible: number; total: number };

/** The single note under the grid: empty / all-filtered / partly-filtered. Pure. */
export function GridNote({ counts, teamCount, filter, onShowAll }: {
  counts: Record<string, Counts>; teamCount: number; filter: ProjectFilter; onShowAll: () => void;
}) {
  // Only speak once every team has reported, so we never flash "no projects".
  if (Object.keys(counts).length < teamCount) return null;
  const all = Object.values(counts);
  const total = all.reduce((n, c) => n + c.total, 0);
  const visible = all.reduce((n, c) => n + c.visible, 0);
  const hidden = total - visible;
  if (total === 0) return <EmptyState message="No projects yet" />;
  if (hidden === 0) return null;
  const showAll = <button type="button" className="btn-link" onClick={onShowAll}>Show all</button>;
  return (
    <p className="team-filter-note dim">
      {visible === 0 ? <>No running projects · {hidden} hidden {showAll}</> : <>{hidden} hidden {showAll}</>}
    </p>
  );
}

export function DashboardHome() {
  const { data: teams, loading, error } = useMyTeams();
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  // Quick glance at what's running; the full list is one tap away. Defaults to running.
  const [filter, setFilter] = useState<ProjectFilter>("running");
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const onCounts = useCallback((teamId: string, c: Counts) => {
    setCounts((prev) => (prev[teamId]?.visible === c.visible && prev[teamId]?.total === c.total
      ? prev : { ...prev, [teamId]: c }));
  }, []);

  async function createProject({ teamId, slug, title }: { teamId: string; slug: string; title: string }) {
    await putProject(teamId, slug, { title });
    setShowNew(false);
    navigate(`/dashboard/${teamId}/${slug}`);
  }

  return (
    <div className="main">
      <div className="page-head dash-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Live status, streaming from your agents.</p>
        </div>
        <div className="dash-head-right">
          <div className="filterseg" role="tablist" aria-label="Project filter">
            {(["running", "all"] as const).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f}
                className={`filterseg-btn${filter === f ? " is-active" : ""}`} onClick={() => setFilter(f)}>
                {f === "running" ? "Running" : "All"}
              </button>
            ))}
          </div>
          <span className="live-pill"><span className="sdot s-running is-live" /> live</span>
        </div>
      </div>

      {teams.length > 0 && (
        <div className="dash-newproj">
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => setShowNew((v) => !v)}>+ New project</button>
          {showNew && <NewProjectForm teams={teams} onCreate={createProject} />}
        </div>
      )}

      {loading ? <Spinner />
        : error ? <ErrorNote message={error} />
        : teams.length === 0 ? <EmptyState message="You're not on a team yet." />
        : <>
            <div className="pgrid">
              {teams.map((t) => {
                const canDelete = t.role === "owner" || t.role === "admin";
                async function handleDelete(slug: string) {
                  if (!window.confirm(`Delete project "${slug}"? This cannot be undone.`)) return;
                  try { await deleteProject(t.teamId, slug); } catch (e) { alert((e as Error).message); }
                }
                return (
                  <TeamTiles
                    key={t.teamId}
                    teamRef={t}
                    filter={filter}
                    onCounts={onCounts}
                    onDeleteProject={canDelete ? handleDelete : undefined}
                  />
                );
              })}
            </div>
            <GridNote counts={counts} teamCount={teams.length} filter={filter} onShowAll={() => setFilter("all")} />
          </>}
    </div>
  );
}
