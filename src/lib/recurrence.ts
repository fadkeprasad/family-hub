import { diffDays, monthsDiff, nthWeekdayOfMonth, startOfWeek, ymdToDate } from "./dateUtil";

export type SeriesPattern =
  | { type: "daily"; interval: number }
  | { type: "weekly"; interval: number; daysOfWeek: number[] } // 0..6
  | {
      type: "monthly";
      interval: number;
      monthlyMode: "dayOfMonth" | "nthWeekday";
      dayOfMonth?: number; // 1..31
      nth?: number; // 1..4 or -1
      weekday?: number; // 0..6
    };

export type SeriesEnd =
  | { type: "never" }
  | { type: "onDate"; endDate: string };

export type TodoSeries = {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  end: SeriesEnd;
  pattern: SeriesPattern;
  active: boolean;
};

function isWithinEnd(dateYmd: string, end: SeriesEnd) {
  if (end.type === "never") return true;
  return dateYmd <= end.endDate;
}

export function occursOn(series: TodoSeries, dateYmd: string) {
  if (!series.active) return false;
  if (dateYmd < series.startDate) return false;
  if (!isWithinEnd(dateYmd, series.end)) return false;

  const start = ymdToDate(series.startDate);
  const target = ymdToDate(dateYmd);

  if (series.pattern.type === "daily") {
    const d = diffDays(target, start);
    return d >= 0 && d % Math.max(1, series.pattern.interval) === 0;
  }

  if (series.pattern.type === "weekly") {
    const interval = Math.max(1, series.pattern.interval);
    const swStart = startOfWeek(start);
    const swTarget = startOfWeek(target);
    const weeks = Math.floor(diffDays(swTarget, swStart) / 7);
    if (weeks < 0 || weeks % interval !== 0) return false;
    return series.pattern.daysOfWeek.includes(target.getDay());
  }

  // monthly
  const interval = Math.max(1, series.pattern.interval);
  const m = monthsDiff(target, start);
  if (m < 0 || m % interval !== 0) return false;

  const y = target.getFullYear();
  const month0 = target.getMonth();

  if (series.pattern.monthlyMode === "dayOfMonth") {
    const dom = series.pattern.dayOfMonth ?? 1;
    return target.getDate() === dom;
  }

  const nth = series.pattern.nth ?? 1;
  const weekday = series.pattern.weekday ?? 1;
  const dt = nthWeekdayOfMonth(y, month0, weekday, nth);
  if (!dt) return false;
  return dt.getTime() === target.getTime();
}
