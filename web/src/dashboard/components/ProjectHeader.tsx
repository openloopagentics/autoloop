import { StatusBadge } from "./StatusBadge";
import type { Project } from "../types";

export function ProjectHeader({ project }: { project: Project }) {
  return (
    <header className="proj-head">
      <div className="proj-head-top">
        <div>
          <h1 className="proj-title serif">{project.title ?? project.slug}</h1>
          <div className="proj-meta">
            <code className="chip">{project.slug}</code>
          </div>
        </div>
        {project.status && <StatusBadge status={project.status} />}
      </div>

      {project.design?.format === "url" ? (
        <a href={project.design.content} target="_blank" rel="noopener" className="doc-link card">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
          <span className="doc-link-label">Design doc</span>
          <span className="doc-link-url mono">{project.design.content}</span>
        </a>
      ) : project.design ? (
        <pre className="doc-pre mono">{project.design.content}</pre>
      ) : null}
    </header>
  );
}
