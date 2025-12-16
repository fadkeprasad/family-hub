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
      <h1 className="text-2xl font-extrabold text-zinc-900">Family Hub</h1>
      <p className="mt-1 text-base font-medium text-zinc-700">
        To-dos, reminders, messages, and people notes.
      </p>

      <div className="mt-5 grid gap-4">
        <HomeTile
          title="To-dos"
          subtitle="Daily checklist + recurring"
          to="/todos"
          badge={badges.todos}
          tone="green"
          icon="✅"
        />
        <HomeTile
          title="Reminders"
          subtitle="Expiry-based reminders"
          to="/reminders"
          badge={badges.reminders}
          tone="orange"
          icon="⏰"
        />
        <HomeTile
          title="Messages"
          subtitle="Chat between you two"
          to="/messages"
          badge={badges.messages}
          tone="blue"
          icon="💬"
        />
        <HomeTile
          title="People"
          subtitle="Notes about people you know"
          to="/people"
          badge={badges.people}
          tone="purple"
          icon="👥"
        />
      </div>

      <button
        className="mt-5 w-full rounded-xl border py-4 text-base font-bold text-zinc-900"
        onClick={resetLogin}
      >
        Reset login
      </button>
    </div>
  );
}
