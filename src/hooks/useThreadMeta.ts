import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";

type ThreadMeta = {
  lastMessageAt?: any;
};

export default function useThreadMeta() {
  const [meta, setMeta] = useState<ThreadMeta | null>(null);

  useEffect(() => {
    const ref = doc(db, "threads", "main");
    const unsub = onSnapshot(ref, (snap) => setMeta((snap.data() as ThreadMeta) ?? null));
    return () => unsub();
  }, []);

  return meta;
}
