import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Check, X, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";

interface Tool {
  namespacedName: string;
  originalToolName?: string;
  description: string;
  isAvailable?: boolean;
}

interface Server {
  id: number;
  name: string;
  status: string;
  tools?: Tool[];
}

interface Permission {
  id: number;
  namespacedTool: string;
}

export default function Permissions() {
  const [servers, setServers] = useState<Server[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [serversRes, permsRes] = await Promise.all([
        api.getServers(),
        api.getPermissions("member")
      ]);
      setServers(serversRes.servers || []);
      setPermissions(permsRes.permissions || []);
    } catch (err: any) {
      setError(err.message || "Failed to load tools and permissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleGrant = async (namespacedTool: string) => {
    setActionLoading(namespacedTool);
    try {
      await api.grantPermission("member", namespacedTool);
      // Optimistic update
      setPermissions(prev => [...prev, { id: Date.now(), namespacedTool }]);
    } catch (err: any) {
      alert(err.message || "Failed to grant permission");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevoke = async (namespacedTool: string) => {
    if (!window.confirm(`Are you sure you want to revoke access to ${namespacedTool}?`)) return;
    setActionLoading(namespacedTool);
    try {
      await api.revokePermission("member", namespacedTool);
      // Optimistic update
      setPermissions(prev => prev.filter(p => p.namespacedTool !== namespacedTool));
    } catch (err: any) {
      alert(err.message || "Failed to revoke permission");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div>Loading...</div>;

  const allowedToolSet = new Set(permissions.map(p => p.namespacedTool));

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.5rem" }}>Tool Permissions</h1>
          <p style={{ color: "var(--text-muted)" }}>Manage which upstream tools are available to members.</p>
        </div>
      </div>

      {error && (
        <div style={{ padding: "1rem", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", color: "#ef4444", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {servers.length === 0 ? (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>No servers connected.</p>
        </div>
      ) : (
        servers.map(server => {
          // Merge available tools with granted but currently unavailable tools
          const displayToolsMap = new Map<string, Tool>();
          
          if (server.tools) {
            server.tools.forEach(t => displayToolsMap.set(t.namespacedName, { ...t, isAvailable: true }));
          }
          
          // Find permissions belonging to this server
          const grantedForServer = permissions.filter(p => p.namespacedTool.startsWith(`${server.name}__`));
          grantedForServer.forEach(p => {
            if (!displayToolsMap.has(p.namespacedTool)) {
              displayToolsMap.set(p.namespacedTool, {
                namespacedName: p.namespacedTool,
                description: "Tool is currently unavailable (upstream disconnected).",
                isAvailable: false
              });
            }
          });
          
          const mergedTools = Array.from(displayToolsMap.values());

          return (
          <div key={server.id} className="card" style={{ marginBottom: "2rem", overflow: "hidden" }}>
            <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--bg-elevated)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <h2 style={{ fontSize: "1.125rem" }}>{server.name}</h2>
                {server.status === "connected" ? (
                  <span className="badge badge-success">Connected</span>
                ) : (
                  <span className="badge badge-error">Disconnected</span>
                )}
              </div>
            </div>

            {mergedTools.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
                {server.status === "connected" ? "No tools available from this server." : "Server is disconnected and has no granted permissions."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-panel)" }}>
                      <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: "var(--text-muted)" }}>Tool Name</th>
                      <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: "var(--text-muted)" }}>Description</th>
                      <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: "var(--text-muted)", width: "120px" }}>Status</th>
                      <th style={{ padding: "1rem", textAlign: "right", fontWeight: 600, color: "var(--text-muted)", width: "120px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedTools.map(tool => {
                      const isAllowed = allowedToolSet.has(tool.namespacedName);
                      const isProcessing = actionLoading === tool.namespacedName;
                      const isAvailable = tool.isAvailable;

                      return (
                        <tr key={tool.namespacedName} style={{ borderBottom: "1px solid var(--border)", opacity: isAvailable ? 1 : 0.6 }}>
                          <td style={{ padding: "1rem" }}>
                            <div style={{ fontFamily: "monospace", color: "var(--primary)", backgroundColor: "rgba(255,107,44,0.1)", padding: "0.2rem 0.4rem", borderRadius: "4px", display: "inline-block" }}>
                              {tool.namespacedName}
                            </div>
                            {!isAvailable && <div style={{ fontSize: "0.7rem", color: "#ef4444", marginTop: "0.25rem" }}>Unavailable</div>}
                          </td>
                          <td style={{ padding: "1rem", color: "var(--text-muted)", maxWidth: "300px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={tool.description}>
                            {tool.description}
                          </td>
                          <td style={{ padding: "1rem" }}>
                            {isAllowed ? (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#10b981" }}>
                                <ShieldCheck size={16} /> Allowed
                              </div>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)" }}>
                                <ShieldAlert size={16} /> Unclassified
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "1rem", textAlign: "right" }}>
                            {isProcessing ? (
                              <Loader2 size={16} className="spin" style={{ color: "var(--text-muted)" }} />
                            ) : isAllowed ? (
                              <button onClick={() => handleRevoke(tool.namespacedName)} className="btn-secondary" disabled={isProcessing} style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", borderColor: "#ef4444", color: "#ef4444" }}>
                                <X size={14} style={{ marginRight: "0.25rem" }} /> Revoke
                              </button>
                            ) : (
                              <button onClick={() => handleGrant(tool.namespacedName)} className="btn-primary" disabled={isProcessing || !isAvailable} style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", opacity: !isAvailable ? 0.5 : 1 }}>
                                <Check size={14} style={{ marginRight: "0.25rem" }} /> Grant
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          );
        })
      )}
    </div>
  );
}
