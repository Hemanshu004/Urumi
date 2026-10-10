import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { AuthContext } from "../App";
import { ChatContext } from "../context/ChatContext";
import { useContext, useState } from "react";
import { LayoutDashboard, MessageSquare, Server, Key, FileText, Users, LogOut, Plus, Search, Trash, Edit2, ChevronDown, ChevronRight } from "lucide-react";

export default function Layout() {
  const { user, logout } = useContext(AuthContext);
  const { conversations, activeConversationId, setActiveConversationId, createConversation, deleteConversation, renameConversation } = useContext(ChatContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isConversationsExpanded, setIsConversationsExpanded] = useState(() => {
    return localStorage.getItem("urumi:conversationsExpanded") !== "false";
  });

  const handleConversationClick = (id: string) => {
    setActiveConversationId(id);
    if (location.pathname !== "/chat") {
      navigate("/chat");
    }
  };

  const handleNewChat = () => {
    createConversation();
    if (location.pathname !== "/chat") {
      navigate("/chat");
    }
  };

  const filteredConversations = conversations.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));

  // Simple grouping
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const groups = {
    "Today": [] as typeof conversations,
    "Yesterday": [] as typeof conversations,
    "Previous 7 days": [] as typeof conversations,
    "Older": [] as typeof conversations,
  };

  filteredConversations.forEach(c => {
    const d = new Date(c.updatedAt);
    if (d >= today) groups["Today"].push(c);
    else if (d >= yesterday) groups["Yesterday"].push(c);
    else if (d >= lastWeek) groups["Previous 7 days"].push(c);
    else groups["Older"].push(c);
  });

  return (
    <div className="layout-container" style={{ display: "flex", height: "100vh", overflow: "hidden", position: "relative" }}>
      
      {/* Mobile overlay */}
      <div 
        className={`mobile-overlay ${isMobileOpen ? 'open' : ''}`} 
        onClick={() => setIsMobileOpen(false)}
      ></div>

      <div className={`sidebar ${isMobileOpen ? 'open' : ''}`} style={{ display: "flex", flexDirection: "column", width: "260px", backgroundColor: "var(--bg-panel)", borderRight: "1px solid var(--border)", flexShrink: 0 }}>
        
        <div className="sidebar-header" style={{ padding: "1.25rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>
            <Server size={24} color="var(--primary)" />
            <span>Urumi Gateway</span>
          </div>
        </div>
        
        <div className="sidebar-nav" style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <NavLink to="/dashboard" onClick={() => setIsMobileOpen(false)} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={18} /> Overview
          </NavLink>
          <NavLink to="/chat" onClick={() => setIsMobileOpen(false)} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
            <MessageSquare size={18} /> Agent
          </NavLink>
          
          {user?.role === "admin" && (
            <>
              <NavLink to="/servers" onClick={() => setIsMobileOpen(false)} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
                <Server size={18} /> MCP Servers
              </NavLink>
              <NavLink to="/api-keys" onClick={() => setIsMobileOpen(false)} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
                <Key size={18} /> API Keys
              </NavLink>
              <NavLink to="/audit" onClick={() => setIsMobileOpen(false)} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
                <FileText size={18} /> Audit Logs
              </NavLink>
              <NavLink to="/team" onClick={() => setIsMobileOpen(false)} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
                <Users size={18} /> Team
              </NavLink>
            </>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "0 1rem" }}></div>
        
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem", padding: "1rem", paddingBottom: 0, minHeight: 0 }}>
          <div 
            onClick={() => {
              const newVal = !isConversationsExpanded;
              setIsConversationsExpanded(newVal);
              localStorage.setItem("urumi:conversationsExpanded", String(newVal));
            }}
            style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between", 
              cursor: "pointer", 
              padding: "0.5rem", 
              color: "var(--text-muted)", 
              marginBottom: "0.5rem",
              flexShrink: 0
            }}
          >
            <span style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.05em" }}>CONVERSATIONS</span>
            {isConversationsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
          
          {isConversationsExpanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", animation: "fadeIn 0.2s ease", flex: 1, minHeight: 0 }}>
              <button onClick={() => { handleNewChat(); setIsMobileOpen(false); }} className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", justifyContent: "flex-start", padding: "0.5rem 0.75rem", background: "transparent", border: "1px solid var(--primary)", color: "var(--primary)", marginBottom: "0.5rem", flexShrink: 0 }}>
                <Plus size={16} /> New Chat
              </button>

              {conversations.length > 8 && (
                <div style={{ position: "relative", marginBottom: "1rem", flexShrink: 0 }}>
                  <Search size={14} style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <input 
                    type="text" 
                    placeholder="Search..." 
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: "100%", padding: "0.4rem 0.75rem 0.4rem 2rem", fontSize: "0.875rem", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-main)" }}
                  />
                </div>
              )}

              <div className="conversations-list" style={{ display: "flex", flexDirection: "column", gap: "1rem", flex: 1, overflowY: "auto", minHeight: 0, paddingBottom: "1rem", paddingRight: "4px" }}>
                {Object.entries(groups).map(([groupName, convs]) => (
                  convs.length > 0 && (
                    <div key={groupName}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.25rem", paddingLeft: "0.75rem" }}>
                        {groupName}
                      </div>
                      {convs.map(c => (
                        <div 
                          key={c.id}
                          onClick={() => { handleConversationClick(c.id); setIsMobileOpen(false); }}
                          style={{ 
                            padding: "0.5rem 0.75rem", 
                            borderRadius: "6px", 
                            cursor: "pointer", 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "space-between",
                            backgroundColor: activeConversationId === c.id ? "rgba(255, 107, 44, 0.1)" : "transparent",
                            color: activeConversationId === c.id ? "var(--primary)" : "var(--text-main)",
                            marginBottom: "2px"
                          }}
                          className="conversation-item"
                        >
                          {editingId === c.id ? (
                            <input
                              autoFocus
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onBlur={() => {
                                if (editTitle.trim()) renameConversation(c.id, editTitle.trim());
                                setEditingId(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  if (editTitle.trim()) renameConversation(c.id, editTitle.trim());
                                  setEditingId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingId(null);
                                }
                              }}
                              style={{ width: "100%", background: "var(--bg-elevated)", border: "none", color: "inherit", outline: "none", fontSize: "0.875rem" }}
                            />
                          ) : (
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: activeConversationId === c.id ? 500 : 400 }}>
                              {c.title}
                            </div>
                          )}
                          
                          {activeConversationId === c.id && editingId !== c.id && (
                            <div className="conversation-actions" style={{ display: "flex", gap: "0.25rem" }}>
                              <button onClick={(e) => { e.stopPropagation(); setEditTitle(c.title); setEditingId(c.id); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "2px" }}>
                                <Edit2 size={14} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "2px" }}>
                                <Trash size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div style={{ padding: "1rem", borderTop: "1px solid var(--border)", flexShrink: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem", borderRadius: "8px", backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div style={{ 
              width: "32px", 
              height: "32px", 
              borderRadius: "50%", 
              backgroundColor: "rgba(255, 107, 44, 0.15)",
              color: "var(--primary)", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center", 
              fontWeight: 600,
              fontSize: "0.875rem",
              flexShrink: 0
            }}>
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2, marginBottom: "0.125rem" }}>
                {user?.email || "User"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.2 }}>
                {user?.role === 'admin' ? 'Administrator' : 'Member'}
              </div>
            </div>
          </div>
          
          <button className="nav-link" style={{ width: "100%", background: "none", border: "none", justifyContent: "flex-start", marginTop: "0.25rem", cursor: "pointer" }} onClick={logout} aria-label="Sign out">
            <LogOut size={16} /> <span style={{ fontSize: "0.875rem" }}>Sign out</span>
          </button>
        </div>
      </div>
      
      <div className="main-content" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: location.pathname === "/chat" ? 0 : "2.5rem", backgroundColor: "var(--bg-dark)" }}>
        <div className="mobile-header" style={{ padding: "1rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", flexShrink: 0, margin: location.pathname === "/chat" ? 0 : "-2.5rem -2.5rem 2.5rem -2.5rem" }}>
          <button className="mobile-menu-btn" onClick={() => setIsMobileOpen(true)} style={{ margin: 0, border: "none", background: "none", display: "inline-flex" }}>
            <span style={{ fontSize: "1.25rem", marginRight: "0.5rem" }}>☰</span>
            <span style={{ fontWeight: 600 }}>Menu</span>
          </button>
        </div>
        <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
