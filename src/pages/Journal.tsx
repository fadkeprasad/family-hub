import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc, type DocumentReference } from "firebase/firestore";
import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";
import { useView } from "../contexts/ViewContext";
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

type JournalDoc = {
  ownerUid: string;
  date: string; // YYYY-MM-DD
  text: string;
  updatedAt?: any;
};

export default function Journal() {
  const { user } = useAuthUser();
  const myUid = user?.uid ?? "";
  const { activeOwnerUid, isMyView } = useView();

  // If you have a “view” system (my view vs friend view), set ownerUid accordingly:
  // const ownerUid = viewOwnerUid;
  const ownerUid = activeOwnerUid || myUid;

  const readOnly = !isMyView;

  const [selectedDate, setSelectedDate] = useState(() => ymdToday());
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");

  const pretty = useMemo(() => {
    const dt = ymdToDate(selectedDate);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }, [selectedDate]);

  // --- Refs to prevent cursor jumps on mobile ---
  const focusedRef = useRef(false);
  const composingRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastRemoteTextRef = useRef<string>("");
  const saveTimerRef = useRef<number | null>(null);
  const saveSeqRef = useRef(0);

  function journalDocRef(uid: string, date: string): DocumentReference {
    // Scalable doc id, avoids collisions across users
    return doc(db, "journals", `${uid}_${date}`);
  }

  // Subscribe to remote journal doc (and load into editor safely)
  useEffect(() => {
    if (!ownerUid) return;

    setStatus("loading");
    dirtyRef.current = false;
    lastRemoteTextRef.current = "";

    const ref = journalDocRef(ownerUid, selectedDate);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const remoteText = snap.exists() ? String((snap.data() as any)?.text ?? "") : "";
        lastRemoteTextRef.current = remoteText;

        // Only apply remote updates if user is not actively editing.
        // This is the key to stopping cursor jumps and “random deletes” on mobile.
        if (!readOnly && (focusedRef.current || composingRef.current || dirtyRef.current)) {
          setStatus((s) => (s === "saving" ? "saving" : "idle"));
          return;
        }

        setText(remoteText);
        setStatus("idle");
      },
      () => {
        setStatus("error");
      },
    );

    return () => unsub();
  }, [ownerUid, selectedDate, readOnly]);

  function scheduleSave(nextText: string) {
    if (!myUid || readOnly) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setStatus("saving");

    const seq = ++saveSeqRef.current;

    saveTimerRef.current = window.setTimeout(async () => {
      // If a newer save was scheduled, skip this one.
      if (seq !== saveSeqRef.current) return;

      try {
        const ref = journalDocRef(myUid, selectedDate);
        const payload: JournalDoc = {
          ownerUid: myUid,
          date: selectedDate,
          text: nextText,
          updatedAt: serverTimestamp(),
        };

        await setDoc(ref, payload, { merge: true });

        // Mark clean only if the editor still matches what we saved
        if (seq === saveSeqRef.current) {
          dirtyRef.current = false;
          setStatus("saved");
          window.setTimeout(() => {
            setStatus((s) => (s === "saved" ? "idle" : s));
          }, 800);
        }
      } catch {
        setStatus("error");
      }
    }, 450);
  }

  function onChangeText(next: string) {
    setText(next);

    if (readOnly) return;

    // If remote already equals this, treat as clean
    dirtyRef.current = next !== lastRemoteTextRef.current;
    scheduleSave(next);
  }

  return (
    <div className="px-4 pb-24 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-50">Daily Journal</h1>
          <p className="mt-2 text-base font-semibold text-zinc-300">Write a short entry for the day.</p>
        </div>

        <div className="text-right text-xs font-bold text-zinc-300">
          {status === "loading" && "Loading"}
          {status === "saving" && "Saving"}
          {status === "saved" && "Saved"}
          {status === "error" && "Save error"}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-base font-extrabold text-zinc-100">Choose date</div>

        <div className="mt-3 grid grid-cols-[48px_1fr_48px] items-center gap-3">
          <button
            className="h-12 w-12 rounded-xl border border-zinc-800 bg-zinc-950/30 text-xl font-black text-zinc-100"
            onClick={() => setSelectedDate((d) => addDaysYmd(d, -1))}
            type="button"
          >
            ‹
          </button>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3">
            <div className="text-xs font-bold text-zinc-400">{pretty}</div>
            <input
              className="mt-1 w-full bg-transparent text-base font-extrabold text-zinc-100 outline-none"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          <button
            className="h-12 w-12 rounded-xl border border-zinc-800 bg-zinc-950/30 text-xl font-black text-zinc-100"
            onClick={() => setSelectedDate((d) => addDaysYmd(d, +1))}
            type="button"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-extrabold text-zinc-100">Entry</div>
          {readOnly && <div className="text-xs font-bold text-zinc-400">Read only</div>}
        </div>

        <textarea
          className="mt-3 h-[50dvh] w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-base font-semibold text-zinc-100 placeholder:text-zinc-500 outline-none"
          placeholder="Write here..."
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onBlur={() => {
            focusedRef.current = false;
            // If user leaves the field and it’s dirty, force a final save quickly
            if (!readOnly && dirtyRef.current) scheduleSave(text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          disabled={readOnly || !myUid}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
        />
      </div>
    </div>
  );
}
