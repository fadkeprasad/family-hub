import { collection, collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import useAuthUser from "./useAuthUser";

export type FriendCard = {
  uid: string;
  email: string;
  name: string;
  photoURL: string | null;
  requestId?: string;
};

type FollowingDoc = {
  id: string;
  status?: string;
  toUid?: string;
  toEmailLower?: string;
  toName?: string;
  toPhotoURL?: string | null;
};

type LegacyInviteDoc = {
  id: string;
  status?: string;
  fromUid?: string;
  fromEmail?: string;
  fromName?: string;
  fromPhotoURL?: string | null;
  toEmailLower?: string;
  toUid?: string;
};

function lc(s: string) {
  return (s || "").trim().toLowerCase();
}

export default function useFriendRoster() {
  const { user } = useAuthUser();
  const myUid = user?.uid ?? "";
  const myEmail = lc(user?.email ?? "");
  const [friends, setFriends] = useState<FriendCard[]>([]);

  useEffect(() => {
    if (!myUid) {
      setFriends([]);
      return;
    }

    const followingReqs = query(collection(db, "followRequests"), where("fromUid", "==", myUid));
    const legacyIncoming = myEmail ? query(collection(db, "invites"), where("toEmailLower", "==", myEmail)) : null;
    const legacyShares = query(collectionGroup(db, "friends"), where("friendUid", "==", myUid));

    let followRows: FollowingDoc[] = [];
    let inviteRows: LegacyInviteDoc[] = [];
    let legacyShareOwnerUids = new Set<string>();

    function rebuild() {
      const map = new Map<string, FriendCard>();

      for (const d of followRows) {
        if (d.status !== "accepted") continue;
        const uid = String(d.toUid ?? "");
        if (!uid) continue;
        const email = String(d.toEmailLower ?? "");
        const name = String(d.toName ?? d.toEmailLower ?? "User");
        const photoURL = (d.toPhotoURL ?? null) as string | null;
        map.set(uid, { uid, email, name, photoURL, requestId: d.id });
      }

      for (const d of inviteRows) {
        if (d.status !== "accepted") continue;
        if (d.toUid && String(d.toUid) !== myUid) continue;
        const uid = String(d.fromUid ?? "");
        if (!uid) continue;
        if (!legacyShareOwnerUids.has(uid)) continue;
        const email = String(d.fromEmail ?? "");
        const name = String(d.fromName ?? d.fromEmail ?? "User");
        const photoURL = (d.fromPhotoURL ?? null) as string | null;
        map.set(uid, { uid, email, name, photoURL });
      }

      const arr = Array.from(map.values());
      arr.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
      setFriends(arr);
    }

    const unsubFollow = onSnapshot(
      followingReqs,
      (snap) => {
        followRows = snap.docs.map((x) => ({ id: x.id, ...(x.data() as any) })) as FollowingDoc[];
        rebuild();
      },
      () => {
        followRows = [];
        rebuild();
      },
    );

    const unsubLegacy = legacyIncoming
      ? onSnapshot(legacyIncoming, (snap) => {
          inviteRows = snap.docs.map((x) => ({ id: x.id, ...(x.data() as any) })) as LegacyInviteDoc[];
          rebuild();
        })
      : null;

    const unsubLegacyShares = onSnapshot(legacyShares, (snap) => {
      const next = new Set<string>();
      for (const docSnap of snap.docs) {
        const ownerUid = docSnap.ref.parent.parent?.id ?? "";
        if (ownerUid) next.add(ownerUid);
      }
      legacyShareOwnerUids = next;
      rebuild();
    });

    return () => {
      unsubFollow();
      if (unsubLegacy) unsubLegacy();
      unsubLegacyShares();
    };
  }, [myUid, myEmail]);

  return friends;
}
