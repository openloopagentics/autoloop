import { Link } from "react-router-dom";
import { StatusBadge } from "./StatusBadge";
import type { Project } from "../types";

export function ProjectCard({ teamId, project }: { teamId: string; project: Project }) {
  const alarm = project.status === "blocked" || project.status === "failed";
  return (
    <Link to={`/dashboard/${teamId}/${project.slug}`} className={`pcard card${alarm ? " pcard--alarm" : ""}`}>
      <div className="pcard-top">
        <h3 className="pcard-title">{project.title ?? project.slug}</h3>
        {project.status && <StatusBadge status={project.status} />}
      </div>

      <div className="pcard-phase">
        <span className="pcard-phase-name">
          {project.currentPhaseId ? `phase: ${project.currentPhaseId}` : "no active phase"}
        </span>
      </div>

      <div className="pcard-foot">
        <span className="pcard-slug mono">{project.slug}</span>
      </div>
    </Link>
  );
}
