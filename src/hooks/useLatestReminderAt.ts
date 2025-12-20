import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import useAuthUser from "./useAuthUser";

export default function useLatestReminderAt() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";

  const [latestAt, setLatestAt] = useState<any>(null);

  useEffect(() => {
    if (!uid) {
      setLatestAt(null);
      return;
    }

    const q = query(
      collection(db, "reminders"),
      where("ownerUid", "==", uid),
      orderBy("updatedAt", "desc"),
      limit(1),
    );

    const unsub = onSnapshot(q, (snap) => {
      const doc0 = snap.docs[0];
      setLatestAt(doc0 ? (doc0.data() as any).updatedAt : null);
    });

    return () => unsub();
  }, [uid]);

  return latestAt;
}
