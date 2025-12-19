import { Link, useLocation } from "react-router-dom";
import useBadges from "../hooks/useBadges";

function Tab({
  to,
  label,
  icon,
  active,
  badge,
}: {
  to: string;
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className="relative flex flex-1 flex-col items-center justify-center gap-1 py-3"
      aria-current={active ? "page" : undefined}
    >
      <div className={`text-2xl leading-none ${active ? "opacity-100" : "opacity-60"}`}>{icon}</div>
      <div className={`text-sm font-extrabold ${active ? "text-zinc-50" : "text-zinc-400"}`}>{label}</div>

      {!!badge && badge > 0 && (
        <span className="absolute right-3 top-2 inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-extrabold text-white">
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 shadow-xl backdrop-blur">
        <div className="flex">
          <Tab to="/" label="Home" icon="🏠" active={pathname === "/"} />
          <Tab
            to="/todos"
            label="To-dos"
            icon="✅"
            active={pathname.startsWith("/todos")}
            badge={badges.todos}
          />
          <Tab
            to="/reminders"
            label="Reminders"
            icon="⏰"
            active={pathname.startsWith("/reminders")}
            badge={badges.reminders}
          />
          <Tab
            to="/journal"
            label="Journal"
            icon="📝"
            active={pathname.startsWith("/journal")}
            badge={badges.journal}
          />
        </div>
      </div>
    </nav>
  );
}
