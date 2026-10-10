import { useEffect, useState } from "react";
import { api } from "../services/api";
import { CheckCircle2, XCircle, Trash2, Power } from "lucide-react";

export default function Servers() {
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "var(--danger)" }}>{error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>MCP Servers</h1>
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
                        <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><CheckCircle2 size={14}/> Connected</span>
                      ) : (
                        <span className="badge badge-error" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><XCircle size={14}/> {server.status}</span>
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
    </div>
  );
}
