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
    <div className="auth-container">
      <div className="card auth-card">
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <Server size={48} color="var(--primary)" style={{ marginBottom: "1rem" }} />
          <h2>Urumi Gateway</h2>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>Sign in to continue</p>
        </div>
        
        {error && (
          <div style={{ padding: "0.75rem", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: "6px", marginBottom: "1rem" }}>
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem" }}>Email</label>
            <input
              type="email"
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem" }}>Password</label>
            <input
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" style={{ width: "100%", marginTop: "1rem", padding: "0.75rem" }} disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
