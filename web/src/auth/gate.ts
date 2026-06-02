export type AccessState = "loading" | "signed-out" | "pending" | "allowed";

export interface AccessUser {
  uid: string;
  email: string | null;
}

export interface AccessInputs {
  authResolved: boolean;
  user: AccessUser | null;
  userDocResolved: boolean;
  isAllowed: boolean;
}

export function deriveAccess(i: AccessInputs): AccessState {
  if (!i.authResolved) return "loading";
  if (!i.user) return "signed-out";
  if (!i.userDocResolved) return "loading"; // flash-prevention: don't show "pending" before the doc loads
  return i.isAllowed ? "allowed" : "pending";
}
