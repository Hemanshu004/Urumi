import { useEffect, useState, useContext } from "react";
import { api } from "../services/api";
import { AuthContext } from "../App";
import { Server, FileText, CheckCircle2, XCircle } from "lucide-react";

export default function Home() {
  const { user } = useContext(AuthContext);
  const [servers, setServers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getServers(),
      api.getAuditLogs()
    ]).then(([sData, lData]) => {
      setServers(sData.servers || []);
      setLogs((lData.logs || []).slice(0, 5));
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setError(err.message || "Failed to load dashboard data");
      setLoading(false);
    });
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "var(--danger)", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", margin: "1rem" }}>{error}</div>;

  const enabledServers = servers.filter(s => s.enabled);
  const healthyServers = enabledServers.filter(s => s.status === "connected");
  
  // Actually, tools available depends on connected servers. Since gateway syncs tools to db or memory,
  // we just have servers length for now, and can mock tools count if needed, or get it from server info if available.
  
  return (
    <div>
      <h1 className="page-title">Welcome, {user?.name}</h1>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ padding: "1rem", backgroundColor: "var(--bg-elevated)", borderRadius: "8px", border: "1px solid var(--border)" }}>
              <Server color="var(--primary)" />
            </div>
            <div>
              <div style={{ fontSize: "2rem", fontWeight: "700" }}>{healthyServers.length} / {enabledServers.length}</div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Servers Connected</div>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ padding: "1rem", backgroundColor: "var(--bg-elevated)", borderRadius: "8px", border: "1px solid var(--border)" }}>
              <FileText color="var(--success)" />
            </div>
            <div>
              <div style={{ fontSize: "2rem", fontWeight: "700" }}>{logs.length}</div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Recent Tool Calls</div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="card">
        <h3 style={{ marginBottom: "1rem" }}>Recent Activity</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Outcome</th>
                <th>Duration</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id}>
                  <td style={{ fontFamily: "monospace" }}>{log.namespaced_tool}</td>
                  <td>
                    {log.outcome === "success" ? (
                      <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><CheckCircle2 size={14} /> Success</span>
                    ) : (
                      <span className="badge badge-error" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><XCircle size={14} /> {log.outcome}</span>
                    )}
                  </td>
                  <td>{log.duration_ms} ms</td>
                  <td>{new Date(log.started_at).toLocaleString()}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>No recent activity found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
