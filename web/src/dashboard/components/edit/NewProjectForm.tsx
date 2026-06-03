import { useState } from "react";
import type { TeamRef } from "../../types";

const ID_PATTERN = /^[a-z0-9._-]+$/;

export function NewProjectForm({ teams, onCreate }: {
  teams: TeamRef[];
  onCreate: (args: { teamId: string; slug: string; title: string }) => Promise<void>;
}) {
  const [teamId, setTeamId] = useState(teams[0]?.teamId ?? "");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugValid = ID_PATTERN.test(slug.trim());
  const canSubmit = teamId.length > 0 && slugValid && title.trim().length > 0 && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onCreate({ teamId, slug: slug.trim(), title: title.trim() });
      setSlug(""); setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="edit-form" onSubmit={submit}>
      <select className="select" aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        {teams.map((t) => <option key={t.teamId} value={t.teamId}>{t.teamId}</option>)}
      </select>
      <input className="input" aria-label="Project slug" placeholder="Slug — e.g. web"
        value={slug} onChange={(e) => setSlug(e.target.value)} />
      <input className="input" aria-label="Project title" placeholder="Project title"
        value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn btn-sm" type="submit" disabled={!canSubmit}>Create project</button>
      {slug.trim() && !slugValid && <p role="alert" className="err edit-err">Slug must match a-z, 0-9, dot, dash, underscore.</p>}
      {error && <p role="alert" className="err edit-err">{error}</p>}
    </form>
  );
}
