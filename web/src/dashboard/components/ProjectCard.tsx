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
