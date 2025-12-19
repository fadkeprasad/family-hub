import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import BottomTabs from "./BottomTabs";

export default function MobileShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const showTabs = pathname !== "/login";

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-gradient-to-b from-zinc-950 to-zinc-900 text-zinc-100">
      <div className={showTabs ? "px-4 pt-5 pb-32" : "px-4 pt-5 pb-6"}>{children}</div>
      {showTabs && <BottomTabs />}
    </div>
  );
}
