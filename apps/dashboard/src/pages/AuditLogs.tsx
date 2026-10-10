import { useEffect, useState } from "react";
import { api } from "../services/api";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export default function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAuditLogs()
      .then(data => setLogs(data.logs || []))
      .catch(err => {
        console.error(err);
        setError(err.message || "Failed to load audit logs");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "var(--danger)" }}>{error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flexShrink: 0 }}>
        <h1 className="page-title">Audit Logs</h1>
      </div>
      
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 0, overflow: "hidden", marginBottom: "0.5rem" }}>
        <div className="table-container" style={{ flex: 1, overflowY: "auto", minHeight: 0, border: "none", borderRadius: 0 }}>
          <table style={{ margin: 0 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Time</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>User</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Source</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Server</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Tool</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Outcome</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Duration</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td>{new Date(log.started_at).toLocaleString()}</td>
                  <td>{log.user_id ? `User ${log.user_id}` : "API Key / System"}</td>
                  <td>{log.source}</td>
                  <td>{log.server_id ? `Server ${log.server_id}` : "-"}</td>
                  <td style={{ fontFamily: "monospace" }}>{log.namespaced_tool}</td>
                  <td>
                    {log.outcome === "success" ? (
                      <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><CheckCircle2 size={14}/> Success</span>
                    ) : log.outcome === "timeout" ? (
                      <span className="badge badge-warning" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><AlertCircle size={14}/> Timeout</span>
                    ) : (
                      <span className="badge badge-error" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><XCircle size={14}/> Error</span>
                    )}
                  </td>
                  <td>{log.duration_ms} ms</td>
                  <td style={{ color: "var(--danger)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.error_message}>
                    {log.error_message}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>No audit logs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
