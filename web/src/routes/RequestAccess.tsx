import { useAuth } from "../auth/context";

export function RequestAccess() {
  const { user, signOut } = useAuth();
  return (
    <main>
      <h1>Access pending</h1>
      <p>Ask an admin to grant Daloop access to your account:</p>
      <p>Email: <code>{user?.email}</code></p>
      <p>User ID: <code>{user?.uid}</code></p>
      <button onClick={() => void signOut()}>Sign out</button>
    </main>
  );
}
