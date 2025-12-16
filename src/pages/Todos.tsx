import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";

type Todo = {
  id: string;
  title: string;
  dueDate: string;
  createdAt?: any;
  completedBy?: Record<string, boolean>;
};

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toMillis(ts: any) {
  return ts?.toMillis?.() ?? 0;
}

export default function Todos() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";

  const [selectedDate, setSelectedDate] = useState(todayYMD);
  const [items, setItems] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const todosCol = useMemo(() => collection(db, "todos"), []);

  // Mark todos as seen when opening this page
  useEffect(() => {
    if (!uid) return;
    updateDoc(doc(db, "users", uid), { "lastSeen.todos": serverTimestamp() }).catch(() => {});
  }, [uid]);

  // Live query for selected date (no orderBy to avoid composite index requirement)
  useEffect(() => {
    if (!selectedDate) return;

    const q = query(todosCol, where("dueDate", "==", selectedDate));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Todo[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: String(data.title ?? ""),
            dueDate: String(data.dueDate ?? ""),
            createdAt: data.createdAt,
            completedBy: (data.completedBy as Record<string, boolean> | undefined) ?? {},
          };
        });

        // sort client-side by createdAt
        next.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        setItems(next);
        setErr(null);
      },
      (e) => {
        setErr(e?.message ?? "Failed to load to-dos");
      },
    );

    return () => unsub();
  }, [todosCol, selectedDate]);

  async function addTodo() {
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
        completedBy: {},
      });
      setTitle("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add to-do");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDone(todo: Todo) {
    if (!uid) return;
    setErr(null);

    const ref = doc(db, "todos", todo.id);
    const isDone = !!todo.completedBy?.[uid];

    try {
      await updateDoc(ref, {
        [`completedBy.${uid}`]: !isDone,
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update to-do");
    }
  }

  async function removeTodo(id: string) {
    setErr(null);
    try {
      await deleteDoc(doc(db, "todos", id));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete to-do");
    }
  }

  const remaining = items.filter((t) => !t.completedBy?.[uid]).length;

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
        {items.length === 0 && (
          <div className="rounded-2xl border bg-white p-4 text-base font-medium text-zinc-600">
            No to-dos for this date.
          </div>
        )}

        {items.map((t) => {
          const done = !!t.completedBy?.[uid];

          return (
            <div
              key={t.id}
              className={`rounded-2xl border p-4 shadow-sm ${
                done ? "bg-emerald-50 border-emerald-200" : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <button className="flex flex-1 items-start gap-3 text-left" onClick={() => void toggleDone(t)}>
                  <span
                    className={`mt-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border text-lg font-extrabold ${
                      done ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-zinc-400"
                    }`}
                  >
                    {done ? "✓" : ""}
                  </span>

                  <span className={`text-lg font-extrabold ${done ? "text-emerald-900" : "text-zinc-900"}`}>
                    {t.title}
                  </span>
                </button>

                <button
                  className="rounded-xl border px-3 py-2 text-base font-bold text-zinc-900"
                  onClick={() => void removeTodo(t.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border bg-zinc-50 p-4">
        <div className="text-lg font-extrabold text-zinc-900">Add to-do</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border px-4 py-4 text-base"
            placeholder="What do you need to do?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button
            className="rounded-xl bg-emerald-600 py-4 text-base font-extrabold text-white disabled:opacity-60"
            onClick={() => void addTodo()}
            disabled={busy || title.trim().length === 0 || !selectedDate}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
