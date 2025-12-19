import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

import { db } from "../lib/firebase";
import useAuthUser from "../hooks/useAuthUser";
import useProfile from "../hooks/useProfile";

type ChatMessage = {
  id: string;
  text: string;
  senderId: string;
  createdAt?: any;
};

const LIVE_LIMIT = 30;
const PAGE_SIZE = 30;

export default function Messages() {
  const { user } = useAuthUser();
  const uid = user?.uid ?? "";
  const { profile } = useProfile();

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const [liveDocs, setLiveDocs] = useState<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [olderDocs, setOlderDocs] = useState<QueryDocumentSnapshot<DocumentData>[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const messagesCol = useMemo(() => collection(db, "threads", "main", "messages"), []);
  const threadRef = useMemo(() => doc(db, "threads", "main"), []);
  const myUserRef = useMemo(() => (uid ? doc(db, "users", uid) : null), [uid]);

  // Mark messages as seen when this page opens (and when uid becomes available)
  useEffect(() => {
    if (!myUserRef) return;
    updateDoc(myUserRef, { "lastSeen.messages": serverTimestamp() }).catch(() => {});
  }, [myUserRef]);

  // Live listener (most recent messages)
  useEffect(() => {
    const qLive = query(messagesCol, orderBy("createdAt", "desc"), limit(LIVE_LIMIT));
    const unsub = onSnapshot(qLive, (snap) => {
      setLiveDocs(snap.docs);
    });
    return () => unsub();
  }, [messagesCol]);

  // Combine + dedupe + sort ascending for display
  const messagesAsc: ChatMessage[] = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    const all = [...liveDocs, ...olderDocs];

    for (const d of all) {
      const data = d.data() as any;
      map.set(d.id, {
        id: d.id,
        text: String(data.text ?? ""),
        senderId: String(data.senderId ?? ""),
        createdAt: data.createdAt,
      });
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const at = a.createdAt?.toMillis?.() ?? 0;
      const bt = b.createdAt?.toMillis?.() ?? 0;
      return at - bt;
    });

    return arr;
  }, [liveDocs, olderDocs]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;

    const nearTop = el.scrollTop < 40;
    if (nearTop) void loadMore();

    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottomRef.current = distanceFromBottom < 120;
  }

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messagesAsc.length]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;

    const cursor: QueryDocumentSnapshot<DocumentData> | null =
      olderDocs.length > 0
        ? olderDocs[olderDocs.length - 1]
        : liveDocs.length > 0
          ? liveDocs[liveDocs.length - 1]
          : null;

    if (!cursor) return;

    setLoadingMore(true);
    try {
      const qMore = query(
        messagesCol,
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(PAGE_SIZE),
      );

      const snap = await getDocs(qMore);

      if (snap.empty) {
        setHasMore(false);
        return;
      }

      setOlderDocs((prev) => [...prev, ...snap.docs]);

      if (snap.docs.length < PAGE_SIZE) setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || !uid) return;

    setSending(true);
    try {
      const batch = writeBatch(db);

      const msgRef = doc(messagesCol); // auto id
      batch.set(msgRef, {
        text: trimmed,
        senderId: uid,
        createdAt: serverTimestamp(),
      });

      batch.set(
        threadRef,
        {
          lastMessageAt: serverTimestamp(),
        },
        { merge: true },
      );

      await batch.commit();

      setText("");

      const el = scrollerRef.current;
      if (el) {
        stickToBottomRef.current = true;
        el.scrollTop = el.scrollHeight;
      }
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void send();
  }

  const meName = profile?.displayName ?? "Me";

  return (
    <div className="flex h-full flex-col">
      <div className="pb-3">
        <h1 className="text-2xl font-extrabold text-zinc-900">Messages</h1>
        <div className="text-base font-medium text-zinc-700">Signed in as {meName}</div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto rounded-2xl border bg-zinc-50 p-3"
      >
        {loadingMore && (
          <div className="pb-2 text-center text-sm font-medium text-zinc-500">Loading older…</div>
        )}

        {messagesAsc.map((m) => {
          const mine = m.senderId === uid;
          return (
            <div key={m.id} className={`mb-3 flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "max-w-[85%] rounded-2xl px-4 py-3 text-base font-medium leading-relaxed",
                  mine ? "bg-violet-700 text-white" : "border bg-white text-zinc-900",
                ].join(" ")}
              >
                {m.text}
              </div>
            </div>
          );
        })}

        {messagesAsc.length === 0 && (
          <div className="text-center text-base font-medium text-zinc-500">No messages yet.</div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-xl border px-4 py-4 text-base"
          placeholder="Message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          className="rounded-xl bg-violet-700 px-5 py-4 text-base font-extrabold text-white disabled:opacity-60"
          onClick={send}
          disabled={sending || text.trim().length === 0}
        >
          Send
        </button>
      </div>
    </div>
  );
}
