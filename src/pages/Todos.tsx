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
import { useView } from "../contexts/ViewContext";
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

  // legacy completion support
  completedBy?: Record<string, boolean>;
};

type Row =
  | { kind: "one"; id: string; title: string; done: boolean }
  | { kind: "series"; id: string; title: string; done: boolean };

function legacyDoneFromMap(map: any): boolean {
  if (!map || typeof map !== "object") return false;
  return Object.values(map).some(Boolean);
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
function addDaysYmd(ymd: string, delta: number) {
  const dt = ymdToDate(ymd);
  dt.setDate(dt.getDate() + delta);
  return dateToYmd(dt);
}

function toMillis(ts: any) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

const weekdays = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

export default function Todos() {
  const nav = useNavigate();

  const [editing, setEditing] = useState<{ kind: Row["kind"]; id: string } | null>(null);
  const [editingText, setEditingText] = useState("");
  const prevRemainingRef = useRef<number>(-1);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const { user } = useAuthUser();
  const uid = user?.uid ?? "";
  const { activeOwnerUid, isMyView } = useView();
  const ownerUid = activeOwnerUid || uid;
  const canEdit = isMyView;

  const { profile } = useProfile();
  const userRole = profile?.role; // "prasad" | "anjali" | undefined

  useEffect(() => {
    if (!canEdit) {
      setOpenMenuId(null);
      setEditing(null);
      setEditingText("");
      setAddOpen(false);
    }
  }, [canEdit]);

  useEffect(() => {
    const onDown = () => setOpenMenuId(null);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  const [selectedDate, setSelectedDate] = useState<string>(() => ymdToday());

  const [title, setTitle] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"one" | "recurring">("one");

  const [oneItems, setOneItems] = useState<OneTodo[]>([]);
  const [seriesItems, setSeriesItems] = useState<TodoSeries[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [recTitle, setRecTitle] = useState("");
  const [recStart, setRecStart] = useState<string>(() => ymdToday());

  const [recEndType, setRecEndType] = useState<SeriesEnd["type"]>("never");
  const [recEndDate, setRecEndDate] = useState<string>(() => ymdToday());

  const [recType, setRecType] = useState<SeriesPattern["type"]>("weekly");
  const [recInterval, setRecInterval] = useState(1);

  // Weekly selection is perfect, keep it as-is
  const [recWeekDays, setRecWeekDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri

  const todosCol = useMemo(() => collection(db, "todos"), []);
  const seriesCol = useMemo(() => collection(db, "todoSeries"), []);

  // Mark seen (for badges) only in My view
  useEffect(() => {
    if (!uid || !canEdit) return;
    updateDoc(doc(db, "users", uid), { "lastSeen.todos": serverTimestamp() }).catch(() => {});
  }, [uid, canEdit]);

  // One-time todos for selected date
  useEffect(() => {
    if (!ownerUid) {
      setOneItems([]);
      return;
    }

    const q = query(todosCol, where("ownerUid", "==", ownerUid), where("dueDate", "==", selectedDate));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: OneTodo[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: String(data.title ?? ""),
            dueDate: String(data.dueDate ?? selectedDate),
            createdAt: data.createdAt,

            completed: typeof data.completed === "boolean" ? data.completed : undefined,
            completedAt: data.completedAt,
            completedByRole: data.completedByRole,

            completedBy: data.completedBy,
          };
        });

        next.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        setOneItems(next);
        setErr(null);
      },
      (e) => setErr(e?.message ?? "Failed to load to-dos"),
    );

    return () => unsub();
  }, [todosCol, ownerUid, selectedDate]);

  // All recurring series for this ownerUid
  useEffect(() => {
    if (!ownerUid) {
      setSeriesItems([]);
      return;
    }

    const unsub = onSnapshot(
      query(seriesCol, where("ownerUid", "==", ownerUid)),
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
  }, [seriesCol, ownerUid]);

  async function addOneTime() {
    if (!canEdit) return;
    const trimmed = title.trim();
    if (!trimmed || !uid) return;

    setBusy(true);
    setErr(null);
    try {
      await addDoc(todosCol, {
        ownerUid: uid,
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
    if (!canEdit) return;
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
    if (!canEdit) return;
    if (!uid) return;
    setErr(null);
    try {
      await deleteDoc(doc(db, "todos", id));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete to-do");
    }
  }

  async function removeSeries(seriesId: string) {
    if (!canEdit) return;
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

    // monthly: day-of-month derived from Starts date
    const startDay = ymdToDate(recStart).getDate();
    return { type: "monthly", interval, monthlyMode: "dayOfMonth", dayOfMonth: startDay };
  }

  async function addSeries() {
    if (!canEdit) return;
    const trimmed = recTitle.trim();
    if (!trimmed || !uid) return;

    setBusy(true);
    setErr(null);
    try {
      const end = buildSeriesEnd();
      const pattern = buildSeriesPattern();

      await addDoc(seriesCol, {
        ownerUid: uid,
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
    if (!uid || !ownerUid) return;

    setSeriesDoneMap({});
    if (seriesForDay.length === 0) return;

    const unsubs: Array<() => void> = [];

    for (const series of seriesForDay) {
      const completionId = `${series.id}_${selectedDate}`;
      const ref = doc(db, "todoSeriesCompletions", completionId);

      const unsub = onSnapshot(ref, (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;

        const done =
          typeof data?.completed === "boolean" ? !!data.completed : legacyDoneFromMap(data?.completedBy);

        setSeriesDoneMap((prev) => {
          if (prev[series.id] === done) return prev;
          return { ...prev, [series.id]: done };
        });
      });

      unsubs.push(unsub);
    }

    return () => unsubs.forEach((u) => u());
  }, [uid, ownerUid, selectedDate, seriesForDay]);

  async function toggleSeriesDone(seriesId: string) {
    if (!canEdit) return;
    if (!uid) return;

    setErr(null);

    const completionId = `${seriesId}_${selectedDate}`;
    const ref = doc(db, "todoSeriesCompletions", completionId);

    try {
      const snap = await getDoc(ref);
      const data = snap.exists() ? (snap.data() as any) : null;

      const isDone =
        typeof data?.completed === "boolean" ? !!data.completed : legacyDoneFromMap(data?.completedBy);

      if (!isDone) celebrateSmall();

      if (!snap.exists()) {
        await setDoc(ref, {
          ownerUid: uid,
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

  async function saveEdit(kind: Row["kind"], id: string) {
    if (!canEdit) return;
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
      <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50 sm:text-3xl">To-dos</h1>
      <p className="mt-1 text-sm font-semibold text-zinc-300 sm:text-base">{remaining} remaining for this day</p>

      {!canEdit && (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 text-sm font-semibold text-zinc-200 sm:p-4 sm:text-base">
          Read-only view. You cannot edit this user's data.
        </div>
      )}

      {err && (
        <div className="mt-4 rounded-2xl border border-red-900/40 bg-red-950/40 p-3 text-sm font-semibold text-red-200 sm:p-4 sm:text-base">
          {err}
        </div>
      )}

      {canEdit && editing && (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3 sm:p-4">
          <div className="text-sm font-extrabold text-zinc-100 sm:text-base">
            Edit {editing.kind === "one" ? "to-do" : "recurring to-do"}
          </div>
          <input
            className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 sm:text-base"
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            placeholder="Update the text"
          />
          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white disabled:opacity-60 sm:text-base"
              onClick={() => void saveEdit(editing.kind, editing.id)}
              disabled={editingText.trim().length === 0}
              type="button"
            >
              Save
            </button>
            <button
              className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 py-3 text-sm font-extrabold text-zinc-100 sm:text-base"
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

      {/* Date */}
      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300 sm:text-sm">Date</div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-base font-extrabold text-zinc-100 sm:text-lg"
              onClick={() => setSelectedDate((d) => addDaysYmd(d, -1))}
              aria-label="Previous day"
              type="button"
            >
              ‹
            </button>

            <input
              className="min-w-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm text-zinc-100 sm:text-base"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />

            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-base font-extrabold text-zinc-100 sm:text-lg"
              onClick={() => setSelectedDate((d) => addDaysYmd(d, 1))}
              aria-label="Next day"
              type="button"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="mt-5 grid gap-3">
        {rows.length === 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 text-sm font-semibold text-zinc-300 sm:p-4 sm:text-base">
            No to-dos for this date.
          </div>
        )}

        {rows.map((r) => {
          const done = r.done;
          const menuKey = `${r.kind}_${r.id}`;

          return (
            <div
              key={menuKey}
              className={[
                "rounded-2xl border p-3 shadow-sm sm:p-4",
                done ? "border-emerald-900/40 bg-emerald-950/20" : "border-zinc-800 bg-zinc-900/40",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  type="button"
                  onClick={() => {
                    if (r.kind === "one") void toggleOne({ id: r.id } as any);
                    else void toggleSeriesDone(r.id);
                  }}
                >
                  <span
                    className={[
                      "mt-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border text-base font-extrabold",
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
                        "text-sm font-extrabold sm:text-base",
                        done ? "text-emerald-100 line-through" : "text-zinc-100",
                      ].join(" ")}
                    >
                      {r.title}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-zinc-400 sm:text-sm">
                      {r.kind === "series" ? "Recurring" : "One-time"}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/30 text-base text-zinc-100 sm:h-10 sm:w-10"
                    onClick={() => nav(`/todos/calendar/${r.kind}/${r.id}`)}
                    type="button"
                    aria-label="Open calendar"
                    title="Calendar"
                  >
                    📅
                  </button>

                  <div className="relative">
                    <button
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/30 text-xl leading-none text-zinc-100 sm:h-10 sm:w-10"
                      type="button"
                      disabled={!canEdit}
                      aria-label="More"
                      title="More"
                      onClick={(e) => {
                        if (!canEdit) return;
                        e.stopPropagation();
                        setOpenMenuId((prev) => (prev === menuKey ? null : menuKey));
                      }}
                    >
                      ⋯
                    </button>

                    {openMenuId === menuKey && (
                      <div
                        className="absolute right-0 top-12 w-40 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-xl backdrop-blur"
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

      {canEdit && (
        <div className="mt-6">
          <button
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 py-3 text-sm font-extrabold text-zinc-100 sm:text-base"
            onClick={() => setAddOpen((v) => !v)}
            type="button"
          >
            {addOpen ? "Close add" : "Add to-do"}
          </button>

          {addOpen && (
            <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-extrabold text-zinc-100 sm:text-base">Add a to-do</div>
                <div className="text-xs font-semibold text-zinc-400 sm:text-sm">
                  {addMode === "one" ? "One-time" : "Recurring"}
                </div>
              </div>

              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={[
                      "rounded-xl border px-4 py-3 text-xs font-extrabold sm:text-sm",
                      addMode === "recurring"
                        ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                        : "border-zinc-800 bg-zinc-950/30 text-zinc-200",
                    ].join(" ")}
                    onClick={() => setAddMode("recurring")}
                  >
                    Recurring
                  </button>
                  <button
                    type="button"
                    className={[
                      "rounded-xl border px-4 py-3 text-xs font-extrabold sm:text-sm",
                      addMode === "one"
                        ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                        : "border-zinc-800 bg-zinc-950/30 text-zinc-200",
                    ].join(" ")}
                    onClick={() => setAddMode("one")}
                  >
                    One-time
                  </button>
                </div>

                {addMode === "one" ? (
                  <div className="grid gap-3">
                    <input
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 sm:text-base"
                      placeholder="What do you need to do?"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />

                    <button
                      className="rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white disabled:opacity-60 sm:text-base"
                      onClick={() => void addOneTime()}
                      disabled={busy || title.trim().length === 0}
                      type="button"
                    >
                      {busy ? "Adding..." : "Add one-time"}
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <input
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 sm:text-base"
                      placeholder="Recurring to-do title"
                      value={recTitle}
                      onChange={(e) => setRecTitle(e.target.value)}
                    />

                    <div className="grid gap-2">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300 sm:text-sm">Type</div>
                      <div className="flex gap-2">
                        {(["daily", "weekly", "monthly"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={[
                              "flex-1 rounded-xl border px-3 py-2 text-xs font-extrabold sm:text-sm",
                              recType === t
                                ? "border-violet-500 bg-violet-600/40 text-zinc-50"
                                : "border-zinc-800 bg-zinc-950/30 text-zinc-200",
                            ].join(" ")}
                            onClick={() => setRecType(t)}
                          >
                            {t[0].toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300 sm:text-sm">Starts</div>
                      <input
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm font-semibold text-zinc-100 sm:text-base"
                        type="date"
                        value={recStart}
                        onChange={(e) => setRecStart(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-2">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300 sm:text-sm">Every</div>
                      <div className="flex items-center gap-2">
                        <input
                          className="w-24 rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm font-semibold text-zinc-100 sm:text-base"
                          type="number"
                          min={1}
                          value={recInterval}
                          onChange={(e) => setRecInterval(Math.max(1, Number(e.target.value || 1)))}
                        />
                        <div className="flex items-center text-sm font-extrabold text-zinc-300">
                          {recType === "daily" ? "day(s)" : recType === "weekly" ? "week(s)" : "month(s)"}
                        </div>
                      </div>
                    </div>

                    {recType === "weekly" && (
                      <div className="grid gap-2">
                        <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300 sm:text-sm">On</div>
                        <div className="flex flex-wrap gap-2">
                          {weekdays.map((w) => {
                            const active = recWeekDays.includes(w.value);
                            return (
                              <button
                                key={w.value}
                                type="button"
                                className={[
                                  "rounded-xl border px-3 py-2 text-xs font-extrabold sm:text-sm",
                                  active
                                    ? "border-violet-500 bg-violet-600/40 text-zinc-50"
                                    : "border-zinc-800 bg-zinc-950/30 text-zinc-200",
                                ].join(" ")}
                                onClick={() => {
                                  setRecWeekDays((prev) => {
                                    if (prev.includes(w.value)) return prev.filter((x) => x !== w.value);
                                    return [...prev, w.value].sort((a, b) => a - b);
                                  });
                                }}
                              >
                                {w.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-2">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300 sm:text-sm">Ends</div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={[
                            "flex-1 rounded-xl border px-3 py-2 text-xs font-extrabold sm:text-sm",
                            recEndType === "never"
                              ? "border-violet-500 bg-violet-600/40 text-zinc-50"
                              : "border-zinc-800 bg-zinc-950/30 text-zinc-200",
                          ].join(" ")}
                          onClick={() => setRecEndType("never")}
                        >
                          Never
                        </button>
                        <button
                          type="button"
                          className={[
                            "flex-1 rounded-xl border px-3 py-2 text-xs font-extrabold sm:text-sm",
                            recEndType === "onDate"
                              ? "border-violet-500 bg-violet-600/40 text-zinc-50"
                              : "border-zinc-800 bg-zinc-950/30 text-zinc-200",
                          ].join(" ")}
                          onClick={() => setRecEndType("onDate")}
                        >
                          On date
                        </button>
                      </div>

                      {recEndType === "onDate" && (
                        <input
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm font-semibold text-zinc-100 sm:text-base"
                          type="date"
                          value={recEndDate}
                          onChange={(e) => setRecEndDate(e.target.value)}
                        />
                      )}
                    </div>

                    <button
                      className="rounded-xl bg-violet-600 py-3 text-sm font-extrabold text-white disabled:opacity-60 sm:text-base"
                      onClick={() => void addSeries()}
                      disabled={busy || recTitle.trim().length === 0}
                      type="button"
                    >
                      {busy ? "Adding..." : "Add recurring"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
