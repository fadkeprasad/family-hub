import HomeTile from "../components/HomeTile";
import useBadges from "../hooks/useBadges";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

export default function Home() {
  const badges = useBadges();

  async function resetLogin() {
    await signOut(auth);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-50">Family Hub</h1>
          <p className="mt-1 text-base font-semibold text-zinc-300">
            Today’s focus, reminders, and journaling.
          </p>
        </div>

        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60 text-3xl shadow-sm">
          🧞
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <HomeTile title="To-dos" subtitle="Checklist + recurring" to="/todos" badge={badges.todos} tone="green" icon="✅" />
        <HomeTile title="Reminders" subtitle="Expiry-based reminders" to="/reminders" badge={badges.reminders} tone="orange" icon="⏰" />
        <HomeTile title="Daily Journal" subtitle="Write for today" to="/journal" badge={badges.journal} tone="blue" icon="📝" />
      </div>

      <button
        className="mt-5 w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 py-4 text-base font-extrabold text-zinc-200"
        onClick={resetLogin}
      >
        Logout
      </button>
    </div>
  );
}
