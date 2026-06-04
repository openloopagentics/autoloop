import { useAuth } from "../auth/context";
import { LoopMark, GoogleG } from "../ui/LoopMark";

export function SignIn() {
  const { signIn, signInError } = useAuth();
  return (
    <div className="auth-stage auth-stage--signin">
      <div className="auth-rings" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-lockup">
          <LoopMark size={52} />
          <h1 className="auth-wordmark serif">autoloop</h1>
        </div>
        <p className="auth-tagline">Live status for software that builds itself —<br />watch agents ship, in a loop.</p>

        <button className="gbtn" onClick={() => void signIn()}>
          <GoogleG /><span>Sign in with Google</span>
        </button>

        {signInError && (
          <div className="err auth-err" role="alert">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12" y2="16.6" /></svg>
            {signInError}
          </div>
        )}

        <div className="auth-foot">
          <span className="sdot s-running is-live" /> agents reporting live
        </div>
      </div>
    </div>
  );
}
