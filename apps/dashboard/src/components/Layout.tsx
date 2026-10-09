import { Outlet, NavLink } from "react-router-dom";
import { AuthContext } from "../App";
import { useContext } from "react";
import { LayoutDashboard, MessageSquare, Server, Key, FileText, Users, LogOut } from "lucide-react";

export default function Layout() {
  const { user, logout } = useContext(AuthContext);

  return (
    <div className="layout-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <Server size={24} color="var(--primary)" />
          <span>Urumi Gateway</span>
        </div>
        
        <div className="sidebar-nav">
          <NavLink to="/dashboard" className="nav-link">
            <LayoutDashboard size={20} /> Dashboard
          </NavLink>
          <NavLink to="/chat" className="nav-link">
            <MessageSquare size={20} /> Chat
          </NavLink>
          <NavLink to="/servers" className="nav-link">
            <Server size={20} /> MCP Servers
          </NavLink>
          <NavLink to="/api-keys" className="nav-link">
            <Key size={20} /> API Keys
          </NavLink>
          <NavLink to="/audit" className="nav-link">
            <FileText size={20} /> Audit Logs
          </NavLink>
          {user?.role === "admin" && (
            <NavLink to="/team" className="nav-link">
              <Users size={20} /> Team
            </NavLink>
          )}
        </div>
        
        <div style={{ padding: "1rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ marginBottom: "1rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            {user?.email} ({user?.role})
          </div>
          <button className="nav-link" style={{ width: "100%", background: "none", border: "none" }} onClick={logout}>
            <LogOut size={20} /> Logout
          </button>
        </div>
      </div>
      
      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}
