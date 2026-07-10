import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMyTeams, useTeam, useTeamProjects } from "./hooks";
import { TeamSection } from "./components/TeamSection";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import { NewProjectForm } from "./components/edit/NewProjectForm";
import { putProject, deleteProject } from "./api";
import type { TeamRef } from "./types";

function TeamSectionContainer({ teamRef, onDeleteProject }: {
  teamRef: TeamRef;
  onDeleteProject?: (slug: string) => void;
}) {
  const team = useTeam(teamRef.teamId);
  const projects = useTeamProjects(teamRef.teamId);
  return (
    <TeamSection
      teamId={teamRef.teamId}
      team={team.data ?? {}}
      projects={projects.data}
      loading={team.loading || projects.loading}
      error={team.error ?? projects.error}
      onDeleteProject={onDeleteProject}
    />
  );
}

export function DashboardHome() {
  const { data: teams, loading, error } = useMyTeams();
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);

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
        <span className="live-pill"><span className="sdot s-running is-live" /> live</span>
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
        : teams.map((t) => {
            const canDelete = t.role === "owner" || t.role === "admin";
            async function handleDelete(slug: string) {
              if (!window.confirm(`Delete project "${slug}"? This cannot be undone.`)) return;
              try { await deleteProject(t.teamId, slug); } catch (e) { alert((e as Error).message); }
            }
            return (
              <TeamSectionContainer
                key={t.teamId}
                teamRef={t}
                onDeleteProject={canDelete ? handleDelete : undefined}
              />
            );
          })}
    </div>
  );
}
