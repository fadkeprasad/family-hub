import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";
import useProfile from "../hooks/useProfile";
import { ymdToday } from "../lib/dateUtil";
import type { SeriesEnd, SeriesPattern, TodoSeries } from "../lib/recurrence";
import { occursOn } from "../lib/recurrence";

type OneTodo = {
  id: string;
  title: string;
  dueDate: string;
  createdAt?: any;

  // shared completion (new)
  completed?: boolean;
  completedAt?: any;
  completedByRole?: "prasad" | "anjali";

  // legacy per-user completion (old)
  completedBy?: Record<string, boolean>;
};

type Row =
  | { kind: "series"; id: string; title: string; done: boolean }
  | { kind: "one"; id: string; title: string; done: boolean };

function toMillis(ts: any) {
  return ts?.toMillis?.() ?? 0;
}

function legacyDoneFromMap(m?: Record<string, boolean>) {
  if (!m) return false;
  return Object.values(m).some(Boolean);
}

const weekdays = [
  { k: 0, label: "Sun" },
  { k: 1, label: "Mon" },
  { k: 2, label: "Tue" },
  { k: 3, label: "Wed" },
  { k: 4, label: "Thu" },
  { k: 5, label: "Fri" },
  { k: 6, label: "Sat" },
];

export default function Todos() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";
  const { profile } = useProfile();
  const userRole = profile?.role; // "prasad" | "anjali" | undefined

  const [selectedDate, setSelectedDate] = useState(ymdToday);

  const [oneItems, setOneItems] = useState<OneTodo[]>([]);
  const [seriesItems, setSeriesItems] = useState<TodoSeries[]>([]);

  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // recurring form state
  const [recTitle, setRecTitle] = useState("");
  const [recStart, setRecStart] = useState(ymdToday);

  const [recEndType, setRecEndType] = useState<SeriesEnd["type"]>("never");
  const [recEndDate, setRecEndDate] = useState(ymdToday);

  const [recType, setRecType] = useState<SeriesPattern["type"]>("weekly");
  const [recInterval, setRecInterval] = useState(1);

  const [recWeekDays, setRecWeekDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri

  const [recMonthlyMode, setRecMonthlyMode] = useState<"dayOfMonth" | "nthWeekday">("dayOfMonth");
  const [recDayOfMonth, setRecDayOfMonth] = useState(1);
  const [recNth, setRecNth] = useState(1);
  const [recWeekday, setRecWeekday] = useState(1);

  const todosCol = useMemo(() => collection(db, "todos"), []);
  const seriesCol = useMemo(() => collection(db, "todoSeries"), []);

  // Mark seen (for future unread badge logic)
  useEffect(() => {
    if (!uid) return;
    updateDoc(doc(db, "users", uid), { "lastSeen.todos": serverTimestamp() }).catch(() => {});
  }, [uid]);

  // One-time todos for selected date
  useEffect(() => {
    const q = query(todosCol, where("dueDate", "==", selectedDate));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: OneTodo[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: String(data.title ?? ""),
            dueDate: String(data.dueDate ?? ""),
            createdAt: data.createdAt,

            completed: typeof data.completed === "boolean" ? data.completed : undefined,
            completedAt: data.completedAt,
            completedByRole: data.completedByRole,

            completedBy: (data.completedBy as Record<string, boolean> | undefined) ?? undefined,
          };
        });

        next.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        setOneItems(next);
        setErr(null);
      },
      (e) => setErr(e?.message ?? "Failed to load to-dos"),
    );

    return () => unsub();
  }, [todosCol, selectedDate]);

  // All recurring series (small scale app, simplest)
  useEffect(() => {
    const unsub = onSnapshot(
      query(seriesCol),
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
  }, [seriesCol]);

  async function addOneTime() {
    const trimmed = title.trim();
    if (!trimmed || !uid) return;

    setBusy(true);
    setErr(null);
    try {
      await addDoc(todosCol, {
        title: trimmed,
        dueDate: selectedDate,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        // shared completion default
        completed: false,
      });
      setTitle("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add to-do");
    } finally {
      setBusy(false);
    }
  }

  function isOneDone(t: OneTodo) {
    // If shared field exists, it wins. Otherwise fall back to legacy map.
    if (typeof t.completed === "boolean") return t.completed;
    return legacyDoneFromMap(t.completedBy);
  }

  async function toggleOne(todo: OneTodo) {
    if (!uid) return;
    setErr(null);

    const ref = doc(db, "todos", todo.id);
    const isDone = isOneDone(todo);

    try {
      await updateDoc(ref, {
        completed: !isDone,
        completedAt: !isDone ? serverTimestamp() : null,
        completedByRole: !isDone ? (userRole ?? null) : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update to-do");
    }
  }

  async function removeOne(id: string) {
    setErr(null);
    try {
      await deleteDoc(doc(db, "todos", id));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete to-do");
    }
  }

  function buildSeriesEnd(): SeriesEnd {
    if (recEndType === "never") return { type: "never" };
    return { type: "onDate", endDate: recEndDate };
  }

  function buildSeriesPattern(): SeriesPattern {
    const interval = Math.max(1, recInterval);

    if (recType === "daily") return { type: "daily", interval };

    if (recType === "weekly") {
      const days = recWeekDays.length ? recWeekDays : [new Date().getDay()];
      return { type: "weekly", interval, daysOfWeek: days };
    }

    // monthly
    if (recMonthlyMode === "dayOfMonth") {
      return { type: "monthly", interval, monthlyMode: "dayOfMonth", dayOfMonth: recDayOfMonth };
    }

    return { type: "monthly", interval, monthlyMode: "nthWeekday", nth: recNth, weekday: recWeekday };
  }

  async function addSeries() {
    const trimmed = recTitle.trim();
    if (!trimmed || !uid) return;

    setBusy(true);
    setErr(null);
    try {
      const end = buildSeriesEnd();
      const pattern = buildSeriesPattern();

      await addDoc(seriesCol, {
        title: trimmed,
        startDate: recStart,
        end,
        pattern,
        active: true,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setRecTitle("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add recurring to-do");
    } finally {
      setBusy(false);
    }
  }

  const seriesForDay = useMemo(() => seriesItems.filter((s) => occursOn(s, selectedDate)), [seriesItems, selectedDate]);
  const [seriesDoneMap, setSeriesDoneMap] = useState<Record<string, boolean>>({});

  // Listen for per-day completion docs for series on this date (shared completion)
  useEffect(() => {
    if (!uid) return;

    setSeriesDoneMap({});
    if (seriesForDay.length === 0) return;

    const unsubs: Array<() => void> = [];

    for (const series of seriesForDay) {
      const completionId = `${series.id}_${selectedDate}`;
      const ref = doc(db, "todoSeriesCompletions", completionId);

      const unsub = onSnapshot(ref, (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;

        // shared wins, else legacy
        const done =
          typeof data?.completed === "boolean"
            ? !!data.completed
            : legacyDoneFromMap(data?.completedBy);

        setSeriesDoneMap((prev) => ({ ...prev, [series.id]: done }));
      });

      unsubs.push(unsub);
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [uid, selectedDate, seriesForDay]);

  async function toggleSeriesDone(seriesId: string) {
    if (!uid) return;

    setErr(null);
    const completionId = `${seriesId}_${selectedDate}`;
    const ref = doc(db, "todoSeriesCompletions", completionId);

    try {
      const snap = await getDoc(ref);
      const data = snap.exists() ? (snap.data() as any) : null;

      const isDone =
        typeof data?.completed === "boolean"
          ? !!data.completed
          : legacyDoneFromMap(data?.completedBy);

      if (!snap.exists()) {
        await setDoc(ref, {
          seriesId,
          date: selectedDate,
          completed: true,
          completedAt: serverTimestamp(),
          completedByRole: userRole ?? null,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      await updateDoc(ref, {
        completed: !isDone,
        completedAt: !isDone ? serverTimestamp() : null,
        completedByRole: !isDone ? (userRole ?? null) : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update recurring to-do");
    }
  }

  const rows: Row[] = useMemo(() => {
    const rec: Row[] = seriesForDay.map((s) => ({
      kind: "series",
      id: s.id,
      title: s.title,
      done: !!seriesDoneMap[s.id],
    }));

    const one: Row[] = oneItems.map((t) => ({
      kind: "one",
      id: t.id,
      title: t.title,
      done: isOneDone(t),
    }));

    return [...rec, ...one];
  }, [seriesForDay, seriesDoneMap, oneItems]);

  const remaining = rows.filter((r) => !r.done).length;

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-zinc-900">To-dos</h1>
      <p className="mt-1 text-base font-medium text-zinc-700">{remaining} remaining for this day</p>

      {err && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-base font-semibold text-red-700">
          {err}
        </div>
      )}

      <div className="mt-5 rounded-2xl border bg-zinc-50 p-4">
        <div className="text-base font-bold text-zinc-800">Choose date</div>
        <input
          className="mt-2 w-full rounded-xl border px-4 py-4 text-base"
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      <div className="mt-5 grid gap-3">
        {rows.length === 0 && (
          <div className="rounded-2xl border bg-white p-4 text-base font-medium text-zinc-600">
            No to-dos for this date.
          </div>
        )}

        {rows.map((r) => {
          const done = r.done;
          const isRecurring = r.kind === "series";

          return (
            <div
              key={`${r.kind}_${r.id}`}
              className={`rounded-2xl border p-4 shadow-sm ${
                done ? "bg-emerald-50 border-emerald-200" : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  className="flex flex-1 items-start gap-3 text-left"
                  onClick={() => {
                    if (r.kind === "series") {
                      void toggleSeriesDone(r.id);
                    } else {
                      const t = oneItems.find((x) => x.id === r.id);
                      if (t) void toggleOne(t);
                    }
                  }}
                >
                  <span
                    className={`mt-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border text-lg font-extrabold ${
                      done ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-zinc-400"
                    }`}
                  >
                    {done ? "✓" : ""}
                  </span>

                  <div className="min-w-0">
                    <div className={`min-w-0 break-words text-lg font-extrabold ${done ? "text-emerald-900" : "text-zinc-900"}`}>
                      {r.title}
                    </div>
                    {isRecurring && (
                      <div className="mt-1 text-sm font-bold text-violet-700">Recurring</div>
                    )}
                  </div>
                </button>

                {r.kind === "one" && (
                  <button
                    className="rounded-xl border px-3 py-2 text-base font-bold text-zinc-900"
                    onClick={() => void removeOne(r.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add one-time */}
      <div className="mt-6 rounded-2xl border bg-zinc-50 p-4">
        <div className="text-lg font-extrabold text-zinc-900">Add one-time</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border px-4 py-4 text-base"
            placeholder="What do you need to do?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button
            className="rounded-xl bg-emerald-600 py-4 text-base font-extrabold text-white disabled:opacity-60"
            onClick={() => void addOneTime()}
            disabled={busy || title.trim().length === 0 || !selectedDate}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {/* Add recurring */}
      <div className="mt-6 rounded-2xl border bg-zinc-50 p-4">
        <div className="text-lg font-extrabold text-zinc-900">Add recurring</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border px-4 py-4 text-base"
            placeholder="Recurring to-do title"
            value={recTitle}
            onChange={(e) => setRecTitle(e.target.value)}
          />

          <div className="grid gap-2">
            <div className="text-base font-bold text-zinc-800">Starts</div>
            <input
              className="w-full rounded-xl border px-4 py-4 text-base"
              type="date"
              value={recStart}
              onChange={(e) => setRecStart(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <div className="text-base font-bold text-zinc-800">Repeats</div>
            <select
              className="w-full rounded-xl border px-4 py-4 text-base"
              value={recType}
              onChange={(e) => setRecType(e.target.value as any)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="grid gap-2">
            <div className="text-base font-bold text-zinc-800">Every</div>
            <div className="flex gap-2">
              <input
                className="w-28 rounded-xl border px-4 py-4 text-base"
                type="number"
                min={1}
                value={recInterval}
                onChange={(e) => setRecInterval(Math.max(1, Number(e.target.value || 1)))}
              />
              <div className="flex items-center text-base font-bold text-zinc-700">
                {recType === "daily" ? "day(s)" : recType === "weekly" ? "week(s)" : "month(s)"}
              </div>
            </div>
          </div>

          {recType === "weekly" && (
            <div className="grid gap-2">
              <div className="text-base font-bold text-zinc-800">On</div>
              <div className="flex flex-wrap gap-2">
                {weekdays.map((w) => {
                  const on = recWeekDays.includes(w.k);
                  return (
                    <button
                      key={w.k}
                      type="button"
                      className={`rounded-xl border px-3 py-2 text-base font-bold ${
                        on ? "bg-violet-700 text-white border-violet-700" : "bg-white text-zinc-800"
                      }`}
                      onClick={() => {
                        setRecWeekDays((prev) =>
                          prev.includes(w.k) ? prev.filter((x) => x !== w.k) : [...prev, w.k].sort(),
                        );
                      }}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {recType === "monthly" && (
            <div className="grid gap-3">
              <div className="text-base font-bold text-zinc-800">Monthly pattern</div>

              <select
                className="w-full rounded-xl border px-4 py-4 text-base"
                value={recMonthlyMode}
                onChange={(e) => setRecMonthlyMode(e.target.value as any)}
              >
                <option value="dayOfMonth">On day of month</option>
                <option value="nthWeekday">On nth weekday</option>
              </select>

              {recMonthlyMode === "dayOfMonth" && (
                <div className="flex gap-2 items-center">
                  <div className="text-base font-bold text-zinc-700">Day</div>
                  <input
                    className="w-28 rounded-xl border px-4 py-4 text-base"
                    type="number"
                    min={1}
                    max={31}
                    value={recDayOfMonth}
                    onChange={(e) => setRecDayOfMonth(Math.min(31, Math.max(1, Number(e.target.value || 1))))}
                  />
                </div>
              )}

              {recMonthlyMode === "nthWeekday" && (
                <div className="grid gap-2">
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded-xl border px-4 py-4 text-base"
                      value={recNth}
                      onChange={(e) => setRecNth(Number(e.target.value))}
                    >
                      <option value={1}>First</option>
                      <option value={2}>Second</option>
                      <option value={3}>Third</option>
                      <option value={4}>Fourth</option>
                      <option value={-1}>Last</option>
                    </select>

                    <select
                      className="flex-1 rounded-xl border px-4 py-4 text-base"
                      value={recWeekday}
                      onChange={(e) => setRecWeekday(Number(e.target.value))}
                    >
                      {weekdays.map((w) => (
                        <option key={w.k} value={w.k}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <div className="text-base font-bold text-zinc-800">Ends</div>
            <select
              className="w-full rounded-xl border px-4 py-4 text-base"
              value={recEndType}
              onChange={(e) => setRecEndType(e.target.value as any)}
            >
              <option value="never">Never</option>
              <option value="onDate">On date</option>
            </select>

            {recEndType === "onDate" && (
              <input
                className="w-full rounded-xl border px-4 py-4 text-base"
                type="date"
                value={recEndDate}
                onChange={(e) => setRecEndDate(e.target.value)}
              />
            )}
          </div>

          <button
            className="rounded-xl bg-violet-700 py-4 text-base font-extrabold text-white disabled:opacity-60"
            onClick={() => void addSeries()}
            disabled={busy || recTitle.trim().length === 0}
          >
            {busy ? "Adding…" : "Add recurring"}
          </button>
        </div>
      </div>
    </div>
  );
}
