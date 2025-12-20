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
      } catch {
        if (!alive) return;
        setTitle("Not found");
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

  const grid = useMemo(() => {
    const first = firstOfMonth(monthAnchor);
    const total = daysInMonth(monthAnchor);

    const startDow = first.getDay();
    const cells: Array<{ ymd: string; day: number } | null> = [];

    for (let i = 0; i < startDow; i++) cells.push(null);

    for (let day = 1; day <= total; day++) {
      const dt = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), day);
      cells.push({ ymd: dateToYmd(dt), day });
    }

    while (cells.length % 7 !== 0) cells.push(null);

    return cells;
  }, [monthAnchor]);

  function statusForDay(ymd: string) {
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
      <div className="mx-auto max-w-md px-4 pb-24 pt-4">
        <div className="flex items-center justify-between">
          <button
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-bold text-zinc-100"
            onClick={() => nav(-1)}
          >
            ← Back
          </button>

          <div className="text-center">
            <div className="text-base font-extrabold text-zinc-100">{title}</div>
            <div className="mt-1 text-xs font-semibold text-zinc-400">
              {monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" })}
            </div>
          </div>

          <div className="w-[72px]" />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-bold text-zinc-100"
            onClick={() => setMonthAnchor((d) => addMonths(d, -1))}
          >
            ←
          </button>

          <button
            className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-bold text-zinc-100"
            onClick={() => setMonthAnchor(firstOfMonth(ymdToDate(todayYmd)))}
          >
            Today
          </button>

          <button
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-bold text-zinc-100"
            onClick={() => setMonthAnchor((d) => addMonths(d, 1))}
          >
            →
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-zinc-950 p-4">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-zinc-400">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-2">
            {grid.map((cell, idx) => {
              if (!cell) return <div key={idx} className="h-10" />;

              const st = statusForDay(cell.ymd);

              const ring =
                st.kind === "done"
                  ? "border-emerald-500"
                  : st.kind === "missed"
                    ? "border-red-500"
                    : "border-zinc-300";

              const text = cell.ymd === todayYmd ? "text-zinc-100" : "text-zinc-300";

              return (
                <div
                  key={cell.ymd}
                  className="flex h-10 flex-col items-center justify-center rounded-xl bg-zinc-900"
                >
                  <div className={`text-xs font-bold ${text}`}>{cell.day}</div>
                  <div className={`mt-1 h-4 w-4 rounded-full border-2 ${ring}`} />
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 text-xs font-semibold text-zinc-300">
            <div className="flex items-center gap-2">
              <span className="inline-block h-4 w-4 rounded-full border-2 border-emerald-500" />
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
    </div>
  );
}
