import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import MobileShell from "./components/MobileShell";
import Home from "./pages/Home";
import Todos from "./pages/Todos";
import Reminders from "./pages/Reminders";
import Journal from "./pages/Journal";
import Login from "./pages/Login";
import TodoCalendar from "./pages/TodoCalendar";
import TodoStats from "./pages/TodoStats";
import Friends from "./pages/Friends";
import useAuthUser from "./hooks/useAuthUser";
import { ViewProvider } from "./contexts/ViewContext";
import { db } from "./lib/firebase";

function AuthedApp() {
  return (
    <ViewProvider>
      <MobileShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/todos/calendar/:kind/:id" element={<TodoCalendar />} />
          <Route path="/todos/stats" element={<TodoStats />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MobileShell>
    </ViewProvider>
  );
}

function PrivateGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthUser();

  useEffect(() => {
    if (!user) return;
    const emailLower = (user.email ?? "").trim().toLowerCase();
    if (!emailLower) return;

    const ref = doc(db, "userDirectory", user.uid);
    setDoc(
      ref,
      {
        uid: user.uid,
        emailLower,
        displayName: user.displayName ?? "",
        photoURL: user.photoURL ?? null,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {});
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-950 to-zinc-900 p-4 text-sm font-semibold text-zinc-300">
        Loading...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/*"
          element={
            <PrivateGate>
              <AuthedApp />
            </PrivateGate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
