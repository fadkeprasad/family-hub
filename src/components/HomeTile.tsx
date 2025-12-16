import { Link } from "react-router-dom";

export default function HomeTile({
  title,
  subtitle,
  to,
  badge,
}: {
  title: string;
  subtitle: string;
  to: string;
  badge?: number;
}) {
  return (
    <Link to={to} className="relative rounded-2xl border p-4 shadow-sm active:scale-[0.99]">
      <div className="text-base font-semibold text-zinc-900">{title}</div>
      <div className="mt-1 text-sm text-zinc-600">{subtitle}</div>

      {!!badge && badge > 0 && (
        <span className="absolute right-3 top-3 inline-flex min-w-6 items-center justify-center rounded-full bg-zinc-900 px-2 text-xs text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
