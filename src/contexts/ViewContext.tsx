import { createContext, useContext, useEffect, useMemo, useState } from "react";
import useAuthUser from "../hooks/useAuthUser";
import useFriendRoster from "../hooks/useFriendRoster";

export type ViewOption = {
  ownerUid: string;
  label: string; // "My view" or "Name (email)"
};

type ViewCtx = {
  myUid: string;
  activeOwnerUid: string;
  isMyView: boolean;
  setMyView: () => void;
  setOwnerView: (ownerUid: string) => void;
};

const Ctx = createContext<ViewCtx | null>(null);

export function ViewProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthUser();
  const myUid = user?.uid ?? "";
  const following = useFriendRoster();

  const storageKey = useMemo(() => (myUid ? `fh_activeOwnerUid_${myUid}` : ""), [myUid]);

  const [activeOwnerUid, setActiveOwnerUid] = useState<string>("");

  // Initialize on login
  useEffect(() => {
    if (!myUid) {
      setActiveOwnerUid("");
      return;
    }

    const saved = storageKey ? window.localStorage.getItem(storageKey) : null;
    setActiveOwnerUid(saved || myUid);
  }, [myUid, storageKey]);

  // Persist
  useEffect(() => {
    if (!myUid || !storageKey || !activeOwnerUid) return;
    window.localStorage.setItem(storageKey, activeOwnerUid);
  }, [myUid, storageKey, activeOwnerUid]);

  // If stored owner is no longer followed, fall back to my view
  useEffect(() => {
    if (!myUid || !activeOwnerUid) return;
    if (activeOwnerUid === myUid) return;
    const canView = following.some((f) => f.uid === activeOwnerUid);
    if (!canView) setActiveOwnerUid(myUid);
  }, [following, activeOwnerUid, myUid]);

  const isMyView = myUid !== "" && activeOwnerUid === myUid;

  const value: ViewCtx = {
    myUid,
    activeOwnerUid: activeOwnerUid || myUid,
    isMyView,
    setMyView: () => {
      if (!myUid) return;
      setActiveOwnerUid(myUid);
    },
    setOwnerView: (ownerUid: string) => {
      if (!myUid) return;
      setActiveOwnerUid(ownerUid || myUid);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useView() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useView must be used inside ViewProvider");
  return v;
}
