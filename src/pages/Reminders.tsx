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
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";
import { useView } from "../contexts/ViewContext";

type Reminder = {
  id: string;
  text: string;
  expiresAt: any;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
};

function parseDateToEndOfDay(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
}

function formatYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isExpired(expiresAt: any) {
  const dt: Date | null =
    expiresAt?.toDate?.() instanceof Date ? expiresAt.toDate() : expiresAt instanceof Date ? expiresAt : null;
  if (!dt) return false;
  return dt.getTime() < Date.now();
}

export default function Reminders() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";

  const { activeOwnerUid, isMyView } = useView();
  const ownerUid = activeOwnerUid || uid;
  const canEdit = isMyView;

  const remindersCol = useMemo(() => collection(db, "reminders"), []);

  const [items, setItems] = useState<Reminder[]>([]);
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState(() => formatYmd(new Date()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Mark seen for badges (only in "My view")
  useEffect(() => {
    if (!uid || !canEdit) return;
    updateDoc(doc(db, "users", uid), { "lastSeen.reminders": serverTimestamp() }).catch(() => {});
  }, [uid, canEdit]);

  // Load reminders for the active view
  useEffect(() => {
    if (!uid || !ownerUid) {
      setItems([]);
      return;
    }

    const q = query(remindersCol, where("ownerUid", "==", ownerUid), orderBy("expiresAt", "asc"));
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
            createdBy: data.createdBy,
          };
        });
        setItems(next);
        setErr(null);
      },
      (e) => setErr(e?.message ?? "Failed to load reminders"),
    );

    return () => unsub();
  }, [uid, ownerUid, remindersCol]);

  async function addReminder() {
    const trimmed = text.trim();
    if (!trimmed || !uid || !canEdit) return;

    setBusy(true);
    setErr(null);
    try {
      const end = parseDateToEndOfDay(expiry);
      await addDoc(remindersCol, {
        ownerUid: uid,
        text: trimmed,
        expiresAt: Timestamp.fromDate(end),
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
    if (!uid || !canEdit) return;
    setErr(null);
    try {
      await deleteDoc(doc(db, "reminders", id));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete reminder");
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight text-zinc-50">Reminders</h1>
      <p className="mt-1 text-base font-semibold text-zinc-300">Add reminders with an expiry date.</p>

      {!canEdit && (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-base font-semibold text-zinc-200">
          Read-only view. You cannot edit this user’s data.
        </div>
      )}

      {err && (
        <div className="mt-4 rounded-2xl border border-red-900/40 bg-red-950/40 p-4 text-base font-semibold text-red-200">
          {err}
        </div>
      )}

      <div className="mt-5 grid gap-3">
        {items.length === 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-base font-semibold text-zinc-300">
            No reminders yet.
          </div>
        )}

        {items.map((r) => {
          const expired = isExpired(r.expiresAt);
          const dt: Date | null =
            r.expiresAt?.toDate?.() instanceof Date ? r.expiresAt.toDate() : r.expiresAt instanceof Date ? r.expiresAt : null;

          return (
            <div
              key={r.id}
              className={[
                "rounded-2xl border p-4",
                expired ? "border-zinc-800 bg-zinc-900/30" : "border-violet-900/40 bg-violet-950/20",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-extrabold text-zinc-100">{r.text}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-300">
                    Expires: {dt ? dt.toLocaleDateString() : "Unknown"}
                    {expired ? " (expired)" : ""}
                  </div>
                </div>

                <button
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/30 text-lg text-zinc-100 disabled:opacity-50"
                  type="button"
                  aria-label="Delete reminder"
                  title="Delete"
                  onClick={() => void removeReminder(r.id)}
                  disabled={!canEdit}
                >
                  🗑️
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-lg font-extrabold text-zinc-100">Add reminder</div>

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
              className="rounded-xl bg-violet-600 py-4 text-base font-extrabold text-white disabled:opacity-60"
              onClick={() => void addReminder()}
              disabled={busy || text.trim().length === 0 || !expiry}
              type="button"
            >
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
