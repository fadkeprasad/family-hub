import { useEffect, useState } from "react";
import HomeTile from "../components/HomeTile";
import useBadges from "../hooks/useBadges";
import { deleteUser, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { deleteDoc, doc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import useFriendRoster from "../hooks/useFriendRoster";
import { useView } from "../contexts/ViewContext";

export default function Home() {
  const nav = useNavigate();
  const badges = useBadges();
  const friends = useFriendRoster();
  const { myUid, activeOwnerUid, isMyView, setMyView, setOwnerView } = useView();
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountErr, setAccountErr] = useState<string | null>(null);

  async function resetLogin() {
    await signOut(auth);
  }

  async function deleteAccount() {
    if (!auth.currentUser || accountBusy) return;
    const ok = window.confirm("Delete your account? This cannot be undone.");
    if (!ok) return;

    setAccountErr(null);
    setAccountBusy(true);
    try {
      const uid = auth.currentUser.uid;
      await Promise.all([
        deleteDoc(doc(db, "users", uid)).catch(() => {}),
        deleteDoc(doc(db, "userDirectory", uid)).catch(() => {}),
      ]);
      await deleteUser(auth.currentUser);
    } catch (e: any) {
      const code = String(e?.code ?? "");
      if (code === "auth/requires-recent-login") {
        setAccountErr("Please sign in again, then retry deleting your account.");
      } else {
        setAccountErr(e?.message ?? "Failed to delete account.");
      }
    } finally {
      setAccountBusy(false);
    }
  }

  useEffect(() => {
    if (!myUid || !activeOwnerUid) return;
    if (activeOwnerUid === myUid) return;
    const stillFollowing = friends.some((f) => f.uid === activeOwnerUid);
    if (!stillFollowing) setMyView();
  }, [friends, activeOwnerUid, myUid, setMyView]);

  const selectedLabel = isMyView
    ? "My view"
    : friends.find((f) => f.uid === activeOwnerUid)?.name || "Following view";

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-extrabold tracking-tight text-zinc-50 sm:text-3xl">Family Hub</div>
          <div className="mt-2 text-sm font-semibold text-zinc-300 sm:text-base">
            {isMyView ? "Your hub" : "Read-only view"}
          </div>
        </div>

        <button
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/30 text-lg text-zinc-100"
          onClick={() => nav("/friends")}
          type="button"
          aria-label="Follow"
          title="Follow"
        >
          <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 20.5c0-2.2-2.2-4-5-4m7 4c0-1.6-1.2-3-3-3.6M11 16.5c-2.8 0-5 1.8-5 4M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm5-1.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"
              />
            </svg>
          </span>
          {badges.follow > 0 && (
            <span className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-rose-500 px-1.5 py-0.5 text-xs font-extrabold text-white">
              {badges.follow}
            </span>
          )}
        </button>
      </div>

      {/* View selector */}
      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300">View</div>

        <select
          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950/30 px-4 py-3 text-sm font-extrabold text-zinc-100 sm:text-base"
          value={activeOwnerUid || myUid}
          onChange={(e) => {
            const v = e.target.value;
            if (v === myUid) setMyView();
            else setOwnerView(v);
          }}
        >
          <option value={myUid}>My view</option>
          {friends.map((f) => (
            <option key={f.uid} value={f.uid}>
              {f.name} ({f.email})
            </option>
          ))}
        </select>

        <div className="mt-2 text-xs font-semibold text-zinc-400 sm:text-sm">Selected: {selectedLabel}</div>
      </div>

      <div className="mt-5 grid gap-3">
        <HomeTile title="To-dos" subtitle="Checklist + recurring" to="/todos" badge={badges.todos} tone="green" icon="✅" />
        <HomeTile title="Reminders" subtitle="Expiry-based reminders" to="/reminders" badge={badges.reminders} tone="orange" icon="⏰" />
        <HomeTile title="Daily Journal" subtitle="Write for today" to="/journal" badge={badges.journal} tone="blue" icon="📝" />
      </div>

      {accountErr && (
        <div className="mt-5 rounded-2xl border border-red-900/40 bg-red-950/40 p-3 text-sm font-semibold text-red-200">
          {accountErr}
        </div>
      )}

      <button
        className="mt-5 w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 py-3 text-sm font-extrabold text-zinc-200 sm:text-base"
        onClick={resetLogin}
        type="button"
      >
        Logout
      </button>

      <button
        className="mt-3 w-full rounded-2xl border border-red-900/40 bg-red-950/40 py-3 text-sm font-extrabold text-red-200 disabled:opacity-60 sm:text-base"
        onClick={deleteAccount}
        disabled={accountBusy}
        type="button"
      >
        {accountBusy ? "Deleting..." : "Delete account"}
      </button>
    </div>
  );
}
