import { useState, useContext } from "react";
import { AuthContext } from "../App";
import { Server } from "lucide-react";

export default function Login() {
  const { login } = useContext(AuthContext);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ email, password });
    } catch (err: any) {
      setError(err.message || "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="auth-container" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", backgroundColor: "var(--bg-dark)", padding: "1rem" }}>
      <div className="card auth-card" style={{ width: "100%", maxWidth: "420px", padding: "2.5rem 2rem", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ display: "inline-flex", padding: "0.75rem", backgroundColor: "rgba(255, 107, 44, 0.1)", borderRadius: "12px", marginBottom: "1rem" }}>
            <Server size={32} color="var(--primary)" />
          </div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "var(--text-main)" }}>Urumi Gateway</h2>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", fontSize: "0.9375rem" }}>Sign in to continue</p>
        </div>
        
        {error && (
          <div style={{ padding: "0.75rem", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid var(--error)", color: "var(--error)", borderRadius: "6px", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)" }}>Email</label>
            <input
              type="email"
              className="input-field"
              style={{ padding: "0.625rem 0.75rem", height: "44px" }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)" }}>Password</label>
            <input
              type="password"
              className="input-field"
              style={{ padding: "0.625rem 0.75rem", height: "44px", marginBottom: 0 }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" style={{ width: "100%", height: "44px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 600 }} disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
