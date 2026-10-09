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
    <div>
      <h1 className="page-title">Audit Logs</h1>
      
      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Source</th>
                <th>Server</th>
                <th>Tool</th>
                <th>Outcome</th>
                <th>Duration</th>
                <th>Error</th>
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
                      <span style={{ color: "var(--success)", display: "flex", alignItems: "center", gap: "0.25rem" }}><CheckCircle2 size={16}/> Success</span>
                    ) : log.outcome === "timeout" ? (
                      <span style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: "0.25rem" }}><AlertCircle size={16}/> Timeout</span>
                    ) : (
                      <span style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: "0.25rem" }}><XCircle size={16}/> Error</span>
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
