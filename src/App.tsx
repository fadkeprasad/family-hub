import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MobileShell from "./components/MobileShell";
import Home from "./pages/Home";
import Todos from "./pages/Todos";
import Reminders from "./pages/Reminders";
import Messages from "./pages/Messages";
import People from "./pages/People";
import Login from "./pages/Login";

export default function App() {
  return (
    <BrowserRouter>
      <MobileShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/people" element={<People />} />

          {/* Auth page (wired in step 2) */}
          <Route path="/login" element={<Login />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MobileShell>
    </BrowserRouter>
  );
}
