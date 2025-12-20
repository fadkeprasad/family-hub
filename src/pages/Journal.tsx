import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";
import { ymdToday } from "../lib/dateUtil";

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

type SaveState = "idle" | "saving" | "saved" | "error";

export default function Journal() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";

  const [selectedDate, setSelectedDate] = useState(() => ymdToday());
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Prevent remote snapshots from overwriting while user is typing
  const dirtyRef = useRef(false);
  const lastRemoteTextRef = useRef<string>("");

  const docId = useMemo(() => (uid ? `${uid}_${selectedDate}` : ""), [uid, selectedDate]);
  const docRef = useMemo(() => (docId ? doc(db, "journals", docId) : null), [docId]);

  const pretty = useMemo(() => {
    const dt = ymdToDate(selectedDate);
    return dt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [selectedDate]);

  // Load current day entry (live)
  useEffect(() => {
    if (!docRef) {
      setText("");
      setSaveState("idle");
      dirtyRef.current = false;
      lastRemoteTextRef.current = "";
      return;
    }

    setSaveState("idle");

    const unsub = onSnapshot(
      docRef,
      (snap) => {
        const remoteText = snap.exists() ? String((snap.data() as any).text ?? "") : "";
        lastRemoteTextRef.current = remoteText;

        // Only apply remote updates if user isn't editing locally
        if (!dirtyRef.current) {
          setText(remoteText);
        }
      },
      () => {
        setSaveState("error");
      },
    );

    return () => unsub();
  }, [docRef]);

  async function saveNow(currentText: string) {
    if (!uid || !docRef) return;

    setSaveState("saving");
    try {
      await setDoc(
        docRef,
        {
          ownerUid: uid,
          date: selectedDate,
          text: currentText,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );

      dirtyRef.current = false;
      setSaveState("saved");

      // drop back to idle after a moment so UI doesn’t feel “stuck”
      window.setTimeout(() => {
        setSaveState((s) => (s === "saved" ? "idle" : s));
      }, 900);
    } catch {
      setSaveState("error");
    }
  }

  // Debounced autosave
  useEffect(() => {
    if (!uid || !docRef) return;

    // If text equals last remote text and we're not dirty, do nothing
    if (!dirtyRef.current) return;

    const t = window.setTimeout(() => {
      void saveNow(text);
    }, 500);

    return () => window.clearTimeout(t);
  }, [text, uid, docRef]);

  // Flush on date change/unmount (best-effort)
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      if (!uid || !docRef) return;
      // fire and forget
      void saveNow(text);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, uid, docRef]);

  const statusLabel = useMemo(() => {
    if (!uid) return "Sign in to save";
    if (saveState === "saving") return "Saving…";
    if (saveState === "saved") return "Saved";
    if (saveState === "error") return "Save failed";
    return "Autosave on";
  }, [saveState, uid]);

  return (
    <div className="px-4 pb-24 pt-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50">Journal</h1>
          <p className="mt-1 text-sm font-semibold text-zinc-300">{statusLabel}</p>
        </div>

        <div className="text-right">
          <div className="text-sm font-extrabold text-zinc-100">{pretty}</div>
          <div className="mt-1 text-xs font-semibold text-zinc-400">{selectedDate}</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="text-sm font-extrabold text-zinc-100">Choose date</div>

        <div className="mt-2 flex items-center gap-2">
          <button
            className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-3 text-xl font-extrabold text-zinc-100"
            onClick={() => {
              // flush before switching
              if (dirtyRef.current) void saveNow(text);
              setSelectedDate((d) => addDaysYmd(d, -1));
              dirtyRef.current = false;
            }}
            aria-label="Previous day"
            type="button"
          >
            ‹
          </button>

          <input
            type="date"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-3 text-base font-bold text-zinc-100"
            value={selectedDate}
            onChange={(e) => {
              if (dirtyRef.current) void saveNow(text);
              setSelectedDate(e.target.value);
              dirtyRef.current = false;
            }}
          />

          <button
            className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-3 text-xl font-extrabold text-zinc-100"
            onClick={() => {
              if (dirtyRef.current) void saveNow(text);
              setSelectedDate((d) => addDaysYmd(d, 1));
              dirtyRef.current = false;
            }}
            aria-label="Next day"
            type="button"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-sm font-extrabold text-zinc-100">Entry</div>

        <textarea
          className="mt-3 h-[50dvh] w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base font-semibold text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
          placeholder="Write here…"
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);

            // Mark dirty only if it differs from the last remote text
            dirtyRef.current = next !== lastRemoteTextRef.current;
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
