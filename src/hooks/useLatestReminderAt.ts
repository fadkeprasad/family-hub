import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import useAuthUser from "./useAuthUser";

export default function useLatestReminderAt(ownerUid?: string) {
  const { user } = useAuthUser();
  const myUid = user?.uid ?? "";

  const targetUid = ownerUid || myUid;

  const [latestAt, setLatestAt] = useState<any>(null);

  useEffect(() => {
    if (!targetUid) {
      setLatestAt(null);
      return;
    }

    const q = query(
      collection(db, "reminders"),
      where("ownerUid", "==", targetUid),
      orderBy("updatedAt", "desc"),
      limit(1),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const doc0 = snap.docs[0];
        setLatestAt(doc0 ? (doc0.data() as any).updatedAt : null);
      },
      () => setLatestAt(null),
    );

    return () => unsub();
  }, [targetUid]);

  return latestAt;
}
