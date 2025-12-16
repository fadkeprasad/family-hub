import type { ReactNode } from "react";
import BottomTabs from "./BottomTabs";

export default function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-white">
      <div className="px-4 pt-4 pb-24">{children}</div>
      <BottomTabs />
    </div>
  );
}
