/* auth.jsx — Loading, SignIn, RequestAccess (the three pre-app states). */

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" style={{ display: "block" }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function LoadingScreen() {
  return (
    <div className="auth-stage" data-screen-label="Loading">
      <div className="auth-loading">
        <LoopMark size={40} />
        <span className="auth-loading-text">Connecting to the live board…</span>
      </div>
    </div>
  );
}

function SignInScreen({ onSignIn, error }) {
  return (
    <div className="auth-stage auth-stage--signin" data-screen-label="Sign in">
      <div className="auth-rings" aria-hidden="true"></div>
      <div className="auth-card">
        <div className="auth-lockup">
          <LoopMark size={52} />
          <h1 className="auth-wordmark serif">daloop</h1>
        </div>
        <p className="auth-tagline">Live status for software that builds itself —<br/>watch agents ship, in a loop.</p>

        <button className="gbtn" onClick={onSignIn}>
          <GoogleG /><span>Sign in with Google</span>
        </button>

        {error && <div className="err auth-err" role="alert">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.6"/></svg>
          {error}
        </div>}

        <div className="auth-foot">
          <span className="sdot s-running is-live"></span> 142 agents reporting now
        </div>
      </div>
    </div>
  );
}

function RequestAccessScreen({ user, onSignOut }) {
  const [copied, copy] = useCopy();
  const Row = ({ label, value, k }) => (
    <div className="copyrow">
      <span className="copyrow-label">{label}</span>
      <code className="copyrow-val mono">{value}</code>
      <button className="copyrow-btn" onClick={() => copy(value, k)}>
        {copied === k
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5 10 18 20 6"/></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>}
      </button>
    </div>
  );
  return (
    <div className="auth-stage" data-screen-label="Request access">
      <div className="auth-card auth-card--access card">
        <div className="auth-lockup auth-lockup--sm">
          <LoopMark size={30} />
          <span className="wordmark serif" style={{ fontSize: 18 }}>daloop</span>
        </div>
        <span className="eyebrow" style={{ marginTop: 6 }}>Access pending</span>
        <h2 className="access-title serif">You're in the waiting room</h2>
        <p className="access-body">
          Your account isn't on the allowlist yet. Ask a Daloop admin to grant you access —
          they'll need your <strong>User ID</strong> below.
        </p>
        <div className="copyrows">
          <Row label="Email" value={user.email} k="email" />
          <Row label="User ID" value={user.uid} k="uid" />
        </div>
        <p className="access-note">This screen will update automatically once you're approved.</p>
        <button className="btn-ghost btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

Object.assign(window, { LoadingScreen, SignInScreen, RequestAccessScreen });
