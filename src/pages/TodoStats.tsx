import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";
import { useView } from "../contexts/ViewContext";
import { dateToYmd, ymdToday, ymdToDate } from "../lib/dateUtil";
import type { SeriesEnd, SeriesPattern, TodoSeries } from "../lib/recurrence";
import { occursOn } from "../lib/recurrence";
import ProgressRing from "../components/ProgressRing";

type DayStats = {
  scheduled: number;
  completed: number;
};

type SeriesCompletion = {
  seriesId: string;
  date: string;
  done: boolean;
};

type Rollup = {
  totalScheduled: number;
  totalCompleted: number;
  currentStreak: number;
  longestStreak: number;
};

type TableRow = {
  id: string;
  title: string;
  completedCount: number;
  completionRate: number;
  longestStreak: number;
};

const ICON_FLAME = "\u{1F525}";

function legacyDoneFromMap(map: any): boolean {
  if (!map || typeof map !== "object") return false;
  return Object.values(map).some(Boolean);
}

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

function parseCompletionDoc(docId: string, data: any): SeriesCompletion | null {
  const fromDocSeriesId = String(data?.seriesId ?? "");
  const fromDocDate = ymdFromValue(data?.date);
  const docIdSep = docId.lastIndexOf("_");

  const fromIdSeries = docIdSep > 0 ? docId.slice(0, docIdSep) : "";
  const fromIdDateRaw = docIdSep > 0 ? docId.slice(docIdSep + 1) : "";
  const fromIdDate = isYmdString(fromIdDateRaw) ? fromIdDateRaw : "";

  const seriesId = fromDocSeriesId || fromIdSeries;
  const date = fromIdDate || fromDocDate;
  if (!seriesId || !date) return null;

  const done =
    typeof data?.completed === "boolean" ? !!data.completed : legacyDoneFromMap(data?.completedBy);

  return { seriesId, date, done };
}

function bumpDay(map: Map<string, DayStats>, ymd: string, done: boolean) {
  const prev = map.get(ymd) ?? { scheduled: 0, completed: 0 };
  prev.scheduled += 1;
  if (done) prev.completed += 1;
  map.set(ymd, prev);
}

function computeSeriesRollup(
  series: TodoSeries,
  completions: Record<string, boolean>,
  todayYmd: string,
  dayStats: Map<string, DayStats>,
): Rollup {
  const endYmd = series.end.type === "onDate" ? minYmd(series.end.endDate, todayYmd) : todayYmd;
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

    bumpDay(dayStats, ymd, done);
  });

  return { totalScheduled, totalCompleted, currentStreak, longestStreak };
}

