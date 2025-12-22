import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { ymdToday } from "../lib/dateUtil";
import type { SeriesEnd, SeriesPattern, TodoSeries } from "../lib/recurrence";
import { occursOn } from "../lib/recurrence";
import useAuthUser from "./useAuthUser";

type OneTodo = {
  completed?: boolean;
  completedBy?: Record<string, boolean>;
};

function legacyDoneFromMap(m?: Record<string, boolean>) {
  if (!m) return false;
  return Object.values(m).some(Boolean);
}

export default function useTodoTodayRemaining(ownerUid?: string) {
  const { user } = useAuthUser();
  const myUid = user?.uid ?? "";
  const targetUid = ownerUid || myUid;

  const date = ymdToday();

  const [oneTodos, setOneTodos] = useState<OneTodo[]>([]);
  const [series, setSeries] = useState<TodoSeries[]>([]);
  const [seriesDoneMap, setSeriesDoneMap] = useState<Record<string, boolean>>({});

  const todosCol = useMemo(() => collection(db, "todos"), []);
  const seriesCol = useMemo(() => collection(db, "todoSeries"), []);

  useEffect(() => {
    if (!targetUid) {
      setOneTodos([]);
      return;
    }

    const q = query(
      todosCol,
      where("ownerUid", "==", targetUid),
      where("dueDate", "==", date),
    );

    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          completed: typeof data.completed === "boolean" ? data.completed : undefined,
          completedBy: data.completedBy as Record<string, boolean> | undefined,
        };
      });
      setOneTodos(next);
    });

    return () => unsub();
  }, [todosCol, targetUid, date]);

  useEffect(() => {
    if (!targetUid) {
      setSeries([]);
      return;
    }

    const q = query(seriesCol, where("ownerUid", "==", targetUid));

    const unsub = onSnapshot(q, (snap) => {
      const next: TodoSeries[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: String(data.title ?? ""),
          startDate: String(data.startDate ?? "1970-01-01"),
          end: (data.end as SeriesEnd) ?? { type: "never" },
          pattern: (data.pattern as SeriesPattern) ?? { type: "daily", interval: 1 },
          active: data.active !== false,
        } as TodoSeries;
      });
      setSeries(next);
    });

    return () => unsub();
  }, [seriesCol, targetUid]);

  const seriesForDay = useMemo(
    () => series.filter((s) => s.active !== false).filter((s) => occursOn(s, date)),
    [series, date],
  );

  useEffect(() => {
    if (!targetUid) {
      setSeriesDoneMap({});
      return;
    }

    setSeriesDoneMap({});
    if (seriesForDay.length === 0) return;

    const unsubs: Array<() => void> = [];

    for (const s of seriesForDay) {
      const ref = doc(db, "todoSeriesCompletions", `${s.id}_${date}`);

      const unsub = onSnapshot(
        ref,
        (snap) => {
          const data = snap.exists() ? (snap.data() as any) : null;
          const done =
            typeof data?.completed === "boolean"
              ? !!data.completed
              : legacyDoneFromMap(data?.completedBy);

          setSeriesDoneMap((prev) => ({ ...prev, [s.id]: done }));
        },
        () => {
          setSeriesDoneMap((prev) => ({ ...prev, [s.id]: false }));
        },
      );

      unsubs.push(unsub);
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [targetUid, date, seriesForDay]);

  const oneRemaining =
    oneTodos.filter((t) => {
      const done =
        typeof t.completed === "boolean" ? !!t.completed : legacyDoneFromMap(t.completedBy);
      return !done;
    }).length;

  const seriesRemaining = seriesForDay.filter((s) => !seriesDoneMap[s.id]).length;

  return oneRemaining + seriesRemaining;
}
