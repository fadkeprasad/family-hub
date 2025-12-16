import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";

export default function useLatestReminderAt() {
  const [latestAt, setLatestAt] = useState<any>(null);

  useEffect(() => {
    const q = query(collection(db, "reminders"), orderBy("updatedAt", "desc"), limit(1));
    const unsub = onSnapshot(q, (snap) => {
      const doc0 = snap.docs[0];
      setLatestAt(doc0 ? (doc0.data() as any).updatedAt : null);
    });
    return () => unsub();
  }, []);

  return latestAt;
}
