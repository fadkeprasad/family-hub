import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { ymdToday } from "../lib/dateUtil";
import useAuthUser from "../hooks/useAuthUser";
import useProfile from "../hooks/useProfile";

function useDebouncedCallback<T extends (...args: any[]) => void>(cb: T, delayMs: number) {
  const timer = useRef<number | null>(null);

  return (...args: Parameters<T>) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => cb(...args), delayMs);
  };
}

export default function Journal() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";
  const { profile } = useProfile();
  const userRole = profile?.role; // "prasad" | "anjali" | undefined

  const todayYmd = ymdToday();

  const [date, setDate] = useState<string>(todayYmd);
  const [text, setText] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const isToday = date === todayYmd;
  const isEmpty = text.trim().length === 0;

  const docRef = useMemo(() => doc(db, "journals", date), [date]);

  // Load / live-sync journal text for the selected date
  useEffect(() => {
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        const nextText = String(data?.text ?? "");
        setText(nextText);
        setStatus("idle");
      },
      () => setStatus("error"),
    );
    return () => unsub();
  }, [docRef]);

  const saveDebounced = useDebouncedCallback(async (nextText: string) => {
    if (!uid) return;

    setStatus("saving");
    try {
      await setDoc(
        docRef,
        {
          date,
          text: nextText,
          updatedAt: serverTimestamp(),
          updatedByRole: userRole ?? null,
        },
        { merge: true },
      );
      setStatus("saved");

      window.setTimeout(() => {
        setStatus((s) => (s === "saved" ? "idle" : s));
      }, 900);
    } catch {
      setStatus("error");
    }
  }, 450);

  function onChangeText(v: string) {
    setText(v);
    saveDebounced(v);
  }

  // Optional: Enter adds a bullet if current line starts with "- " style
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;

    const el = e.currentTarget;
    const value = el.value;
    const pos = el.selectionStart ?? value.length;

    const before = value.slice(0, pos);
    const lastLineStart = before.lastIndexOf("\n") + 1;
    const line = before.slice(lastLineStart);

    const bulletPrefix = line.startsWith("- ") ? "- " : line.startsWith("• ") ? "• " : null;
    if (!bulletPrefix) return;

    // if the line is just "- " or "• " then don’t auto insert again
    if (line.trim() === "-" || line.trim() === "•") return;

    e.preventDefault();
    const after = value.slice(pos);
    const next = `${before}\n${bulletPrefix}${after}`;
    onChangeText(next);

    requestAnimationFrame(() => {
      const newPos = pos + 1 + bulletPrefix.length;
      el.selectionStart = newPos;
      el.selectionEnd = newPos;
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-zinc-900">Daily Journal</h1>

            {isToday && isEmpty && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-extrabold text-amber-800">
                Pending
              </span>
            )}

            {isToday && !isEmpty && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-extrabold text-emerald-800">
                Done
              </span>
            )}
          </div>

          <div className="mt-1 text-base font-medium text-zinc-700">
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved"}
            {status === "idle" && "Autosave is on"}
            {status === "error" && "Could not save (check connection / permissions)"}
          </div>
        </div>

        <div className="min-w-[170px]">
          <div className="text-sm font-bold text-zinc-500">Date</div>
          <input
            className="mt-1 w-full rounded-xl border px-3 py-3 text-base font-bold"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-5 rounded-2xl border bg-white p-4">
        <textarea
          className="min-h-[60dvh] w-full resize-none rounded-xl border px-4 py-4 text-lg font-semibold leading-relaxed outline-none"
          placeholder="Write anything… Try starting a line with '- ' for bullets."
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="mt-3 text-sm font-bold text-zinc-600">
        Tip: start a line with <span className="text-zinc-900">- </span> then press Enter to continue bullets.
      </div>
    </div>
  );
}
