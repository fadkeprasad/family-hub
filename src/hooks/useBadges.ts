import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import useProfile from "./useProfile";
import useLatestReminderAt from "./useLatestReminderAt";
import useTodoTodayRemaining from "./useTodoTodayRemaining";
import { useView } from "../contexts/ViewContext";
import useAuthUser from "./useAuthUser";
import { db } from "../lib/firebase";

function toMillis(ts: any): number {
  return ts?.toMillis?.() ?? 0;
}

export default function useBadges() {
  const { myUid, activeOwnerUid, isMyView } = useView();
  const { user } = useAuthUser();
  const myEmail = (user?.email ?? "").trim().toLowerCase();
  const [followRequests, setFollowRequests] = useState(0);

  const { profile } = useProfile(); // always the signed-in user's profile
  const latestReminderAt = useLatestReminderAt(activeOwnerUid || myUid);
  const todosRemaining = useTodoTodayRemaining(activeOwnerUid || myUid);

  // Only show unread dot in My view, friend view uses 0 to avoid confusion
  const lastSeenReminders = toMillis(profile?.lastSeen?.reminders);
  const lastReminderAt = toMillis(latestReminderAt);

  useEffect(() => {
    if (!myEmail) {
      setFollowRequests(0);
      return;
    }

    const q = query(collection(db, "followRequests"), where("toEmailLower", "==", myEmail));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const count = snap.docs.filter((d) => String((d.data() as any)?.status ?? "") === "pending").length;
        setFollowRequests(count);
      },
      () => setFollowRequests(0),
    );
    return () => unsub();
  }, [myEmail]);

  return {
    todos: todosRemaining,
    reminders: isMyView && lastReminderAt > lastSeenReminders ? 1 : 0,
    journal: 0,
    follow: followRequests,
  };
}
