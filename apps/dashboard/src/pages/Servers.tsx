import { useEffect, useState } from "react";
import { api } from "../services/api";
import { CheckCircle2, XCircle, Trash2, Power, Edit } from "lucide-react";

export default function Servers() {
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState<any | null>(null);

  const fetchServers = async () => {
    try {
      const data = await api.getServers();
      setServers(data.servers || []);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load servers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleToggle = async (id: number, enabled: boolean) => {
    await api.updateServer(id, { enabled });
    fetchServers();
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure?")) {
      await api.deleteServer(id);
      fetchServers();
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingServer) return;
    try {
      const updates: any = {
        name: editingServer.name,
        url: editingServer.url,
        timeout_ms: parseInt(editingServer.timeout_ms)
      };
      if (editingServer.credential !== undefined) {
        updates.credential = editingServer.credential;
      }
      await api.updateServer(editingServer.id, updates);
      setEditingServer(null);
      fetchServers();
    } catch (err: any) {
      alert(err.message || "Failed to update server");
    }
  };

  const [showAddModal, setShowAddModal] = useState(false);
  const [newServer, setNewServer] = useState({ name: "", url: "", timeout_ms: 30000, credential: "" });

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: newServer.name,
        url: newServer.url,
        timeout_ms: parseInt(newServer.timeout_ms as any)
      };
      if (newServer.credential) {
        payload.credential = newServer.credential;
      }
      await api.addServer(payload);
      setShowAddModal(false);
      setNewServer({ name: "", url: "", timeout_ms: 30000, credential: "" });
      fetchServers();
    } catch (err: any) {
      alert(err.message || "Failed to add server");
    }
  };

  const getStatusLabel = (status: string) => {
    if (status === "connected") return "Connected";
    if (status === "error") return "Unreachable";
    if (status === "disconnected") return "Disconnected";
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "var(--danger)" }}>{error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>MCP Servers</h1>
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>Add MCP Server</button>
      </div>
      
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 0, overflow: "hidden", marginBottom: "0.5rem" }}>
        <div className="table-container" style={{ flex: 1, overflowY: "auto", minHeight: 0, border: "none", borderRadius: 0 }}>
          <table style={{ margin: 0 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Server</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>URL</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Status</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Tools</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map(server => (
                <tr key={server.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{server.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      Last Check: {new Date(server.last_health_check).toLocaleString()}
                    </div>
                  </td>
                  <td>{server.url}</td>
                  <td>
                    {server.enabled ? (
                      server.status === "connected" ? (
                        <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }} title={server.status_message}><CheckCircle2 size={14}/> Connected</span>
                      ) : (
                        <span className="badge badge-error" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }} title={server.status_message}><XCircle size={14}/> {getStatusLabel(server.status)}</span>
                      )
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>Disabled</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                      {server.tools && server.tools.length > 0 ? (
                        server.tools.map((t: any) => (
                          <span key={t.name} style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "4px", opacity: t.available ? 1 : 0.6, border: t.available ? "none" : "1px solid var(--danger)" }} title={t.description}>
                            {t.name} {t.available ? "" : "(unavailable)"}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>No tools</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button onClick={() => setEditingServer({...server, credential: undefined})} style={{ padding: "0.5rem", background: "none", color: "var(--text)" }} title="Edit">
                        <Edit size={18} />
                      </button>
                      <button onClick={() => handleToggle(server.id, !server.enabled)} style={{ padding: "0.5rem", background: "none", color: server.enabled ? "var(--text-muted)" : "var(--success)" }} title={server.enabled ? "Disable" : "Enable"}>
                        <Power size={18} />
                      </button>
                      <button onClick={() => handleDelete(server.id)} style={{ padding: "0.5rem", background: "none", color: "var(--danger)" }} title="Delete">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {servers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>No servers configured.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {editingServer && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="card" style={{ width: "400px", maxWidth: "90%" }}>
            <h3 style={{ marginBottom: "1rem" }}>Edit Server</h3>
            <form onSubmit={handleEditSubmit}>
              <div style={{ marginBottom: "1rem" }}>
                <label className="input-label">Name</label>
                <input type="text" className="input-field" value={editingServer.name} onChange={e => setEditingServer({...editingServer, name: e.target.value})} required />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label className="input-label">URL</label>
                <input type="url" className="input-field" value={editingServer.url} onChange={e => setEditingServer({...editingServer, url: e.target.value})} required />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label className="input-label">Timeout (ms)</label>
                <input type="number" className="input-field" value={editingServer.timeout_ms} onChange={e => setEditingServer({...editingServer, timeout_ms: e.target.value})} required />
              </div>
              <div style={{ marginBottom: "1.5rem" }}>
                <label className="input-label">Credential (Leave empty to keep current, clear to remove)</label>
                <input type="text" className="input-field" placeholder="Bearer Token / API Key" value={editingServer.credential === undefined ? "" : editingServer.credential} onChange={e => setEditingServer({...editingServer, credential: e.target.value})} />
              </div>
              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button type="button" className="btn-secondary" onClick={() => setEditingServer(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddModal && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="card" style={{ width: "400px", maxWidth: "90%" }}>
            <h3 style={{ marginBottom: "1rem" }}>Add Server</h3>
            <form onSubmit={handleAddSubmit}>
              <div style={{ marginBottom: "1rem" }}>
                <label className="input-label">Name</label>
                <input type="text" className="input-field" value={newServer.name} onChange={e => setNewServer({...newServer, name: e.target.value})} required />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label className="input-label">URL</label>
                <input type="url" className="input-field" placeholder="http://.../mcp or sse" value={newServer.url} onChange={e => setNewServer({...newServer, url: e.target.value})} required />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label className="input-label">Timeout (ms)</label>
                <input type="number" className="input-field" value={newServer.timeout_ms} onChange={e => setNewServer({...newServer, timeout_ms: parseInt(e.target.value) || 30000})} required />
              </div>
              <div style={{ marginBottom: "1.5rem" }}>
                <label className="input-label">Credential (Optional)</label>
                <input type="text" className="input-field" placeholder="Bearer Token / API Key" value={newServer.credential} onChange={e => setNewServer({...newServer, credential: e.target.value})} />
              </div>
              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Server</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