export default function TodoStats() {
  const nav = useNavigate();
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";
  const { activeOwnerUid } = useView();
  const ownerUid = activeOwnerUid || uid;

  const todayYmd = ymdToday();

  const [seriesItems, setSeriesItems] = useState<TodoSeries[]>([]);
  const [seriesCompletions, setSeriesCompletions] = useState<Record<string, Record<string, boolean>>>({});
  const [err, setErr] = useState<string | null>(null);

  const seriesCol = useMemo(() => collection(db, "todoSeries"), []);
  const completionsCol = useMemo(() => collection(db, "todoSeriesCompletions"), []);

  useEffect(() => {
    if (!ownerUid) {
      setSeriesItems([]);
      return;
    }

    const q = query(seriesCol, where("ownerUid", "==", ownerUid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: TodoSeries[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: String(data.title ?? ""),
            startDate: String(data.startDate ?? "1970-01-01"),
            end: (data.end as SeriesEnd) ?? { type: "never" },
            pattern: (data.pattern as SeriesPattern) ?? { type: "daily", interval: 1 },
            active: data.active !== false,
          };
        });
        setSeriesItems(next);
        setErr(null);
      },
      (e) => setErr(e?.message ?? "Failed to load recurring to-dos"),
    );

    return () => unsub();
  }, [ownerUid, seriesCol]);

  useEffect(() => {
    if (!ownerUid) {
      setSeriesCompletions({});
      return;
    }

    const q = query(completionsCol, where("ownerUid", "==", ownerUid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Record<string, Record<string, boolean>> = {};
        for (const docSnap of snap.docs) {
          const parsed = parseCompletionDoc(docSnap.id, docSnap.data());
          if (!parsed) continue;
          if (!next[parsed.seriesId]) next[parsed.seriesId] = {};
          next[parsed.seriesId][parsed.date] = parsed.done;
        }
        setSeriesCompletions(next);
        setErr(null);
      },
      (e) => setErr(e?.message ?? "Failed to load completion history"),
    );

    return () => unsub();
  }, [ownerUid, completionsCol]);

  const stats = useMemo(() => {
    const activeSeries = seriesItems.filter((s) => s.active !== false);
    const dayStats = new Map<string, DayStats>();
    const rows: TableRow[] = [];
    let totalScheduled = 0;
    let totalCompleted = 0;

    for (const series of activeSeries) {
      const completions = seriesCompletions[series.id] ?? {};
      const rollup = computeSeriesRollup(series, completions, todayYmd, dayStats);
      const rate = rollup.totalScheduled > 0 ? rollup.totalCompleted / rollup.totalScheduled : 0;

      rows.push({
        id: series.id,
        title: series.title,
        completedCount: rollup.totalCompleted,
        completionRate: rate,
        longestStreak: rollup.longestStreak,
      });

      totalScheduled += rollup.totalScheduled;
      totalCompleted += rollup.totalCompleted;
    }

    rows.sort((a, b) => a.title.localeCompare(b.title));

    const scheduledDays = Array.from(dayStats.entries())
      .filter(([, v]) => v.scheduled > 0)
      .map(([ymd, v]) => ({ ymd, scheduled: v.scheduled, completed: v.completed }))
      .sort((a, b) => a.ymd.localeCompare(b.ymd));

    let powerDays = 0;
    for (const day of scheduledDays) {
      if (day.completed === day.scheduled) powerDays += 1;
    }

    let streak = 0;
    for (let i = scheduledDays.length - 1; i >= 0; i -= 1) {
      const day = scheduledDays[i];
      if (day.ymd > todayYmd) continue;
      if (day.completed > 0) streak += 1;
      else break;
    }

    const overallRate = totalScheduled > 0 ? totalCompleted / totalScheduled : 0;

    return {
      rows,
      totalScheduled,
      totalCompleted,
      overallRate,
      powerDays,
      streak,
    };
  }, [seriesItems, seriesCompletions, todayYmd]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-bold text-zinc-100"
          onClick={() => nav(-1)}
        >
          Back
        </button>
        <div className="text-center">
          <div className="text-base font-extrabold text-zinc-100">To-do stats</div>
          <div className="mt-1 text-xs font-semibold text-zinc-400">Active recurring tasks</div>
        </div>
        <div className="w-[72px]" />
      </div>

      {err && (
        <div className="mt-4 rounded-2xl border border-red-900/40 bg-red-950/40 p-3 text-sm font-semibold text-red-200 sm:p-4 sm:text-base">
          {err}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-400">Streak</div>
              <div className="mt-1 text-lg font-extrabold text-zinc-100">
                {stats.streak}
                <span className="ml-1 text-sm font-semibold text-zinc-300">days</span>
              </div>
              <div className="text-xs font-semibold text-zinc-400">Scheduled-day streak</div>
            </div>
            <div className="text-2xl">{ICON_FLAME}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
          <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-400">Power days</div>
          <div className="mt-2 text-2xl font-extrabold text-zinc-100">{stats.powerDays}</div>
          <div className="text-xs font-semibold text-zinc-400">All scheduled to-dos done</div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-400">Overall rate</div>
              <div className="mt-1 text-sm font-semibold text-zinc-200">
                {stats.totalCompleted} of {stats.totalScheduled} done
              </div>
            </div>
            <ProgressRing
              value={stats.overallRate}
              size={46}
              stroke={5}
              ringColor="#34d399"
              innerClassName="bg-zinc-900"
              textClassName="text-xs font-extrabold text-zinc-100"
              ariaLabel="Overall completion rate"
            />
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
        <div className="border-b border-zinc-800 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-zinc-400">
          Active recurring to-dos
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[560px] w-full text-left text-sm">
            <thead className="bg-zinc-950/40 text-xs font-semibold uppercase text-zinc-400">
              <tr>
                <th className="px-3 py-2">To-do</th>
                <th className="px-3 py-2">Times completed</th>
                <th className="px-3 py-2">Completion rate</th>
                <th className="px-3 py-2">Longest streak</th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-sm font-semibold text-zinc-300" colSpan={4}>
                    No recurring to-dos yet.
                  </td>
                </tr>
              )}

              {stats.rows.map((row) => {
                const pct = Math.round(row.completionRate * 100);
                return (
                  <tr key={row.id} className="border-t border-zinc-800/60">
                    <td className="px-3 py-3 text-sm font-semibold text-zinc-100">{row.title}</td>
                    <td className="px-3 py-3 text-sm font-semibold text-zinc-200">
                      {row.completedCount}
                    </td>
                    <td className="px-3 py-3 text-sm font-semibold text-zinc-200">{pct}%</td>
                    <td className="px-3 py-3 text-sm font-semibold text-zinc-200">
                      {row.longestStreak}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
