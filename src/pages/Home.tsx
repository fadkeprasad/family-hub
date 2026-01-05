import { useEffect, useState } from "react";
import HomeTile from "../components/HomeTile";
import useBadges from "../hooks/useBadges";
import { deleteUser, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { deleteToken, getMessaging, getToken, isSupported } from "firebase/messaging";
import { app, auth, db } from "../lib/firebase";
import useFriendRoster from "../hooks/useFriendRoster";
import { useView } from "../contexts/ViewContext";

type NotificationSchedule = {
  id: string;
  time: string;
  enabled: boolean;
  timeZone?: string;
  nextRunAt?: any;
};

function getLocalTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function computeNextRunAt(time: string) {
  const [hour, minute] = time.split(":").map((v) => Number(v));
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function tokenToId(token: string) {
  try {
    return btoa(token).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  } catch {
    return token.replace(/[^a-zA-Z0-9_-]/g, "");
  }
}

function tokenStorageKey(uid: string) {
  return `fh_pushTokenId_${uid}`;
}

export default function Home() {
  const nav = useNavigate();
  const badges = useBadges();
  const friends = useFriendRoster();
  const { myUid, activeOwnerUid, isMyView, setMyView, setOwnerView } = useView();
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [notifSupported, setNotifSupported] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifErr, setNotifErr] = useState<string | null>(null);
  const [notifSchedules, setNotifSchedules] = useState<NotificationSchedule[]>([]);
  const [newTime, setNewTime] = useState("09:00");
  const [deviceTokenId, setDeviceTokenId] = useState<string | null>(null);

  async function resetLogin() {
    setSettingsOpen(false);
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
      const tokensCol = collection(db, "users", uid, "pushTokens");
      const schedulesCol = collection(db, "users", uid, "notificationSchedules");

      const cleanupBatch = writeBatch(db);
      const [tokensSnap, schedulesSnap] = await Promise.all([
        getDocs(tokensCol).catch(() => null),
        getDocs(schedulesCol).catch(() => null),
      ]);

      if (tokensSnap) {
        for (const docSnap of tokensSnap.docs) cleanupBatch.delete(docSnap.ref);
      }
      if (schedulesSnap) {
        for (const docSnap of schedulesSnap.docs) cleanupBatch.delete(docSnap.ref);
      }
      await cleanupBatch.commit().catch(() => {});

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
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setNotifPermission("unsupported");
      return;
    }
    setNotifPermission(Notification.permission);
  }, []);

  useEffect(() => {
    let alive = true;
    if (typeof window === "undefined") return;
    void isSupported()
      .then((supported) => {
        if (alive) setNotifSupported(supported);
      })
      .catch(() => {
        if (alive) setNotifSupported(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!myUid) {
      setDeviceTokenId(null);
      return;
    }
    const stored = window.localStorage.getItem(tokenStorageKey(myUid));
    setDeviceTokenId(stored || null);
  }, [myUid]);

  useEffect(() => {
    if (!myUid) {
      setNotifSchedules([]);
      return;
    }

    const ref = collection(db, "users", myUid, "notificationSchedules");
    const q = query(ref, orderBy("time"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            time: String(data.time ?? "09:00"),
            enabled: data.enabled !== false,
            timeZone: String(data.timeZone ?? ""),
            nextRunAt: data.nextRunAt,
          } as NotificationSchedule;
        });
        setNotifSchedules(rows);
        setNotifErr(null);
      },
      (e) => setNotifErr(e?.message ?? "Failed to load notification schedules."),
    );

    return () => unsub();
  }, [myUid]);

  useEffect(() => {
    if (!myUid || !activeOwnerUid) return;
    if (activeOwnerUid === myUid) return;
    const stillFollowing = friends.some((f) => f.uid === activeOwnerUid);
    if (!stillFollowing) setMyView();
  }, [friends, activeOwnerUid, myUid, setMyView]);

  const selectedLabel = isMyView
    ? "My view"
    : friends.find((f) => f.uid === activeOwnerUid)?.name || "Following view";

  async function enableNotifications() {
    if (!myUid || notifBusy) return;
    setNotifErr(null);
    setNotifBusy(true);

    try {
      if (!notifSupported) {
        setNotifErr("Push notifications are not supported in this browser.");
        return;
      }
      if (typeof window === "undefined" || !("Notification" in window)) {
        setNotifErr("Notifications are not available in this browser.");
        return;
      }
      if (!("serviceWorker" in navigator)) {
        setNotifErr("Service workers are not supported in this browser.");
        return;
      }

      const vapidKey = import.meta.env.VITE_FB_VAPID_KEY;
      if (!vapidKey) {
        setNotifErr("Missing VAPID key. Add VITE_FB_VAPID_KEY to your environment.");
        return;
      }

      let permission: NotificationPermission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
      }
      setNotifPermission(permission);

      if (permission !== "granted") {
        setNotifErr("Notification permission is not granted.");
        return;
      }

      const swParams = new URLSearchParams({
        apiKey: import.meta.env.VITE_FB_API_KEY ?? "",
        authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN ?? "",
        projectId: import.meta.env.VITE_FB_PROJECT_ID ?? "",
        appId: import.meta.env.VITE_FB_APP_ID ?? "",
        messagingSenderId: import.meta.env.VITE_FB_MSG_SENDER_ID ?? "",
      });
      const swUrl = `/firebase-messaging-sw.js?${swParams.toString()}`;

      const registration = await navigator.serviceWorker.register(swUrl);
      const messaging = getMessaging(app);

      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });

      if (!token) {
        setNotifErr("Could not create a notification token.");
        return;
      }

      const tokenId = tokenToId(token);
      await setDoc(
        doc(db, "users", myUid, "pushTokens", tokenId),
        {
          ownerUid: myUid,
          token,
          platform: "web",
          userAgent: navigator.userAgent,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      window.localStorage.setItem(tokenStorageKey(myUid), tokenId);
      setDeviceTokenId(tokenId);
    } catch (e: any) {
      setNotifErr(e?.message ?? "Failed to enable notifications.");
    } finally {
      setNotifBusy(false);
    }
  }

  async function disableNotifications() {
    if (!myUid || notifBusy || !deviceTokenId) return;
    setNotifErr(null);
    setNotifBusy(true);
    try {
      await deleteDoc(doc(db, "users", myUid, "pushTokens", deviceTokenId));
      window.localStorage.removeItem(tokenStorageKey(myUid));
      setDeviceTokenId(null);
      if (notifSupported) {
        try {
          const messaging = getMessaging(app);
          await deleteToken(messaging).catch(() => {});
        } catch {}
      }
    } catch (e: any) {
      setNotifErr(e?.message ?? "Failed to disable notifications on this device.");
    } finally {
      setNotifBusy(false);
    }
  }

  async function addSchedule() {
    if (!myUid || notifBusy) return;
    setNotifErr(null);
    setNotifBusy(true);
    try {
      const next = computeNextRunAt(newTime);
      if (!next) {
        setNotifErr("Pick a valid time.");
        return;
      }
      await addDoc(collection(db, "users", myUid, "notificationSchedules"), {
        ownerUid: myUid,
        time: newTime,
        timeZone: getLocalTimeZone(),
        enabled: true,
        nextRunAt: Timestamp.fromDate(next),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setNotifErr(e?.message ?? "Failed to add schedule.");
    } finally {
      setNotifBusy(false);
    }
  }

  async function updateScheduleTime(schedule: NotificationSchedule, time: string) {
    if (!myUid) return;
    const next = computeNextRunAt(time);
    if (!next) return;
    try {
      await updateDoc(doc(db, "users", myUid, "notificationSchedules", schedule.id), {
        time,
        timeZone: getLocalTimeZone(),
        nextRunAt: Timestamp.fromDate(next),
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setNotifErr(e?.message ?? "Failed to update schedule.");
    }
  }

  async function toggleSchedule(schedule: NotificationSchedule) {
    if (!myUid) return;
    const nextEnabled = !schedule.enabled;
    const nextRunAt = nextEnabled ? computeNextRunAt(schedule.time) : null;
    try {
      await updateDoc(doc(db, "users", myUid, "notificationSchedules", schedule.id), {
        enabled: nextEnabled,
        nextRunAt: nextRunAt ? Timestamp.fromDate(nextRunAt) : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setNotifErr(e?.message ?? "Failed to update schedule.");
    }
  }

  async function removeSchedule(scheduleId: string) {
    if (!myUid) return;
    try {
      await deleteDoc(doc(db, "users", myUid, "notificationSchedules", scheduleId));
    } catch (e: any) {
      setNotifErr(e?.message ?? "Failed to remove schedule.");
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-extrabold tracking-tight text-zinc-50 sm:text-3xl">Family Hub</div>
          <div className="mt-2 text-sm font-semibold text-zinc-300 sm:text-base">
            {isMyView ? "Your hub" : "Read-only view"}
          </div>
        </div>

        <div className="flex items-center gap-2">
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

          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/30 text-lg text-zinc-100"
            onClick={() => setSettingsOpen(true)}
            type="button"
            aria-label="Settings"
            title="Settings"
          >
            <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.983 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm7.18 6.5c0-.49-.06-.97-.16-1.43l1.78-1.04-1.8-3.12-2.06.58a7.83 7.83 0 0 0-1.24-.72l-.32-2.1H9.64l-.32 2.1c-.44.2-.86.44-1.24.72l-2.06-.58-1.8 3.12 1.78 1.04c-.1.46-.16.94-.16 1.43s.06.97.16 1.43l-1.78 1.04 1.8 3.12 2.06-.58c.38.28.8.52 1.24.72l.32 2.1h3.72l.32-2.1c.44-.2.86-.44 1.24-.72l2.06.58 1.8-3.12-1.78-1.04c.1-.46.16-.94.16-1.43Z"
                />
              </svg>
            </span>
          </button>
        </div>
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


      {settingsOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-24"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-extrabold text-zinc-100">Settings</div>
                <div className="mt-1 text-xs font-semibold text-zinc-400">
                  Manage notifications and your account.
                </div>
              </div>
              <button
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs font-extrabold text-zinc-200"
                type="button"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-zinc-100">Notifications</div>
                  <div className="mt-1 text-xs font-semibold text-zinc-400">
                    Set daily reminders for your hub.
                  </div>
                </div>
                <button
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-60"
                  type="button"
                  onClick={() => void (deviceTokenId ? disableNotifications() : enableNotifications())}
                  disabled={notifBusy || !myUid || !notifSupported}
                >
                  {deviceTokenId ? "Disable" : "Enable"}
                </button>
              </div>

              <div className="mt-2 text-xs font-semibold text-zinc-400">
                {notifSupported ? "Supported browser" : "Push not supported here."} / Permission: {notifPermission}
              </div>
              {deviceTokenId && (
                <div className="mt-1 text-xs font-semibold text-emerald-200">Enabled on this device.</div>
              )}

              <div className="mt-4">
                <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-300">Reminder times</div>
                {notifSchedules.length === 0 && (
                  <div className="mt-2 text-xs font-semibold text-zinc-400">No times yet.</div>
                )}

                <div className="mt-2 grid gap-2">
                  {notifSchedules.map((schedule) => (
                    <div key={schedule.id} className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-xs font-semibold text-zinc-100"
                        type="time"
                        value={schedule.time}
                        onChange={(e) => {
                          const value = e.target.value;
                          setNotifSchedules((prev) =>
                            prev.map((s) => (s.id === schedule.id ? { ...s, time: value } : s)),
                          );
                        }}
                        onBlur={(e) => void updateScheduleTime(schedule, e.target.value)}
                      />
                      <button
                        className={[
                          "rounded-xl px-3 py-2 text-xs font-extrabold",
                          schedule.enabled
                            ? "bg-emerald-600 text-white"
                            : "border border-zinc-800 bg-zinc-950/30 text-zinc-300",
                        ].join(" ")}
                        type="button"
                        onClick={() => void toggleSchedule(schedule)}
                      >
                        {schedule.enabled ? "On" : "Off"}
                      </button>
                      <button
                        className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-xs font-extrabold text-zinc-200"
                        type="button"
                        onClick={() => void removeSchedule(schedule.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-xs font-semibold text-zinc-100"
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                  />
                  <button
                    className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-extrabold text-zinc-900 disabled:opacity-60"
                    type="button"
                    onClick={() => void addSchedule()}
                    disabled={notifBusy || !newTime}
                  >
                    Add time
                  </button>
                </div>

                <div className="mt-2 text-xs font-semibold text-zinc-400">Timezone: {getLocalTimeZone()}</div>
              </div>
            </div>

            {(notifErr || accountErr) && (
              <div className="mt-3 grid gap-2">
                {notifErr && (
                  <div className="rounded-xl border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-200">
                    {notifErr}
                  </div>
                )}
                {accountErr && (
                  <div className="rounded-xl border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-200">
                    {accountErr}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 grid gap-2">
              <button
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 py-3 text-sm font-extrabold text-zinc-200"
                onClick={() => void resetLogin()}
                type="button"
              >
                Logout
              </button>
              <button
                className="w-full rounded-2xl border border-red-900/40 bg-red-950/40 py-3 text-sm font-extrabold text-red-200 disabled:opacity-60"
                onClick={() => void deleteAccount()}
                disabled={accountBusy}
                type="button"
              >
                {accountBusy ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
