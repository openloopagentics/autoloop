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
    <div>
      <h1>API Keys</h1>
      <p>Keys let your agents report status. Set one as <code>DALOOP_API_KEY</code> for the daloop CLI.</p>
      <KeyMintForm onMint={onMint} pending={pending} />
      {revealed && <NewKeyReveal keyValue={revealed} onDismiss={() => setRevealed(null)} />}
      {error && <ErrorNote message={error} />}
      {loading ? <Spinner /> : <KeyList keys={keys} onRevoke={onRevoke} />}
    </div>
  );
}
