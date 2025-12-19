import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { ymdToday } from "../lib/dateUtil";
import type { SeriesEnd, SeriesPattern, TodoSeries } from "../lib/recurrence";
import { occursOn } from "../lib/recurrence";

type OneTodo = {
  id: string;
  title: string;
  dueDate: string;
  completed?: boolean;
};

function legacyDoneFromMap(m?: Record<string, boolean>) {
  if (!m) return false;
  return Object.values(m).some(Boolean);
}

function ymdToDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function dateToYmd(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function firstOfMonth(dt: Date) {
  return new Date(dt.getFullYear(), dt.getMonth(), 1);
}

function addMonths(dt: Date, delta: number) {
  return new Date(dt.getFullYear(), dt.getMonth() + delta, 1);
}

function daysInMonth(dt: Date) {
  return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
}

export default function TodoCalendar() {
  const nav = useNavigate();
  const params = useParams();
  const kind = (params.kind ?? "one") as "one" | "series";
  const id = params.id ?? "";

  const todayYmd = ymdToday();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Calendar");

  const [oneTodo, setOneTodo] = useState<OneTodo | null>(null);
  const [series, setSeries] = useState<TodoSeries | null>(null);

  const [monthAnchor, setMonthAnchor] = useState<Date>(() => firstOfMonth(ymdToDate(todayYmd)));

  // For series only: date -> completed
  const [completedByDate, setCompletedByDate] = useState<Record<string, boolean>>({});

  // Load the task
  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setCompletedByDate({});
      setOneTodo(null);
      setSeries(null);

      try {
        if (!id) return;

        if (kind === "series") {
          const snap = await getDoc(doc(db, "todoSeries", id));
          if (!alive) return;

          if (!snap.exists()) {
            setTitle("Not found");
            return;
          }

          const data = snap.data() as any;
          const s: TodoSeries = {
            id: snap.id,
            title: String(data.title ?? ""),
            startDate: String(data.startDate ?? "1970-01-01"),
            end: (data.end as SeriesEnd) ?? { type: "never" },
            pattern: (data.pattern as SeriesPattern) ?? { type: "daily", interval: 1 },
            active: data.active !== false,
          };

          setSeries(s);
          setTitle(s.title || "Recurring task");
          setMonthAnchor(firstOfMonth(ymdToDate(todayYmd)));
        } else {
          const snap = await getDoc(doc(db, "todos", id));
          if (!alive) return;

          if (!snap.exists()) {
            setTitle("Not found");
            return;
          }

          const data = snap.data() as any;
          const t: OneTodo = {
            id: snap.id,
            title: String(data.title ?? ""),
            dueDate: String(data.dueDate ?? "1970-01-01"),
            completed: typeof data.completed === "boolean" ? data.completed : false,
          };

          setOneTodo(t);
          setTitle(t.title || "One-time task");
          setMonthAnchor(firstOfMonth(ymdToDate(t.dueDate)));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    void run();
    return () => {
      alive = false;
    };
  }, [kind, id, todayYmd]);

  // Load completions for the month (series only)
  // IMPORTANT: read by doc id (seriesId_date) so we don't miss docs that don't have "date" or "completed" fields.
  useEffect(() => {
    let alive = true;

    async function run() {
      if (kind !== "series") return;
      if (!id) return;
      if (!series) return;

      const total = daysInMonth(monthAnchor);

      const reads = Array.from({ length: total }, (_, i) => i + 1).map(async (dayNum) => {
        const dt = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), dayNum);
        const ymd = dateToYmd(dt);

        const completionId = `${id}_${ymd}`;
        const snap = await getDoc(doc(db, "todoSeriesCompletions", completionId));

        if (!snap.exists()) return [ymd, false] as const;

        const data = snap.data() as any;
        const done =
          typeof data?.completed === "boolean"
            ? !!data.completed
            : legacyDoneFromMap(data?.completedBy);

        return [ymd, done] as const;
      });

      const pairs = await Promise.all(reads);
      if (!alive) return;

      const map: Record<string, boolean> = {};
      for (const [ymd, done] of pairs) map[ymd] = done;

      setCompletedByDate(map);
    }

    void run();
    return () => {
      alive = false;
    };
  }, [kind, id, series, monthAnchor]);

  const today = useMemo(() => ymdToDate(todayYmd), [todayYmd]);
  const startOfThisMonth = useMemo(() => firstOfMonth(monthAnchor), [monthAnchor]);
  const dim = useMemo(() => daysInMonth(monthAnchor), [monthAnchor]);
  const monthLabel = useMemo(
    () =>
      startOfThisMonth.toLocaleString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [startOfThisMonth],
  );

  const firstDow = startOfThisMonth.getDay();
  const cells = useMemo(() => {
    const out: Array<{ day: number | null; ymd: string | null }> = [];
    for (let i = 0; i < firstDow; i++) out.push({ day: null, ymd: null });
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), d);
      out.push({ day: d, ymd: dateToYmd(dt) });
    }
    return out;
  }, [firstDow, dim, monthAnchor]);

  function statusForDay(ymd: string) {
    const dt = ymdToDate(ymd);
    const isFuture = dt.getTime() > today.getTime();

    if (isFuture) return { kind: "future" as const };

    if (kind === "one") {
      if (!oneTodo) return { kind: "none" as const };
      if (ymd !== oneTodo.dueDate) return { kind: "none" as const };
      return oneTodo.completed ? { kind: "done" as const } : { kind: "missed" as const };
    }

    if (!series) return { kind: "none" as const };
    const occurs = occursOn(series, ymd);
    if (!occurs) return { kind: "none" as const };

    const done = completedByDate[ymd] === true;
    return done ? { kind: "done" as const } : { kind: "missed" as const };
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-zinc-500">Calendar</div>
          <h1 className="text-2xl font-extrabold text-zinc-900">{title}</h1>
        </div>
        <button
          className="rounded-xl border px-3 py-2 text-base font-extrabold text-zinc-900"
          onClick={() => nav("/todos")}
        >
          Back
        </button>
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between">
          <button
            className="rounded-xl border px-3 py-2 text-base font-extrabold"
            onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
            aria-label="Previous month"
          >
            ‹
          </button>

          <div className="text-lg font-extrabold text-zinc-900">{monthLabel}</div>

          <button
            className="rounded-xl border px-3 py-2 text-base font-extrabold"
            onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-2 text-center text-sm font-extrabold text-zinc-500">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-2">
          {cells.map((c, idx) => {
            if (!c.day || !c.ymd) return <div key={idx} className="h-12" />;

            const s = statusForDay(c.ymd);
            const isToday = c.ymd === todayYmd;

            const base =
              "h-12 w-full rounded-2xl flex items-center justify-center text-base font-extrabold select-none";

            let cls = `${base} border border-zinc-200 text-zinc-900 bg-white`;

            if (s.kind === "none") cls = `${base} border-2 border-zinc-300 text-zinc-900 bg-white`;
            if (s.kind === "missed") cls = `${base} border-2 border-red-500 text-zinc-900 bg-white`;
            if (s.kind === "done") cls = `${base} border-2 border-emerald-600 bg-emerald-600 text-white`;
            if (s.kind === "future") cls = `${base} border border-zinc-200 text-zinc-400 bg-zinc-50`;

            if (isToday) cls += " ring-2 ring-violet-400";

            return (
              <div key={idx} className={cls}>
                {c.day}
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid gap-2 text-sm font-bold text-zinc-700">
          <div className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full bg-emerald-600" />
            Completed
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-red-500" />
            Not completed
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-zinc-300" />
            Not a to-do day
          </div>
        </div>

        {loading && <div className="mt-3 text-sm font-bold text-zinc-500">Loading…</div>}
      </div>
    </div>
  );
}
