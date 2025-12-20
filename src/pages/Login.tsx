import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
} from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../lib/firebase";

export default function Login() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getRedirectResult(auth).catch((e: any) => {
      if (e) setErr(e?.message ?? "Login failed");
    });
  }, []);

  async function signInGoogle() {
  setErr(null);
  setBusy(true);
  try {
    const provider = new GoogleAuthProvider();

    // Popup is more reliable across modern browsers now, and avoids redirect state issues.
    await signInWithPopup(auth, provider);

    nav("/", { replace: true });
  } catch (e: any) {
    const msg = e?.message ?? "Login failed";

    // Helpful hint for common iOS failures
    const extra =
      /popup|blocked|cancelled|closed/i.test(msg)
        ? " If you are on iPhone, open this site in Safari (not inside another app) and allow popups."
        : "";

    setErr(msg + extra);
  } finally {
    setBusy(false);
  }
}

  return (
    <div className="px-4 pb-24 pt-4">
      <h1 className="text-3xl font-extrabold tracking-tight text-zinc-50">Sign in</h1>
      <p className="mt-2 text-base font-semibold text-zinc-300">Continue with Google.</p>

      {err && (
        <div className="mt-4 rounded-2xl border border-red-900/40 bg-red-950/40 p-3 text-sm font-semibold text-red-200">
          {err}
        </div>
      )}

      <button
        className="mt-6 w-full rounded-2xl bg-zinc-100 py-4 text-base font-extrabold text-zinc-900 disabled:opacity-60"
        onClick={() => void signInGoogle()}
        disabled={busy}
      >
        {busy ? "Signing in…" : "Continue with Google"}
      </button>
    </div>
  );
}
