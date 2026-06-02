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
