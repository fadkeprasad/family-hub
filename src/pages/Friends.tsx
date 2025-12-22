import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  deleteDoc,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";
import useFriendRoster, { type FriendCard } from "../hooks/useFriendRoster";
import { useNavigate } from "react-router-dom";
import { useView } from "../contexts/ViewContext";


function lc(s: string) {
  return (s || "").trim().toLowerCase();
}

type ShareFlags = { todos: boolean; reminders: boolean; journals: boolean };

const DEFAULT_SHARE: ShareFlags = { todos: true, reminders: true, journals: true };

type FollowRequestRow = {
  id: string;
  status?: "pending" | "accepted" | "declined" | "revoked";
  fromEmail?: string;
  fromUid?: string;
  fromName?: string;
  fromPhotoURL?: string | null;
  toEmail?: string;
  toUid?: string;
  toName?: string;
  toPhotoURL?: string | null;
  share?: ShareFlags;
  createdAt?: any;
} & Record<string, any>;

type FollowerRow = {
  id: string;
  source?: "followers" | "shares" | "request";
  followerUid?: string;
  followerEmail?: string;
  followerName?: string;
  followerPhotoURL?: string | null;
  ownerUid?: string;
  ownerEmail?: string;
  ownerName?: string;
  ownerPhotoURL?: string | null;
  status?: "accepted";
  share?: ShareFlags;
} & Record<string, any>;

export default function Friends() {
  const nav = useNavigate();
  const { user } = useAuthUser();
  const myUid = user?.uid ?? "";
  const myEmail = lc(user?.email ?? "");
  const myName = String((user as any)?.displayName ?? "");
  const myPhotoURL = ((user as any)?.photoURL ?? null) as string | null;

  const { setOwnerView } = useView();

  const following = useFriendRoster();

  const requestsCol = useMemo(() => collection(db, "followRequests"), []);
  const [incoming, setIncoming] = useState<FollowRequestRow[]>([]);
  const [acceptedIncoming, setAcceptedIncoming] = useState<FollowRequestRow[]>([]);
  const [sent, setSent] = useState<FollowRequestRow[]>([]);
  const [followersNew, setFollowersNew] = useState<FollowerRow[]>([]);
  const [followersLegacy, setFollowersLegacy] = useState<FollowerRow[]>([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load incoming requests (filter status client-side to avoid indexes)
  useEffect(() => {
    if (!myEmail) {
      setIncoming([]);
      return;
    }
    const qIn = query(requestsCol, where("toEmailLower", "==", myEmail));
    const unsub = onSnapshot(
      qIn,
      (snap) => {
        const rows: FollowRequestRow[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        setIncoming(rows.filter((r) => r.status === "pending"));
        setAcceptedIncoming(rows.filter((r) => r.status === "accepted"));
      },
      (e) => setErr(e?.message ?? "Failed to load requests"),
    );
    return () => unsub();
  }, [requestsCol, myEmail]);

  // Load sent requests (filter client-side)
  useEffect(() => {
    if (!myUid) {
      setSent([]);
      return;
    }
    const qOut = query(requestsCol, where("fromUid", "==", myUid));
    const unsub = onSnapshot(
      qOut,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSent(rows);
      },
      (e) => setErr(e?.message ?? "Failed to load sent requests"),
    );
    return () => unsub();
  }, [requestsCol, myUid]);

  // Load followers (people who can view me)
  useEffect(() => {
    if (!myUid) {
      setFollowersNew([]);
      return;
    }

    const followersCol = collection(db, "followers", myUid, "accepted");
    const unsub = onSnapshot(
      followersCol,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FollowerRow[];
        const accepted = rows
          .filter((d) => d.status === "accepted")
          .map((d) => ({ ...d, source: "followers" as const }));
        setFollowersNew(accepted);
      },
      (e) => setErr(e?.message ?? "Failed to load followers"),
    );
    return () => unsub();
  }, [myUid]);

  // Load legacy shares (people who can view me from old data)
  useEffect(() => {
    if (!myUid) {
      setFollowersLegacy([]);
      return;
    }

    const legacyCol = collection(db, "shares", myUid, "friends");
    const unsub = onSnapshot(
      legacyCol,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FollowerRow[];
        const accepted = rows
          .filter((d) => d.status === "accepted")
          .map((d) => ({
            ...d,
            source: "shares" as const,
            followerUid: String((d as any).friendUid ?? d.followerUid ?? ""),
            followerEmail: String((d as any).friendEmail ?? d.followerEmail ?? ""),
            followerName: String((d as any).friendName ?? d.followerName ?? "Follower"),
            followerPhotoURL: ((d as any).friendPhotoURL ?? d.followerPhotoURL ?? null) as string | null,
          }));
        setFollowersLegacy(accepted);
      },
      (e) => setErr(e?.message ?? "Failed to load legacy shares"),
    );
    return () => unsub();
  }, [myUid]);

  const followers = useMemo(() => {
    const map = new Map<string, FollowerRow>();
    for (const d of followersLegacy) {
      const key = String(d.followerUid ?? "");
      if (key) map.set(key, d);
    }
    for (const d of acceptedIncoming) {
      const key = String(d.fromUid ?? "");
      if (!key) continue;
      map.set(key, {
        id: d.id,
        source: "request",
        followerUid: key,
        followerEmail: String(d.fromEmail ?? ""),
        followerName: String(d.fromName ?? d.fromEmail ?? "Follower"),
        followerPhotoURL: (d.fromPhotoURL ?? null) as string | null,
        status: "accepted",
        share: (d.share ?? DEFAULT_SHARE) as ShareFlags,
      });
    }
    for (const d of followersNew) {
      const key = String(d.followerUid ?? "");
      if (key) map.set(key, d);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) =>
      String(a.followerName ?? a.followerEmail ?? "").localeCompare(String(b.followerName ?? b.followerEmail ?? "")),
    );
    return arr;
  }, [followersLegacy, followersNew]);



