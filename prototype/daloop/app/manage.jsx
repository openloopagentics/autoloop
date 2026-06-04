/* manage.jsx — Teams, API Keys, Admin. Interactive with local state. */

const RANK = { owner: 3, admin: 2, member: 1 };

// ============================ TEAMS ============================
function MemberRow({ member, myRole, isMe, onRole, onRemove }) {
  const iManage = RANK[myRole] >= RANK.admin;
  const canActOnTarget = iManage && !isMe && RANK[myRole] > RANK[member.role] && member.role !== "owner";
  return (
    <div className="member">
      <img className="member-avatar" src="app/avatar.png" alt="" style={{ filter: "grayscale(40%)" }} />
      <div className="member-id">
        <span className="member-name">{member.name}{isMe && <span className="you-tag">you</span>}</span>
        <span className="member-email">{member.email}</span>
      </div>
      {canActOnTarget ? (
        <select className="select select-sm" value={member.role} onChange={e => onRole(member.uid, e.target.value)}>
          {["admin", "member"].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      ) : (
        <span className={"role" + (member.role === "owner" ? " owner" : "")}>{member.role}</span>
      )}
      {canActOnTarget
        ? <button className="icon-btn danger" title="Remove" onClick={() => onRemove(member.uid)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        : <span className="icon-btn-spacer"></span>}
    </div>
  );
}

function TeamCard({ team, onChange }) {
  const iManage = RANK[team.myRole] >= RANK.admin;
  const [invEmail, setInvEmail] = React.useState("");
  const [invRole, setInvRole] = React.useState("member");

  const setRole = (uid, role) => onChange({ ...team, members: team.members.map(m => m.uid === uid ? { ...m, role } : m) });
  const remove = (uid) => onChange({ ...team, members: team.members.filter(m => m.uid !== uid) });
  const invite = () => {
    if (!invEmail.trim()) return;
    onChange({ ...team, sentInvites: [...team.sentInvites, { id: "iv_" + Date.now(), email: invEmail.trim(), role: invRole, sentAt: new Date() }] });
    setInvEmail("");
  };
  const revoke = (id) => onChange({ ...team, sentInvites: team.sentInvites.filter(i => i.id !== id) });

  return (
    <div className="teamcard card">
      <div className="teamcard-head">
        <h3 className="teamcard-name serif">{team.name}</h3>
        <span className="team-meta">
          <span className={"role" + (team.myRole === "owner" ? " owner" : "")}>{team.myRole}</span>
          <span className="dim">· {team.members.length} member{team.members.length !== 1 ? "s" : ""}</span>
        </span>
      </div>
      <div className="members">
        {team.members.slice().sort((a, b) => RANK[b.role] - RANK[a.role]).map(m => (
          <MemberRow key={m.uid} member={m} myRole={team.myRole} isMe={m.uid === SEED.ME.uid} onRole={setRole} onRemove={remove} />
        ))}
      </div>

      {iManage && (
        <div className="teamcard-manage">
          <div className="invite-form">
            <input className="input" placeholder="teammate@email.com" value={invEmail} onChange={e => setInvEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && invite()} />
            <select className="select" value={invRole} onChange={e => setInvRole(e.target.value)} style={{ width: 110 }}>
              <option value="member">member</option><option value="admin">admin</option>
            </select>
            <button className="btn btn-sm" onClick={invite}>Invite</button>
          </div>
          {team.sentInvites.length > 0 && (
            <div className="sent-invites">
              {team.sentInvites.map(iv => (
                <div key={iv.id} className="sent-invite">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--fg-meta)" }}><path d="M4 4h16v16H4z" opacity="0"/><path d="M2 6l10 7L22 6"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>
                  <span className="sent-email">{iv.email}</span>
                  <span className="role">{iv.role}</span>
                  <span className="dim sent-pending">invite sent</span>
                  <button className="btn-link-danger" onClick={() => revoke(iv.id)}>Revoke</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamsScreen() {
  const [teams, setTeams] = React.useState(() => JSON.parse(JSON.stringify(SEED.teams)));
  const [invites, setInvites] = React.useState(SEED.myInvites);
  const [newName, setNewName] = React.useState("");

  const create = () => {
    if (!newName.trim()) return;
    setTeams(ts => [{ id: "t_" + Date.now(), name: newName.trim(), myRole: "owner",
      members: [{ ...SEED.ME, role: "owner" }], sentInvites: [] }, ...ts]);
    setNewName("");
  };
  const updateTeam = (t) => setTeams(ts => ts.map(x => x.id === t.id ? t : x));
  const accept = (inv) => {
    setTeams(ts => [...ts, { id: "t_" + Date.now(), name: inv.teamName, myRole: inv.role,
      members: [{ ...SEED.ME, role: inv.role }], sentInvites: [] }]);
    setInvites(iv => iv.filter(i => i.id !== inv.id));
  };
  const decline = (inv) => setInvites(iv => iv.filter(i => i.id !== inv.id));

  return (
    <div className="main main--narrow">
      <div className="page-head"><h1 className="page-title">Teams</h1><p className="page-sub">Create teams, manage members, and handle invites.</p></div>

      <section className="mblock">
        <h2 className="mblock-title">Create a team</h2>
        <div className="invite-form">
          <input className="input" placeholder="Team name" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} />
          <button className="btn btn-sm" onClick={create} disabled={!newName.trim()}>Create</button>
        </div>
      </section>

      <section className="mblock">
        <h2 className="mblock-title">Pending invites for you <span className="col-count tnum">{invites.length}</span></h2>
        {invites.length ? (
          <div className="invite-list">
            {invites.map(inv => (
              <div key={inv.id} className="invite-card card">
                <div className="invite-body">
                  <span className="invite-team">{inv.teamName}</span>
                  <span className="invite-from">from {inv.fromEmail} · as <span className="role">{inv.role}</span></span>
                </div>
                <div className="invite-actions">
                  <button className="btn btn-sm" onClick={() => accept(inv)}>Accept</button>
                  <button className="btn-ghost btn btn-sm" onClick={() => decline(inv)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="empty">No pending invites.</div>}
      </section>

      <section className="mblock">
        <h2 className="mblock-title">Your teams</h2>
        <div className="teamcards">
          {teams.map(t => <TeamCard key={t.id} team={t} onChange={updateTeam} />)}
        </div>
      </section>
    </div>
  );
}

// ============================ API KEYS ============================
function genKey() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < 32; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return "dlp_live_" + s;
}

function KeysScreen() {
  const [keys, setKeys] = React.useState(() => SEED.apiKeys.map(k => ({ ...k })));
  const [label, setLabel] = React.useState("");
  const [reveal, setReveal] = React.useState(null);
  const [copied, copy] = useCopy();

  const mint = () => {
    if (!label.trim()) return;
    const full = genKey();
    const k = { id: "k_" + Date.now(), label: label.trim(), prefix: full.slice(0, 12), createdAt: new Date(), lastUsedAt: null };
    setKeys(ks => [k, ...ks]); setReveal({ ...k, full }); setLabel("");
  };
  const revoke = (id) => { if (confirm("Revoke this key? Agents using it will stop reporting.")) setKeys(ks => ks.filter(k => k.id !== id)); };

  return (
    <div className="main main--narrow">
      <div className="page-head"><h1 className="page-title">API keys</h1>
        <p className="page-sub">Mint keys for the <code className="chip">daloop</code> CLI. Set one as <code className="chip">DALOOP_API_KEY</code> so your agents can report status.</p></div>

      <section className="mblock">
        <h2 className="mblock-title">Mint a key</h2>
        <div className="invite-form">
          <input className="input" placeholder="Label — e.g. atlas-ci" value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && mint()} />
          <button className="btn btn-sm" onClick={mint} disabled={!label.trim()}>Create key</button>
        </div>
      </section>

      {reveal && (
        <div className="reveal card fade-up" role="alert">
          <div className="reveal-head">
            <span className="eyebrow" style={{ color: "var(--brand)" }}>New key · {reveal.label}</span>
            <button className="icon-btn" onClick={() => setReveal(null)} title="Dismiss">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
          </div>
          <p className="reveal-warn">Copy it now — you won't be able to see this key again.</p>
          <div className="reveal-key">
            <code className="reveal-val mono">{reveal.full}</code>
            <button className="btn btn-sm" onClick={() => copy(reveal.full, "rev")}>{copied === "rev" ? "Copied" : "Copy"}</button>
          </div>
        </div>
      )}

      <section className="mblock">
        <h2 className="mblock-title">Your keys <span className="col-count tnum">{keys.length}</span></h2>
        {keys.length ? (
          <div className="keylist card">
            {keys.map(k => (
              <div key={k.id} className="keyrow">
                <div className="keyrow-main">
                  <span className="keyrow-label">{k.label}</span>
                  <code className="keyrow-prefix mono">{k.prefix}••••••••</code>
                </div>
                <div className="keyrow-meta">
                  <span className="dim">created {fmtDate(k.createdAt)}</span>
                  <span className="dim">·</span>
                  <span className="dim">{k.lastUsedAt ? "last used " + timeAgo(k.lastUsedAt) : "never used"}</span>
                </div>
                <button className="btn-link-danger" onClick={() => revoke(k.id)}>Revoke</button>
              </div>
            ))}
          </div>
        ) : <div className="empty">No keys yet.</div>}
      </section>
    </div>
  );
}

// ============================ ADMIN ============================
function AdminScreen() {
  const [users, setUsers] = React.useState(() => SEED.allowlist.map(u => ({ ...u })));
  const [uid, setUid] = React.useState("");
  const [email, setEmail] = React.useState("");

  const grant = () => {
    if (!uid.trim() || !email.trim()) return;
    setUsers(us => {
      const existing = us.find(u => u.uid === uid.trim());
      if (existing) return us.map(u => u.uid === uid.trim() ? { ...u, allowed: true } : u);
      return [{ uid: uid.trim(), email: email.trim(), name: email.trim().split("@")[0], allowed: true, admin: false }, ...us];
    });
    setUid(""); setEmail("");
  };
  const toggle = (u) => setUsers(us => us.map(x => x.uid === u.uid ? { ...x, allowed: !x.allowed } : x));

  const allowedCount = users.filter(u => u.allowed).length;

  return (
    <div className="main main--narrow">
      <div className="page-head"><h1 className="page-title">Admin</h1><p className="page-sub">Manage the global access allowlist. {allowedCount} of {users.length} users allowed.</p></div>

      <section className="mblock">
        <h2 className="mblock-title">Grant access by UID</h2>
        <p className="mblock-hint">For people who haven't signed in yet — use the User ID from their Request Access screen.</p>
        <div className="grant-form">
          <input className="input" placeholder="User ID" value={uid} onChange={e => setUid(e.target.value)} />
          <input className="input" placeholder="email@domain.com" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn btn-sm" onClick={grant} disabled={!uid.trim() || !email.trim()}>Grant</button>
        </div>
      </section>

      <section className="mblock">
        <h2 className="mblock-title">All users <span className="col-count tnum">{users.length}</span></h2>
        <div className="userlist card">
          {users.map(u => (
            <div key={u.uid} className="userrow">
              <div className="userrow-id">
                <span className="userrow-email">{u.email}{u.admin && <span className="admin-badge">admin</span>}</span>
                <code className="userrow-uid mono">{u.uid}</code>
              </div>
              <span className={"allow-state " + (u.allowed ? "yes" : "no")}>
                <span className="sdot" style={{ background: u.allowed ? "var(--st-completed)" : "var(--st-cancelled)" }}></span>
                {u.allowed ? "allowed" : "not allowed"}
              </span>
              <button className={u.allowed ? "btn-link-danger" : "btn btn-sm"} onClick={() => toggle(u)}>
                {u.allowed ? "Revoke" : "Allow"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { TeamsScreen, KeysScreen, AdminScreen });
