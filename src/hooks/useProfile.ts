import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import useAuthUser from "./useAuthUser";

export type Profile = {
  role?: "prasad" | "anjali";
  displayName?: string;
  lastSeen?: {
    messages?: any;
    todos?: any;
    reminders?: any;
    people?: any;
  };
};

export default function useProfile() {
  const { user } = useAuthUser();
  const uid = user?.uid;

  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!uid) return;

    const ref = doc(db, "users", uid);
    const unsub = onSnapshot(ref, (snap) => {
      setProfile((snap.data() as Profile) ?? null);
    });

    return () => unsub();
  }, [uid]);

  return { uid: uid ?? "", profile };
}
