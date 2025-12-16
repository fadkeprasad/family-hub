import { Link, useLocation } from "react-router-dom";
import useBadges from "../hooks/useBadges";

function Tab({
  to,
  label,
  active,
  badge,
}: {
  to: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className={`relative flex-1 py-4 text-center text-base font-bold ${
        active ? "text-violet-700" : "text-zinc-500"
      }`}
    >
      {label}
      {!!badge && badge > 0 && (
        <span className="absolute right-3 top-2 inline-flex min-w-7 items-center justify-center rounded-full bg-red-600 px-2 text-sm font-extrabold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

export default function BottomTabs() {
  const { pathname } = useLocation();
  const badges = useBadges();

  return (
    <nav className="fixed bottom-0 left-0 right-0 mx-auto max-w-md border-t bg-white">
      <div className="flex">
        <Tab to="/" label="Home" active={pathname === "/"} />
        <Tab to="/todos" label="To-dos" active={pathname.startsWith("/todos")} badge={badges.todos} />
        <Tab
          to="/reminders"
          label="Reminders"
          active={pathname.startsWith("/reminders")}
          badge={badges.reminders}
        />
        <Tab
          to="/messages"
          label="Messages"
          active={pathname.startsWith("/messages")}
          badge={badges.messages}
        />
        <Tab to="/people" label="People" active={pathname.startsWith("/people")} badge={badges.people} />
      </div>
    </nav>
  );
}
