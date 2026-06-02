import { createContext, useContext } from "react";
import type { AccessState, AccessUser } from "./gate";

export type AuthUser = AccessUser;

export interface AuthValue {
  state: AccessState;
  user: AuthUser | null;
  isAllowed: boolean;
  isAdmin?: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  signInError: string | null;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
