import { Link } from "react-router-dom";
import { StatusBadge } from "./StatusBadge";
import type { Project } from "../types";

const TrashIcon = () => (
  <svg className="ico" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
);

export function ProjectCard({ teamId, project, status, onDelete, teamName }: {
  teamId: string; project: Project; status?: string; onDelete?: () => void;
  teamName?: string;  // small label on the tile (single-grid dashboard)
}) {
  const shown = status ?? project.status;
  const alarm = shown === "blocked" || shown === "failed";
  return (
    <div className={`pcard card${alarm ? " pcard--alarm" : ""}`}>
      <Link to={`/dashboard/${teamId}/${project.slug}`} className="pcard-link">
        <div className="pcard-top">
          <h3 className="pcard-title">{project.title ?? project.slug}</h3>
          {shown && <StatusBadge status={shown} />}
        </div>
        <div className="pcard-phase">
          <span className="pcard-phase-name">
            {project.currentPhaseId ? `phase: ${project.currentPhaseId}` : "no active phase"}
          </span>
        </div>
        <div className="pcard-foot">
          <span className="pcard-slug mono">{project.slug}</span>
          {teamName && <span className="pcard-team">{teamName}</span>}
        </div>
      </Link>
      {onDelete && (
        <button
          type="button"
          className="pcard-delete"
          title={`Delete ${project.slug}`}
          aria-label={`Delete ${project.slug}`}
          onClick={(e) => { e.preventDefault(); onDelete(); }}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}
