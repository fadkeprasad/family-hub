import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MobileShell from "./components/MobileShell";
import Home from "./pages/Home";
import Todos from "./pages/Todos";
import Reminders from "./pages/Reminders";
import Messages from "./pages/Messages";
import People from "./pages/People";
import Login from "./pages/Login";
import useAuthUser from "./hooks/useAuthUser";

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthUser();
  if (loading) return <div className="p-4 text-sm text-zinc-600">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <MobileShell>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={<PrivateRoute><Home /></PrivateRoute>} />
          <Route path="/todos" element={<PrivateRoute><Todos /></PrivateRoute>} />
          <Route path="/reminders" element={<PrivateRoute><Reminders /></PrivateRoute>} />
          <Route path="/messages" element={<PrivateRoute><Messages /></PrivateRoute>} />
          <Route path="/people" element={<PrivateRoute><People /></PrivateRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MobileShell>
    </BrowserRouter>
  );
}
