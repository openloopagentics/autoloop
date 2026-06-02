import { useAuth } from "../auth/context";

export function SignIn() {
  const { signIn, signInError } = useAuth();
  return (
    <main>
      <h1>Daloop</h1>
      <button onClick={() => void signIn()}>Sign in with Google</button>
      {signInError && <p role="alert">{signInError}</p>}
    </main>
  );
}
