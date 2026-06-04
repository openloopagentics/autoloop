import { useEffect, useState } from "react";
import { mintKey, listKeys, revokeKey } from "./client";
import { KeyMintForm } from "./components/KeyMintForm";
import { NewKeyReveal } from "./components/NewKeyReveal";
import { KeyList } from "./components/KeyList";
import { Spinner } from "../dashboard/components/Spinner";
import { ErrorNote } from "../dashboard/components/ErrorNote";
import type { KeyMeta } from "./types";

export function KeysPage() {
  const [keys, setKeys] = useState<KeyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setKeys(await listKeys()); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  async function onMint(label: string) {
    setPending(true);
    try { const k = await mintKey(label); setRevealed(k.key); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  async function onRevoke(id: string) {
    try { await revokeKey(id); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="main main--narrow">
      <div className="page-head">
        <h1 className="page-title">API keys</h1>
        <p className="page-sub">
          Mint keys for the <code className="chip">autoloop</code> CLI. Set one as{" "}
          <code className="chip">AUTOLOOP_API_KEY</code> so your agents can report status.
        </p>
      </div>

      <section className="mblock">
        <h2 className="mblock-title">Mint a key</h2>
        <KeyMintForm onMint={onMint} pending={pending} />
      </section>

      {revealed && <NewKeyReveal keyValue={revealed} onDismiss={() => setRevealed(null)} />}
      {error && <ErrorNote message={error} />}

      <section className="mblock">
        <h2 className="mblock-title">Your keys{!loading && <span className="dim tnum" style={{ fontWeight: 400 }}>{keys.length}</span>}</h2>
        {loading ? <Spinner /> : <KeyList keys={keys} onRevoke={onRevoke} />}
      </section>
    </div>
  );
}
