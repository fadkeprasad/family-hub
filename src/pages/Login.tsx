import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Login</h1>
      <p className="mt-1 text-sm text-zinc-600">Only you and mom can access this.</p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <input
          className="w-full rounded-xl border px-3 py-3 text-sm"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          inputMode="email"
          autoComplete="email"
          required
        />
        <input
          className="w-full rounded-xl border px-3 py-3 text-sm"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          type="password"
          autoComplete="current-password"
          required
        />
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button
          className="rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
          disabled={busy}
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
