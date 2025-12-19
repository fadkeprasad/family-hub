import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { celebrateBigFireworks, celebrateSmall } from "../lib/celebrations";
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

function addDaysYmd(ymd: string, delta: number) {
  const dt = ymdToDate(ymd);
  dt.setDate(dt.getDate() + delta);
  return dateToYmd(dt);
}

export default function Todos() {
  const nav = useNavigate();

  const [editing, setEditing] = useState<{ kind: Row["kind"]; id: string } | null>(null);
  const [editingText, setEditingText] = useState("");
  const prevRemainingRef = useRef<number>(-1);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    const onDown = () => setOpenMenuId(null);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

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

  // Mark seen (for badges)
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

  // All recurring series
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
      if (!isDone) celebrateSmall();
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

  async function removeSeries(seriesId: string) {
    setErr(null);
    try {
      await updateDoc(doc(db, "todoSeries", seriesId), {
        active: false,
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete recurring to-do");
    }
  }

  async function saveEdit(kind: Row["kind"], id: string) {
    const trimmed = editingText.trim();
    if (!trimmed) return;

    setErr(null);
    try {
      if (kind === "one") {
        await updateDoc(doc(db, "todos", id), { title: trimmed, updatedAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, "todoSeries", id), { title: trimmed, updatedAt: serverTimestamp() });
      }
      setEditing(null);
      setEditingText("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update");
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

  const seriesForDay = useMemo(
    () => seriesItems.filter((s) => s.active !== false).filter((s) => occursOn(s, selectedDate)),
    [seriesItems, selectedDate],
  );

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

      if (!isDone) celebrateSmall();

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
  useEffect(() => {
    const prev = prevRemainingRef.current;
    if (prev >= 0 && prev > 0 && remaining === 0) {
      celebrateBigFireworks();
    }
    prevRemainingRef.current = remaining;
  }, [remaining]);

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight text-zinc-50">To-dos</h1>
      <p className="mt-1 text-base font-semibold text-zinc-300">{remaining} remaining for this day</p>

      {err && (
        <div className="mt-4 rounded-2xl border border-red-900/40 bg-red-950/40 p-4 text-base font-semibold text-red-200">
          {err}
        </div>
      )}

      {editing && (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-base font-extrabold text-zinc-100">
            Edit {editing.kind === "one" ? "to-do" : "recurring to-do"}
          </div>
          <input
            className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-4 text-base text-zinc-100 placeholder:text-zinc-500"
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            placeholder="Update the text…"
          />
          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 rounded-xl bg-emerald-600 py-4 text-base font-extrabold text-white disabled:opacity-60"
              onClick={() => void saveEdit(editing.kind, editing.id)}
              disabled={editingText.trim().length === 0}
              type="button"
            >
              Save
            </button>
            <button
              className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 py-4 text-base font-extrabold text-zinc-200"
              onClick={() => {
                setEditing(null);
                setEditingText("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="text-base font-extrabold text-zinc-100">Choose date</div>

        <div className="mt-2 flex items-center gap-2">
          <button
            className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-3 text-xl font-extrabold text-zinc-100"
            onClick={() => setSelectedDate((d) => addDaysYmd(d, -1))}
            aria-label="Previous day"
            type="button"
          >
            ‹
          </button>

          <input
            className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />

          <button
            className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-3 text-xl font-extrabold text-zinc-100"
            onClick={() => setSelectedDate((d) => addDaysYmd(d, 1))}
            aria-label="Next day"
            type="button"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {rows.length === 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-base font-semibold text-zinc-300">
            No to-dos for this date.
          </div>
        )}

        {rows.map((r) => {
          const done = r.done;
          const isRecurring = r.kind === "series";
          const menuKey = `${r.kind}_${r.id}`;

          return (
            <div
              key={menuKey}
              className={[
                "rounded-2xl border p-4 shadow-sm",
                done
                  ? "border-emerald-900/40 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-900/40",
              ].join(" ")}
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
                  type="button"
                >
                  <span
                    className={[
                      "mt-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border text-lg font-extrabold",
                      done
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-zinc-700 bg-zinc-950/20 text-zinc-500",
                    ].join(" ")}
                  >
                    {done ? "✓" : ""}
                  </span>

                  <div className="min-w-0">
                    <div
                      className={[
                        "min-w-0 break-words text-lg font-extrabold",
                        done ? "text-emerald-100" : "text-zinc-100",
                      ].join(" ")}
                    >
                      {r.title}
                    </div>
                    {isRecurring && <div className="mt-1 text-sm font-extrabold text-violet-300">Recurring</div>}
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  {/* Calendar icon */}
                  <button
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/30 text-lg text-zinc-100"
                    onClick={() => nav(`/todos/calendar/${r.kind}/${r.id}`)}
                    type="button"
                    aria-label="Open calendar"
                    title="Calendar"
                  >
                    📅
                  </button>

                  {/* 3-dot menu */}
                  <div className="relative">
                    <button
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/30 text-2xl leading-none text-zinc-100"
                      type="button"
                      aria-label="More"
                      title="More"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId((prev) => (prev === menuKey ? null : menuKey));
                      }}
                    >
                      ⋯
                    </button>

                    {openMenuId === menuKey && (
                      <div
                        className="absolute right-0 top-12 z-10 w-44 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-xl backdrop-blur"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <button
                          className="w-full px-4 py-3 text-left text-sm font-extrabold text-zinc-100 hover:bg-zinc-900/70"
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            setEditing({ kind: r.kind, id: r.id });
                            setEditingText(r.title);
                          }}
                        >
                          Edit
                        </button>

                        <button
                          className="w-full px-4 py-3 text-left text-sm font-extrabold text-red-200 hover:bg-zinc-900/70"
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            if (r.kind === "one") void removeOne(r.id);
                            else void removeSeries(r.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add one-time */}
      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="text-lg font-extrabold text-zinc-100">Add one-time</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100 placeholder:text-zinc-500"
            placeholder="What do you need to do?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button
            className="rounded-xl bg-emerald-600 py-4 text-base font-extrabold text-white disabled:opacity-60"
            onClick={() => void addOneTime()}
            disabled={busy || title.trim().length === 0 || !selectedDate}
            type="button"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {/* Add recurring */}
      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="text-lg font-extrabold text-zinc-100">Add recurring</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100 placeholder:text-zinc-500"
            placeholder="Recurring to-do title"
            value={recTitle}
            onChange={(e) => setRecTitle(e.target.value)}
          />

          <div className="grid gap-2">
            <div className="text-base font-extrabold text-zinc-200">Starts</div>
            <input
              className="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
              type="date"
              value={recStart}
              onChange={(e) => setRecStart(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <div className="text-base font-extrabold text-zinc-200">Repeats</div>
            <select
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
              value={recType}
              onChange={(e) => setRecType(e.target.value as any)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="grid gap-2">
            <div className="text-base font-extrabold text-zinc-200">Every</div>
            <div className="flex gap-2">
              <input
                className="w-28 rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
                type="number"
                min={1}
                value={recInterval}
                onChange={(e) => setRecInterval(Math.max(1, Number(e.target.value || 1)))}
              />
              <div className="flex items-center text-base font-extrabold text-zinc-300">
                {recType === "daily" ? "day(s)" : recType === "weekly" ? "week(s)" : "month(s)"}
              </div>
            </div>
          </div>

          {recType === "weekly" && (
            <div className="grid gap-2">
              <div className="text-base font-extrabold text-zinc-200">On</div>
              <div className="flex flex-wrap gap-2">
                {weekdays.map((w) => {
                  const on = recWeekDays.includes(w.k);
                  return (
                    <button
                      key={w.k}
                      type="button"
                      className={[
                        "rounded-xl border px-3 py-2 text-base font-extrabold",
                        on
                          ? "border-violet-500 bg-violet-600 text-white"
                          : "border-zinc-800 bg-zinc-950/20 text-zinc-200",
                      ].join(" ")}
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
              <div className="text-base font-extrabold text-zinc-200">Monthly pattern</div>

              <select
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
                value={recMonthlyMode}
                onChange={(e) => setRecMonthlyMode(e.target.value as any)}
              >
                <option value="dayOfMonth">On day of month</option>
                <option value="nthWeekday">On nth weekday</option>
              </select>

              {recMonthlyMode === "dayOfMonth" && (
                <div className="flex items-center gap-2">
                  <div className="text-base font-extrabold text-zinc-300">Day</div>
                  <input
                    className="w-28 rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
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
                      className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
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
                      className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
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
            <div className="text-base font-extrabold text-zinc-200">Ends</div>
            <select
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
              value={recEndType}
              onChange={(e) => setRecEndType(e.target.value as any)}
            >
              <option value="never">Never</option>
              <option value="onDate">On date</option>
            </select>

            {recEndType === "onDate" && (
              <input
                className="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base text-zinc-100"
                type="date"
                value={recEndDate}
                onChange={(e) => setRecEndDate(e.target.value)}
              />
            )}
          </div>

          <button
            className="rounded-xl bg-violet-600 py-4 text-base font-extrabold text-white disabled:opacity-60"
            onClick={() => void addSeries()}
            disabled={busy || recTitle.trim().length === 0}
            type="button"
          >
            {busy ? "Adding…" : "Add recurring"}
          </button>
        </div>
      </div>
    </div>
  );
}
