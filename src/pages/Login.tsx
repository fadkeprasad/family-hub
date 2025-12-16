import { useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { useNavigate } from "react-router-dom";

type Role = "prasad" | "anjali";

function normalize(x: string) {
  return x.trim().toLowerCase();
}

export default function Login() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const role = normalize(code) as Role;
    if (role !== "prasad" && role !== "anjali") {
      setErr("Wrong password");
      return;
    }

    setBusy(true);
    try {
      const cred = await signInAnonymously(auth);
      const uid = cred.user.uid;

      // Store which “role” this device chose
      await setDoc(
        doc(db, "users", uid),
        {
          role,
          displayName: role === "prasad" ? "Prasad" : "Anjali",
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true },
      );

      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Enter password</h1>
      <p className="mt-1 text-sm text-zinc-600">This app is only for you and mom.</p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <input
          className="w-full rounded-xl border px-3 py-3 text-sm"
          placeholder="Password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
        />

        {err && <div className="text-sm text-red-600">{err}</div>}

        <button
          className="rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
          disabled={busy || code.trim().length === 0}
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-4 text-xs text-zinc-500">
        Tip: use <span className="font-semibold">prasad</span> or{" "}
        <span className="font-semibold">anjali</span>
      </div>
    </div>
  );
}
