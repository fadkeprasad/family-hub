export function ymdToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function ymdToDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export function dateToYmd(dt: Date) {
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(dt: Date, days: number) {
  const x = new Date(dt);
  x.setDate(x.getDate() + days);
  return x;
}

export function diffDays(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function startOfWeek(dt: Date) {
  // week starts Sunday
  const x = new Date(dt);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function monthsDiff(a: Date, b: Date) {
  // a - b in months
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
}

export function lastDayOfMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export function nthWeekdayOfMonth(year: number, monthIndex0: number, weekday0: number, nth: number) {
  // nth: 1..4 or -1 for last
  if (nth === -1) {
    const lastDate = new Date(year, monthIndex0 + 1, 0);
    const shift = (lastDate.getDay() - weekday0 + 7) % 7;
    lastDate.setDate(lastDate.getDate() - shift);
    lastDate.setHours(0, 0, 0, 0);
    return lastDate;
  }

  const first = new Date(year, monthIndex0, 1);
  const shift = (weekday0 - first.getDay() + 7) % 7;
  const day = 1 + shift + (nth - 1) * 7;
  const max = lastDayOfMonth(year, monthIndex0);
  if (day > max) return null;
  const dt = new Date(year, monthIndex0, day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
