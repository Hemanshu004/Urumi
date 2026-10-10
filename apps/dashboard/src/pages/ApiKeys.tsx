import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Copy, Trash2, CheckCircle2 } from "lucide-react";

export default function ApiKeys() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    try {
      const data = await api.getApiKeys();
      setKeys(data.keys);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label) return;
    try {
      const data = await api.createApiKey({ label });
      setNewKey(data.key);
      setLabel("");
      fetchKeys();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRevoke = async (id: number) => {
    if (confirm("Revoke this key? It will immediately stop working.")) {
      await api.revokeApiKey(id);
      fetchKeys();
    }
  };

  const handleCopy = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flexShrink: 0 }}>
        <h1 className="page-title">API Keys</h1>
        
        {newKey && (
          <div className="card" style={{ marginBottom: "2rem", border: "1px solid var(--success)", backgroundColor: "rgba(16, 185, 129, 0.05)" }}>
            <h3 style={{ color: "var(--success)", marginBottom: "1rem" }}>New API Key Created!</h3>
            <p style={{ marginBottom: "1rem" }}>Please copy this key now. You will not be able to see it again.</p>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <div style={{ flex: 1, padding: "1rem", backgroundColor: "var(--bg-dark)", borderRadius: "6px", fontFamily: "monospace", fontSize: "1.125rem", wordBreak: "break-all" }}>
                {newKey}
              </div>
              <button className="btn-primary" onClick={handleCopy} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {copied ? <><CheckCircle2 size={18}/> Copied</> : <><Copy size={18}/> Copy</>}
              </button>
            </div>
            <button style={{ marginTop: "1rem", background: "none", color: "var(--text-muted)", textDecoration: "underline" }} onClick={() => setNewKey(null)}>
              I have saved it securely
            </button>
          </div>
        )}

        <div className="card" style={{ marginBottom: "2rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Create New Key</h3>
          <form onSubmit={handleCreate} style={{ display: "flex", gap: "1rem" }}>
            <input
              type="text"
              className="input-field"
              style={{ marginBottom: 0 }}
              placeholder="Key Label (e.g., Local CLI, React App)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
              Generate Key
            </button>
          </form>
        </div>
      </div>
      
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 0, overflow: "hidden" }}>
        <div className="table-container" style={{ flex: 1, overflowY: "auto", minHeight: 0, border: "none", borderRadius: 0 }}>
          <table style={{ margin: 0 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Label</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Prefix</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Created</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Last Used</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Status</th>
                <th style={{ backgroundColor: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 500 }}>{k.label}</td>
                  <td style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{k.key_prefix}...</td>
                  <td>{new Date(k.created_at).toLocaleDateString()}</td>
                  <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}</td>
                  <td>
                    {k.revoked_at ? (
                      <span style={{ color: "var(--danger)" }}>Revoked</span>
                    ) : (
                      <span style={{ color: "var(--success)" }}>Active</span>
                    )}
                  </td>
                  <td>
                    {!k.revoked_at && (
                      <button onClick={() => handleRevoke(k.id)} style={{ padding: "0.5rem", background: "none", color: "var(--danger)" }} title="Revoke">
                        <Trash2 size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>No API keys found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
