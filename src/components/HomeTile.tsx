import { Link } from "react-router-dom";

type Tone = "blue" | "green" | "purple" | "orange";

const toneStyles: Record<Tone, string> = {
  blue: "bg-sky-50 border-sky-200",
  green: "bg-emerald-50 border-emerald-200",
  purple: "bg-violet-50 border-violet-200",
  orange: "bg-orange-50 border-orange-200",
};

export default function HomeTile({
  title,
  subtitle,
  to,
  badge,
  tone,
  icon,
}: {
  title: string;
  subtitle: string;
  to: string;
  badge?: number;
  tone: Tone;
  icon: string;
}) {
  return (
    <Link
      to={to}
      className={`relative rounded-2xl border p-5 shadow-sm active:scale-[0.99] ${toneStyles[tone]}`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none">{icon}</div>
        <div className="min-w-0">
          <div className="text-lg font-extrabold text-zinc-900">{title}</div>
          <div className="mt-1 text-base font-medium text-zinc-700">{subtitle}</div>
        </div>
      </div>

      {!!badge && badge > 0 && (
        <span className="absolute right-3 top-3 inline-flex min-w-7 items-center justify-center rounded-full bg-red-600 px-2 text-sm font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