async function sendFollowRequest() {
  setErr(null);

  const myUid = auth.currentUser?.uid ?? "";
  const myEmailRaw = auth.currentUser?.email ?? "";
  const myEmail = lc(myEmailRaw);

  if (!myUid || !myEmail) {
    setErr("You must be signed in.");
    return;
  }

  const toEmailLower = lc(inviteEmail);
  if (!toEmailLower) {
    setErr("Enter an email");
    return;
  }
  if (toEmailLower === myEmail) {
    setErr("You cannot follow yourself");
    return;
  }

  // IMPORTANT: requestId must be "{fromUid}_{toEmailLower}"
  const requestId = `${myUid}_${toEmailLower}`;
  const ref = doc(db, "followRequests", requestId);

  setBusy(true);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const d = existing.data() as any;
      const status = String(d.status ?? "");
      if (status === "pending") {
        setErr("Request already sent and pending");
        return;
      }

      const directorySnap = await getDocs(
        query(collection(db, "userDirectory"), where("emailLower", "==", toEmailLower)),
      );
      if (directorySnap.empty) {
        setErr("That account hasn’t joined yet. Ask them to sign in once, then try again.");
        return;
      }

      await updateDoc(ref, {
        status: "pending",
        fromEmail: myEmailRaw,
        fromName: myName || myEmailRaw,
        fromPhotoURL: myPhotoURL ?? auth.currentUser?.photoURL ?? null,
        toUid: null,
        toName: null,
        toPhotoURL: null,
        updatedAt: serverTimestamp(),
      });
    } else {
      const directorySnap = await getDocs(
        query(collection(db, "userDirectory"), where("emailLower", "==", toEmailLower)),
      );
      if (directorySnap.empty) {
        setErr("That account hasn’t joined yet. Ask them to sign in once, then try again.");
        return;
      }

      await setDoc(ref, {
        fromUid: myUid,
        fromEmail: myEmailRaw, // use raw email here
        fromName: myName || myEmailRaw,
        fromPhotoURL: myPhotoURL ?? auth.currentUser?.photoURL ?? null,

        toEmailLower,

        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }


    setInviteEmail("");
  } catch (e: any) {
    setErr(e?.message ?? "Failed to send follow request");
  } finally {
    setBusy(false);
  }
}


  async function revokeRequest(requestId: string) {
    setErr(null);
    try {
      await updateDoc(doc(db, "followRequests", requestId), { status: "revoked", updatedAt: serverTimestamp() });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to revoke request");
    }
  }

  async function declineRequest(requestId: string) {
    setErr(null);
    try {
      await updateDoc(doc(db, "followRequests", requestId), { status: "declined", updatedAt: serverTimestamp() });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to decline request");
    }
  }

  async function acceptRequest(inv: FollowRequestRow) {
    setErr(null);
    if (!myUid || !myEmail) return;

    const fromUid = String(inv.fromUid ?? "");

    if (!fromUid) {
      setErr("Malformed request");
      return;
    }

    setBusy(true);
    try {
      // 1) Mark request accepted with recipient identity
      await updateDoc(doc(db, "followRequests", inv.id), {
        status: "accepted",
        toUid: myUid,
        toName: myName || myEmail,
        toPhotoURL: myPhotoURL,
        share: DEFAULT_SHARE,
        updatedAt: serverTimestamp(),
      });

      // 2) Create follower doc so the requester can view my data
      await setDoc(doc(db, "followers", myUid, "accepted", fromUid), {
        ownerUid: myUid,
        ownerEmail: myEmail,
        ownerName: myName || myEmail,
        ownerPhotoURL: myPhotoURL,
        followerUid: fromUid,
        followerEmail: String(inv.fromEmail ?? ""),
        followerName: String(inv.fromName ?? inv.fromEmail ?? "Follower"),
        followerPhotoURL: (inv.fromPhotoURL ?? null) as string | null,
        status: "accepted",
        share: DEFAULT_SHARE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Optional: requester must send their own request to be followed back.
    } catch (e: any) {
      setErr(e?.message ?? "Failed to accept request");
    } finally {
      setBusy(false);
    }
  }

  async function updateFollowerShare(follower: FollowerRow, flags: ShareFlags) {
    setErr(null);
    if (!myUid) return;

    try {
      const followerUid = String(follower.followerUid ?? "");
      if (!followerUid) return;
      if (follower.source === "shares") {
        await updateDoc(doc(db, "shares", myUid, "friends", followerUid), {
          share: flags,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      const updates = [
        updateDoc(doc(db, "followers", myUid, "accepted", followerUid), {
          share: flags,
          updatedAt: serverTimestamp(),
        }).catch(() => {}),
      ];

      const requestId =
        follower.source === "request" ? follower.id : myEmail ? `${followerUid}_${myEmail}` : "";
      if (requestId) {
        updates.push(
          updateDoc(doc(db, "followRequests", requestId), {
            share: flags,
            updatedAt: serverTimestamp(),
          }).catch(() => {}),
        );
      }

      await Promise.all(updates);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update sharing");
    }
  }

  async function removeFollower(follower: FollowerRow) {
    setErr(null);
    if (!myUid) return;
    const followerUid = String(follower.followerUid ?? "");
    if (!followerUid) return;

    try {
      if (follower.source === "shares") {
        await deleteDoc(doc(db, "shares", myUid, "friends", followerUid));
        return;
      }

      const updates = [
        deleteDoc(doc(db, "followers", myUid, "accepted", followerUid)).catch(() => {}),
      ];

      const requestId =
        follower.source === "request" ? follower.id : myEmail ? `${followerUid}_${myEmail}` : "";
      if (requestId) {
        updates.push(
          updateDoc(doc(db, "followRequests", requestId), {
            status: "declined",
            updatedAt: serverTimestamp(),
          }).catch(() => {}),
        );
      }

      await Promise.all(updates);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to remove follower");
    }
  }

  async function stopFollowing(ownerUid: string, requestId?: string) {
    setErr(null);
    if (!myUid) return;
    if (!ownerUid) return;

    try {
      let deleted = false;
      if (requestId) {
        try {
          await updateDoc(doc(db, "followRequests", requestId), { status: "revoked", updatedAt: serverTimestamp() });
          deleted = true;
        } catch {}
      } else {
        try {
          const reqSnap = await getDocs(
            query(collection(db, "followRequests"), where("fromUid", "==", myUid), where("toUid", "==", ownerUid)),
          );
          for (const docSnap of reqSnap.docs) {
            await updateDoc(docSnap.ref, { status: "revoked", updatedAt: serverTimestamp() });
            deleted = true;
          }
        } catch {}
      }

      try {
        await deleteDoc(doc(db, "followers", ownerUid, "accepted", myUid));
        deleted = true;
      } catch {}

      try {
        await deleteDoc(doc(db, "shares", ownerUid, "friends", myUid));
        deleted = true;
      } catch {}

      if (!deleted) {
        throw new Error("No follow record to remove");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to unfollow");
    }
  }

  return (
    <div className="px-3 pb-24 pt-4 sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50 sm:text-3xl">Follow</h1>
          <p className="mt-2 text-sm font-semibold text-zinc-300 sm:text-base">
            Request access to view a hub. People you approve can view your hub.
          </p>
        </div>

        <button
          className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm font-extrabold text-zinc-100"
          onClick={() => nav(-1)}
          type="button"
        >
          Back
        </button>
      </div>

      {err && (
        <div className="mt-4 rounded-2xl border border-red-900/40 bg-red-950/40 p-3 text-sm font-semibold text-red-200">
          {err}
        </div>
      )}

      {/* Request to follow */}
      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="text-base font-extrabold text-zinc-50 sm:text-lg">Request to follow</div>

        <div className="mt-3 grid gap-3">
          <input
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm font-semibold text-zinc-100 placeholder:text-zinc-500 sm:text-base"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            spellCheck={false}
            inputMode="email"
          />

          <button
            className="rounded-xl bg-zinc-100 py-3 text-sm font-extrabold text-zinc-900 disabled:opacity-60 sm:text-base"
            onClick={() => void sendFollowRequest()}
            disabled={busy || !inviteEmail.trim()}
            type="button"
          >
            {busy ? "Sending..." : "Send request"}
          </button>
        </div>
      </div>

      {/* Incoming follow requests */}
      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="text-base font-extrabold text-zinc-50 sm:text-lg">Follow requests</div>

        <div className="mt-3 grid gap-3">
          {incoming.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-3 text-sm font-semibold text-zinc-300 sm:text-base">
              No requests.
            </div>
          )}

          {incoming.map((inv) => (
            <div key={inv.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 sm:p-4">
              <div className="text-sm font-extrabold text-zinc-100 sm:text-base">
                {String(inv.fromName ?? inv.fromEmail ?? "User")}
              </div>
              <div className="mt-1 text-xs font-semibold text-zinc-300 sm:text-sm">{String(inv.fromEmail ?? "")}</div>

              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded-xl bg-zinc-100 py-3 text-xs font-extrabold text-zinc-900 disabled:opacity-60 sm:text-sm"
                  onClick={() => void acceptRequest(inv)}
                  disabled={busy}
                  type="button"
                >
                  Accept
                </button>
                <button
                  className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 py-3 text-xs font-extrabold text-zinc-100 disabled:opacity-60 sm:text-sm"
                  onClick={() => void declineRequest(inv.id)}
                  disabled={busy}
                  type="button"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sent requests */}
      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="text-base font-extrabold text-zinc-50 sm:text-lg">Sent requests</div>

        <div className="mt-3 grid gap-3">
          {sent.filter((s) => s.status === "pending").length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-3 text-sm font-semibold text-zinc-300 sm:text-base">
              No pending sent requests.
            </div>
          )}

          {sent
            .filter((s) => s.status === "pending")
            .map((inv) => (
              <div key={inv.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 sm:p-4">
                <div className="text-sm font-extrabold text-zinc-100 sm:text-base">{String(inv.toEmailLower ?? "")}</div>
                <div className="mt-3">
                  <button
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950/30 py-3 text-xs font-extrabold text-zinc-100 sm:text-sm"
                    onClick={() => void revokeRequest(inv.id)}
                    type="button"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Followers */}
      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="text-base font-extrabold text-zinc-50 sm:text-lg">Followers</div>

        <div className="mt-3 grid gap-3">
          {followers.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-3 text-sm font-semibold text-zinc-300 sm:text-base">
              No followers yet.
            </div>
          )}

          {followers.map((f) => (
            <FollowerRow
              key={f.id}
              follower={f}
              onShareChange={updateFollowerShare}
              onRemove={removeFollower}
            />
          ))}
        </div>
      </div>

      {/* Following */}
      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="text-base font-extrabold text-zinc-50 sm:text-lg">Following</div>

        <div className="mt-3 grid gap-3">
          {following.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-3 text-sm font-semibold text-zinc-300 sm:text-base">
              Not following anyone yet.
            </div>
          )}

          {following.map((f) => (
            <FollowingRow
              key={f.uid}
              user={f}
              onView={() => {
                setOwnerView(f.uid);
                nav("/", { replace: true });
              }}
              onUnfollow={() => void stopFollowing(f.uid, f.requestId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FollowerRow({
  follower,
  onShareChange,
  onRemove,
}: {
  follower: FollowerRow;
  onShareChange: (follower: FollowerRow, flags: { todos: boolean; reminders: boolean; journals: boolean }) => Promise<void>;
  onRemove: (follower: FollowerRow) => Promise<void>;
}) {
  const flags = (follower.share ?? DEFAULT_SHARE) as ShareFlags;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-zinc-100 sm:text-base">
            {String(follower.followerName ?? follower.followerEmail ?? "Follower")}
          </div>
          <div className="mt-1 text-xs font-semibold text-zinc-300 sm:text-sm">
            {String(follower.followerEmail ?? "")}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300 sm:text-sm">You share</div>

        <ToggleRow
          label="To-dos"
          value={flags.todos}
          onChange={(v) => void onShareChange(follower, { ...flags, todos: v })}
        />
        <ToggleRow
          label="Reminders"
          value={flags.reminders}
          onChange={(v) => void onShareChange(follower, { ...flags, reminders: v })}
        />
        <ToggleRow
          label="Journals"
          value={flags.journals}
          onChange={(v) => void onShareChange(follower, { ...flags, journals: v })}
        />

        <button
          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950/30 py-3 text-xs font-extrabold text-zinc-100 sm:text-sm"
          onClick={() => void onRemove(follower)}
          type="button"
        >
          Remove follower
        </button>
      </div>
    </div>
  );
}

function FollowingRow({
  user,
  onView,
  onUnfollow,
}: {
  user: FriendCard;
  onView: () => void;
  onUnfollow: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-zinc-100 sm:text-base">{user.name}</div>
          <div className="mt-1 text-xs font-semibold text-zinc-300 sm:text-sm">{user.email}</div>
        </div>

        <button
          className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-extrabold text-zinc-900 sm:text-sm"
          onClick={onView}
          type="button"
        >
          View
        </button>
      </div>

      <button
        className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950/30 py-3 text-xs font-extrabold text-zinc-100 sm:text-sm"
        onClick={onUnfollow}
        type="button"
      >
        Unfollow
      </button>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/20 px-4 py-2">
      <span className="text-sm font-semibold text-zinc-100 sm:text-base">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
