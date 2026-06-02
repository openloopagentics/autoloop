import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as fbSignOut,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase";
import { AuthContext, type AuthUser } from "./context";
import { deriveAccess } from "./gate";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authResolved, setAuthResolved] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userDocResolved, setUserDocResolved] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const unsubDoc = useRef<null | (() => void)>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      // Tear down any prior users/{uid} listener and reset doc state.
      if (unsubDoc.current) { unsubDoc.current(); unsubDoc.current = null; }
      setUserDocResolved(false);
      setIsAllowed(false);
      setAuthResolved(true);
      if (!u) { setUser(null); return; }
      setUser({ uid: u.uid, email: u.email });
      unsubDoc.current = onSnapshot(
        doc(db, "users", u.uid),
        (snap) => { setIsAllowed(snap.exists() && snap.data().isAllowed === true); setUserDocResolved(true); },
        (err) => { console.error("users doc listener:", err); setIsAllowed(false); setUserDocResolved(true); },
      );
    });
    return () => { unsubAuth(); if (unsubDoc.current) unsubDoc.current(); };
  }, []);

  const signIn = async () => {
    setSignInError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      setSignInError((e as Error).message ?? "Sign-in failed");
    }
  };

  const signOut = async () => {
    try { await fbSignOut(auth); } catch (e) { console.error("sign out:", e); }
  };

  const state = deriveAccess({ authResolved, user, userDocResolved, isAllowed });
  return (
    <AuthContext.Provider value={{ state, user, isAllowed, signIn, signOut, signInError }}>
      {children}
    </AuthContext.Provider>
  );
}
