import HomeTile from "../components/HomeTile";
import useBadges from "../hooks/useBadges";

export default function Home() {
  const badges = useBadges();

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-900">Family Hub</h1>
      <p className="mt-1 text-sm text-zinc-600">Simple shared space for you and mom.</p>

      <div className="mt-4 grid gap-3">
        <HomeTile title="To-dos" subtitle="Daily checklist + recurring" to="/todos" badge={badges.todos} />
        <HomeTile title="Reminders" subtitle="Expiry-based reminders" to="/reminders" badge={badges.reminders} />
        <HomeTile title="Messages" subtitle="Chat between you two" to="/messages" badge={badges.messages} />
        <HomeTile title="People" subtitle="Notes about people you know" to="/people" badge={badges.people} />
      </div>
    </div>
  );
}
