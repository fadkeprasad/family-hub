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
      className={`relative flex-1 py-3 text-center text-sm ${
        active ? "font-semibold text-zinc-900" : "text-zinc-500"
      }`}
    >
      {label}
      {!!badge && badge > 0 && (
        <span className="absolute right-5 top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-xs text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

export default function BottomTabs() {
  const { pathname } = useLocation();
  const badges = useBadges(); // static now, real later

  return (
    <nav className="fixed bottom-0 left-0 right-0 mx-auto max-w-md border-t bg-white">
      <div className="flex">
        <Tab to="/" label="Home" active={pathname === "/"} />
        <Tab to="/todos" label="To-dos" active={pathname.startsWith("/todos")} badge={badges.todos} />
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
