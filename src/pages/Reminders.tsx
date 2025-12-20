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
  const [err, setErr] = useState<string | null>(null);

  const remindersCol = useMemo(() => collection(db, "reminders"), []);

  // Mark reminders as seen when opening this page
  useEffect(() => {
    if (!uid) return;
    updateDoc(doc(db, "users", uid), { "lastSeen.reminders": serverTimestamp() }).catch(() => {});
  }, [uid]);

  // Live list (scoped by ownerUid)
  // NOTE: no orderBy here to avoid composite index requirement
  useEffect(() => {
    if (!uid) {
      setItems([]);
      return;
    }

    setErr(null);

    const q = query(remindersCol, where("ownerUid", "==", uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
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

        // sort client-side by expiresAt asc
        next.sort((a, b) => {
          const ams = a.expiresAt?.toMillis?.() ?? 0;
          const bms = b.expiresAt?.toMillis?.() ?? 0;
          return ams - bms;
        });

        setItems(next);
      },
      (e) => {
        setItems([]);
        setErr(e?.message ?? "Failed to load reminders");
      },
    );

    return () => unsub();
  }, [remindersCol, uid]);

  async function addReminder() {
    const trimmed = text.trim();
    if (!trimmed || !uid) return;

    setBusy(true);
    setErr(null);

    try {
      const endOfDay = parseDateToEndOfDay(expiry);

      await addDoc(remindersCol, {
        ownerUid: uid,
        text: trimmed,
        expiresAt: Timestamp.fromDate(endOfDay),
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setText("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add reminder");
    } finally {
      setBusy(false);
    }
  }

  async function removeReminder(id: string) {
    try {
      await deleteDoc(doc(db, "reminders", id));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete reminder");
    }
  }

  function isExpired(expiresAt: any) {
    const ms = expiresAt?.toMillis?.() ?? 0;
    return ms > 0 && ms < Date.now();
  }

  return (
    <div className="px-4 pb-24 pt-4">
      <h1 className="text-3xl font-extrabold tracking-tight text-zinc-50">Reminders</h1>
      <p className="mt-2 text-base font-semibold text-zinc-300">
        Add reminders with an expiry date.
      </p>

      {err && (
        <div className="mt-4 rounded-2xl border border-red-900/40 bg-red-950/40 p-3 text-sm font-semibold text-red-200">
          {err}
        </div>
      )}

      <div className="mt-5 grid gap-3">
        {items.length === 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-base font-semibold text-zinc-200">
            No reminders yet.
          </div>
        )}

        {items.map((r) => {
          const expired = isExpired(r.expiresAt);
          const dateLabel =
            r.expiresAt?.toDate?.() instanceof Date ? r.expiresAt.toDate().toLocaleDateString() : "";

          return (
            <div key={r.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-extrabold text-zinc-50">{r.text}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-300">
                    Expires: {dateLabel}{" "}
                    {expired && (
                      <span className="ml-2 rounded-full bg-red-950/50 px-2 py-0.5 text-xs font-extrabold text-red-200">
                        Expired
                      </span>
                    )}
                  </div>
                </div>

                <button
                  className="rounded-xl border border-zinc-700 bg-zinc-950/30 px-3 py-2 text-sm font-bold text-zinc-100"
                  onClick={() => removeReminder(r.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-lg font-extrabold text-zinc-50">Add reminder</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base font-semibold text-zinc-100 placeholder:text-zinc-500"
            placeholder="Reminder text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="grid gap-2">
            <div className="text-sm font-extrabold text-zinc-100">Expiry date</div>
            <input
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base font-semibold text-zinc-100"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>

          <button
            className="rounded-xl bg-zinc-100 py-4 text-base font-extrabold text-zinc-900 disabled:opacity-60"
            onClick={() => void addReminder()}
            disabled={busy || text.trim().length === 0 || !expiry}
            type="button"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
