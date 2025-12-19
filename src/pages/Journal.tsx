import { useMemo, useState } from "react";
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

export default function Journal() {
  const [selectedDate, setSelectedDate] = useState(ymdToday);

  const pretty = useMemo(() => {
    const dt = ymdToDate(selectedDate);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }, [selectedDate]);

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight text-zinc-50">Daily Journal</h1>
      <p className="mt-1 text-base font-semibold text-zinc-300">Autosave is on</p>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
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

          <div className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-4 text-center text-base font-extrabold text-zinc-100">
            {pretty}
          </div>

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

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-base font-extrabold text-zinc-100">Entry</div>
        <textarea
          className="mt-3 h-[50dvh] w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950/30 p-4 text-base font-semibold text-zinc-100 placeholder:text-zinc-500"
          placeholder="Write here…"
        />
      </div>
    </div>
  );
}
