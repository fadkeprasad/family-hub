import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { ymdToday } from "../lib/dateUtil";
import type { SeriesEnd, SeriesPattern, TodoSeries } from "../lib/recurrence";
import { occursOn } from "../lib/recurrence";
import ProgressRing from "../components/ProgressRing";
import useAuthUser from "../hooks/useAuthUser";
import { useView } from "../contexts/ViewContext";

type OneTodo = {
  id: string;
  title: string;
  dueDate: string;
  completed?: boolean;
  completedBy?: Record<string, boolean>;
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

const ICON_BACK = "\u2190";
const ICON_PREV_MONTH = "\u2039";
const ICON_NEXT_MONTH = "\u203A";
const ICON_FLAME = "\u{1F525}";

function minYmd(a: string, b: string) {
  return a <= b ? a : b;
}

function eachDay(startYmd: string, endYmd: string, cb: (ymd: string) => void) {
  if (!startYmd || !endYmd || endYmd < startYmd) return;
  const end = ymdToDate(endYmd);
  const cur = ymdToDate(startYmd);
  while (cur.getTime() <= end.getTime()) {
    cb(dateToYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
}

function completionDateFromId(seriesId: string, docId: string) {
  const prefix = `${seriesId}_`;
  if (!docId.startsWith(prefix)) return "";
  return docId.slice(prefix.length);
}

function isYmdString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function ymdFromValue(value: any) {
  if (!value) return "";
  if (typeof value === "string") {
    return isYmdString(value) ? value : "";
  }
  if (value instanceof Date) return dateToYmd(value);
  if (typeof value?.toDate === "function") return dateToYmd(value.toDate());
  if (typeof value?.seconds === "number") return dateToYmd(new Date(value.seconds * 1000));
  return "";
}

type CompletionStats = {
  totalScheduled: number;
  totalCompleted: number;
  currentStreak: number;
  longestStreak: number;
};

function isOneDone(todo: OneTodo | null) {
  if (!todo) return false;
  if (typeof todo.completed === "boolean") return todo.completed;
  return legacyDoneFromMap(todo.completedBy);
}

function computeOneStats(todo: OneTodo | null, todayYmd: string): CompletionStats {
  if (!todo) {
    return { totalScheduled: 0, totalCompleted: 0, currentStreak: 0, longestStreak: 0 };
  }
  const done = isOneDone(todo);
  if (todo.dueDate > todayYmd && !done) {
    return { totalScheduled: 0, totalCompleted: 0, currentStreak: 0, longestStreak: 0 };
  }
  const streak = done ? 1 : 0;
  return { totalScheduled: 1, totalCompleted: done ? 1 : 0, currentStreak: streak, longestStreak: streak };
}

function computeSeriesStats(
  series: TodoSeries | null,
  completions: Record<string, boolean>,
  todayYmd: string,
): CompletionStats {
  if (!series) {
    return { totalScheduled: 0, totalCompleted: 0, currentStreak: 0, longestStreak: 0 };
  }

  const endYmd =
    series.end.type === "onDate" ? minYmd(series.end.endDate, todayYmd) : todayYmd;

  if (endYmd < series.startDate) {
    return { totalScheduled: 0, totalCompleted: 0, currentStreak: 0, longestStreak: 0 };
  }

  let totalScheduled = 0;
  let totalCompleted = 0;
  let currentStreak = 0;
  let longestStreak = 0;

  eachDay(series.startDate, endYmd, (ymd) => {
    if (!occursOn(series, ymd)) return;
    totalScheduled += 1;
    const done = completions[ymd] === true;
    if (done) {
      totalCompleted += 1;
      currentStreak += 1;
      if (currentStreak > longestStreak) longestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  });

  return { totalScheduled, totalCompleted, currentStreak, longestStreak };
}

export default function TodoCalendar() {
  const nav = useNavigate();
  const params = useParams();
  const kind = (params.kind ?? "one") as "one" | "series";
  const id = params.id ?? "";

  const { user } = useAuthUser();
  const uid = user?.uid ?? "";
  const { activeOwnerUid } = useView();
  const ownerUid = activeOwnerUid || uid;

  const todayYmd = ymdToday();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Calendar");

  const [oneTodo, setOneTodo] = useState<OneTodo | null>(null);
  const [series, setSeries] = useState<TodoSeries | null>(null);

  const [monthAnchor, setMonthAnchor] = useState<Date>(() => firstOfMonth(ymdToDate(todayYmd)));

  // For series only: date -> completed
  const [monthCompletions, setMonthCompletions] = useState<Record<string, boolean>>({});
  const [seriesCompletions, setSeriesCompletions] = useState<Record<string, boolean>>({});

  // Load the task
  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setMonthCompletions({});
      setSeriesCompletions({});
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
            completed: typeof data.completed === "boolean" ? data.completed : undefined,
            completedBy: data.completedBy as Record<string, boolean> | undefined,
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

  // Load completions for the visible month (aligns with daily view doc reads)
  useEffect(() => {
    let alive = true;

    async function run() {
      if (kind !== "series" || !id || !series) {
        setMonthCompletions({});
        return;
      }

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

      setMonthCompletions(map);
    }

    void run();
    return () => {
      alive = false;
    };
  }, [kind, id, series, monthAnchor]);

  // Load all completions for this series (for overall stats)
  useEffect(() => {
    if (kind !== "series" || !id || !ownerUid) {
      setSeriesCompletions({});
      return;
    }

    const completionsRef = collection(db, "todoSeriesCompletions");
    const q = query(completionsRef, where("ownerUid", "==", ownerUid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, boolean> = {};
        const prefix = `${id}_`;
        for (const docSnap of snap.docs) {
          const data = docSnap.data() as any;
          const docId = docSnap.id;
          const matches = data?.seriesId === id || docId.startsWith(prefix);
          if (!matches) continue;

          const dateFromIdRaw = completionDateFromId(id, docId);
          const dateFromId = isYmdString(dateFromIdRaw) ? dateFromIdRaw : "";
          const dateFromDoc = ymdFromValue(data?.date);
          const ymd = dateFromId || dateFromDoc;
          if (!ymd) continue;

          const done =
            typeof data?.completed === "boolean"
              ? !!data.completed
              : legacyDoneFromMap(data?.completedBy);
          map[ymd] = done;
        }
        setSeriesCompletions(map);
      },
      () => {},
    );

    return () => unsub();
  }, [kind, id, ownerUid]);

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
      const done = isOneDone(oneTodo);
      if (done) return { kind: "done" as const };
      if (ymd > todayYmd) return { kind: "future" as const };
      return { kind: "missed" as const };
    }

    if (!series) return { kind: "none" as const };
    const occurs = occursOn(series, ymd);
    if (!occurs) return { kind: "none" as const };

    const done = monthCompletions[ymd] === true;
    if (done) return { kind: "done" as const };
    if (ymd > todayYmd) return { kind: "future" as const };
    return { kind: "missed" as const };
  }

  const monthStats = useMemo(() => {
    const total = daysInMonth(monthAnchor);
    let scheduled = 0;
    let completed = 0;

    for (let day = 1; day <= total; day += 1) {
      const dt = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), day);
      const ymd = dateToYmd(dt);

      if (kind === "one") {
        if (!oneTodo || ymd !== oneTodo.dueDate) continue;
        const done = isOneDone(oneTodo);
        if (ymd > todayYmd && !done) continue;
        scheduled += 1;
        if (done) completed += 1;
        continue;
      }

      if (!series) continue;
      if (!occursOn(series, ymd)) continue;

      if (ymd > todayYmd) continue;

      scheduled += 1;
      if (monthCompletions[ymd] === true) completed += 1;
    }

    return { scheduled, completed };
  }, [kind, monthAnchor, oneTodo, series, monthCompletions, todayYmd]);

  const overallStats = useMemo(() => {
    return kind === "one"
      ? computeOneStats(oneTodo, todayYmd)
      : computeSeriesStats(series, seriesCompletions, todayYmd);
  }, [kind, oneTodo, series, seriesCompletions, todayYmd]);

  const monthRate = monthStats.scheduled > 0 ? monthStats.completed / monthStats.scheduled : 0;
  const overallRate =
    overallStats.totalScheduled > 0 ? overallStats.totalCompleted / overallStats.totalScheduled : 0;

  const monthLabel = monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <div>
      <div className="mx-auto max-w-md px-4 pb-24 pt-4">
        <div className="flex items-center justify-between">
          <button
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-bold text-zinc-100"
            onClick={() => nav(-1)}
          >
            {ICON_BACK} Back
          </button>

          <div className="text-center">
            <div className="text-base font-extrabold text-zinc-100">{title}</div>
          </div>

          <div className="w-[72px]" />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-bold text-zinc-100"
            onClick={() => setMonthAnchor((d) => addMonths(d, -1))}
          >
            {ICON_PREV_MONTH}
          </button>

          <div className="flex items-center gap-3 rounded-xl bg-zinc-900 px-3 py-2">
            <div className="text-sm font-extrabold text-zinc-100">{monthLabel}</div>
            <ProgressRing
              value={monthRate}
              size={36}
              stroke={4}
              ringColor="#10b981"
              innerClassName="bg-zinc-900"
              textClassName="text-[10px] font-extrabold text-zinc-100"
              ariaLabel="Monthly completion rate"
            />
          </div>

          <button
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-bold text-zinc-100"
            onClick={() => setMonthAnchor((d) => addMonths(d, 1))}
          >
            {ICON_NEXT_MONTH}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-400">
                  Completion since start
                </div>
                <div className="mt-1 text-sm font-semibold text-zinc-200">
                  {overallStats.totalCompleted} of {overallStats.totalScheduled} done
                </div>
              </div>
              <ProgressRing
                value={overallRate}
                size={50}
                stroke={5}
                ringColor="#34d399"
                innerClassName="bg-zinc-900"
                textClassName="text-xs font-extrabold text-zinc-100"
                ariaLabel="Overall completion rate"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-400">Streak</div>
                <div className="mt-1 text-lg font-extrabold text-zinc-100">
                  {overallStats.currentStreak}
                  <span className="ml-1 text-sm font-semibold text-zinc-300">days</span>
                </div>
                <div className="text-xs font-semibold text-zinc-400">Scheduled-day streak</div>
              </div>
              <div className="text-2xl">{ICON_FLAME}</div>
            </div>
          </div>
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
                    : st.kind === "future"
                      ? "border-orange-400"
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
              <span className="inline-block h-4 w-4 rounded-full border-2 border-orange-400" />
              Future to-do day
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-4 w-4 rounded-full border-2 border-zinc-300" />
              Not a to-do day
            </div>
          </div>

          {loading && <div className="mt-3 text-sm font-bold text-zinc-500">Loading...</div>}
        </div>
      </div>
    </div>
  );
}
