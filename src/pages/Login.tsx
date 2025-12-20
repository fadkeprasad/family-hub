import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

export default function Login() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ensureUserDoc() {
    const u = auth.currentUser;
    if (!u) return;

    await setDoc(
      doc(db, "users", u.uid),
      {
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,

        // Keep a stable role field so your existing code that reads profile.role
        // does not break. We keep it generic for multi-user.
        role: "user",

        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  useEffect(() => {
    let alive = true;

    async function run() {
      // Handle returning from redirect
      try {
        await getRedirectResult(auth);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Login failed");
        return;
      }

      if (!alive) return;

      // If user is signed in (either already or after redirect), finalize and go Home
      if (auth.currentUser) {
        setBusy(true);
        try {
          await ensureUserDoc();
          nav("/", { replace: true });
        } catch (e: any) {
          setErr(e?.message ?? "Failed to finish login");
        } finally {
          setBusy(false);
        }
      }
    }

    void run();
    return () => {
      alive = false;
    };
  }, [nav]);

  async function signInGoogle() {
    setErr(null);
    setBusy(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

      if (isMobile) {
        await signInWithRedirect(auth, provider);
        return;
      }

      await signInWithPopup(auth, provider);

      await ensureUserDoc();
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-600">Continue with Google.</p>

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

      <button
        className="mt-4 w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
        onClick={() => void signInGoogle()}
        disabled={busy}
        type="button"
      >
        {busy ? "Signing in..." : "Continue with Google"}
      </button>
    </div>
  );
}
