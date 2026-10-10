import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "./services/api";

import Login from "./pages/Login";
import Home from "./pages/Home";
import Servers from "./pages/Servers";
import ApiKeys from "./pages/ApiKeys";
import AuditLogs from "./pages/AuditLogs";
import Chat from "./pages/Chat";
import Team from "./pages/Team";
import Layout from "./components/Layout";
import { ChatProvider } from "./context/ChatContext";

export const AuthContext = React.createContext<{
  user: any;
  loading: boolean;
  login: (data: any) => Promise<void>;
  logout: () => Promise<void>;
}>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.getMe()
      .then(data => setUser(data.user || data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (data: any) => {
    await api.login(data);
    const me = await api.getMe();
    setUser(me.user || me);
    navigate("/dashboard");
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch(e) {}
    setUser(null);
    navigate("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode, adminOnly?: boolean }) {
  const { user, loading } = React.useContext(AuthContext);
  const location = useLocation();

  if (loading) return <div>Loading...</div>;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (adminOnly && user.role !== "admin") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", padding: "2rem" }}>
        <div className="card" style={{ textAlign: "center", maxWidth: "400px", padding: "3rem", width: "100%" }}>
          <h2 style={{ marginBottom: "1rem" }}>Access restricted</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>You don't have permission to view this section.</p>
          <a href="/dashboard" className="btn-primary" style={{ display: "inline-block" }}>Back to Dashboard</a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ChatProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<ProtectedRoute><Home /></ProtectedRoute>} />
              <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
              <Route path="/servers" element={<ProtectedRoute adminOnly><Servers /></ProtectedRoute>} />
              <Route path="/api-keys" element={<ProtectedRoute adminOnly><ApiKeys /></ProtectedRoute>} />
              <Route path="/audit" element={<ProtectedRoute adminOnly><AuditLogs /></ProtectedRoute>} />
              <Route path="/team" element={<ProtectedRoute adminOnly><Team /></ProtectedRoute>} />
            </Route>
          </Routes>
        </ChatProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
