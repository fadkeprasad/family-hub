import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

function Home() { return <div style={{ padding: 16 }}>Home</div>; }
function Todos() { return <div style={{ padding: 16 }}>Todos</div>; }
function Reminders() { return <div style={{ padding: 16 }}>Reminders</div>; }
function Messages() { return <div style={{ padding: 16 }}>Messages</div>; }
function People() { return <div style={{ padding: 16 }}>People</div>; }

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/todos" element={<Todos />} />
        <Route path="/reminders" element={<Reminders />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/people" element={<People />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
