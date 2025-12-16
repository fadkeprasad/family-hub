import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";

type Reminder = {
  id: string;
  text: string;
  expiresAt: any;
  createdAt?: any;
  updatedAt?: any;
};

function parseDateToEndOfDay(dateStr: string) {
  // dateStr is "YYYY-MM-DD"
  // end of day local time, so it lasts through that date
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
}

export default function Reminders() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";

  const [items, setItems] = useState<Reminder[]>([]);
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState(() => {
    const dt = new Date();
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [busy, setBusy] = useState(false);

  const remindersCol = useMemo(() => collection(db, "reminders"), []);

  // Mark reminders as seen when opening this page
  useEffect(() => {
    if (!uid) return;
    updateDoc(doc(db, "users", uid), { "lastSeen.reminders": serverTimestamp() }).catch(() => {});
  }, [uid]);

  // Live list
  useEffect(() => {
    const q = query(remindersCol, orderBy("expiresAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const next: Reminder[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          text: String(data.text ?? ""),
          expiresAt: data.expiresAt,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
      setItems(next);
    });
    return () => unsub();
  }, [remindersCol]);

  async function addReminder() {
    const trimmed = text.trim();
    if (!trimmed || !uid) return;

    setBusy(true);
    try {
      const endOfDay = parseDateToEndOfDay(expiry);
      await addDoc(remindersCol, {
        text: trimmed,
        expiresAt: Timestamp.fromDate(endOfDay),
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setText("");
    } finally {
      setBusy(false);
    }
  }

  async function removeReminder(id: string) {
    await deleteDoc(doc(db, "reminders", id));
  }

  function isExpired(expiresAt: any) {
    const ms = expiresAt?.toMillis?.() ?? 0;
    return ms > 0 && ms < Date.now();
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-zinc-900">Reminders</h1>
      <p className="mt-1 text-base font-medium text-zinc-700">Add reminders with an expiry date.</p>

      <div className="mt-5 grid gap-3">
        {items.length === 0 && (
          <div className="rounded-2xl border bg-zinc-50 p-4 text-base font-medium text-zinc-600">
            No reminders yet.
          </div>
        )}

        {items.map((r) => {
          const expired = isExpired(r.expiresAt);
          const dateLabel =
            r.expiresAt?.toDate?.() instanceof Date
              ? r.expiresAt.toDate().toLocaleDateString()
              : "";

          return (
            <div key={r.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-extrabold text-zinc-900">{r.text}</div>
                  <div className="mt-1 text-base font-semibold text-zinc-700">
                    Expires: {dateLabel}{" "}
                    {expired && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-sm font-extrabold text-red-700">Expired</span>}
                  </div>
                </div>

                <button
                  className="rounded-xl border px-3 py-2 text-base font-bold text-zinc-900"
                  onClick={() => removeReminder(r.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border bg-zinc-50 p-4">
        <div className="text-lg font-extrabold text-zinc-900">Add reminder</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border px-4 py-4 text-base"
            placeholder="Reminder text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="grid gap-2">
            <div className="text-base font-bold text-zinc-800">Expiry date</div>
            <input
              className="w-full rounded-xl border px-4 py-4 text-base"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>

          <button
            className="rounded-xl bg-violet-700 py-4 text-base font-extrabold text-white disabled:opacity-60"
            onClick={addReminder}
            disabled={busy || text.trim().length === 0 || !expiry}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
