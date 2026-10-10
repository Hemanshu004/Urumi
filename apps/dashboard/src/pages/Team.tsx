import { useEffect, useState, useContext } from "react";
import { api } from "../services/api";
import { AuthContext } from "../App";

export default function Team() {
  const { user: currentUser } = useContext(AuthContext);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = () => {
    api.getUsers()
      .then(data => setUsers(data.users))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser({ email: newEmail, name: newName, password: newPassword, role: newRole });
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewRole("member");
      fetchUsers();
    } catch (err: any) {
      setError(err.message || "Failed to create user");
    }
  };

  const handleRoleChange = async (id: number, role: string) => {
    if (confirm("Change user role?")) {
      try {
        await api.updateUserRole(id, role);
        fetchUsers();
      } catch (err: any) {
        alert(err.message || "Failed to update role");
      }
    }
  };

  if (loading) return <div>Loading...</div>;

  const isAdmin = currentUser?.role === "admin";

  return (
    <div>
      <h1 className="page-title">Team Management</h1>
      
      {isAdmin && (
        <div className="card" style={{ marginBottom: "2rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>Add New User</h3>
          {error && <div style={{ color: "var(--danger)", marginBottom: "1rem" }}>{error}</div>}
          <form onSubmit={handleCreateUser} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "1rem", alignItems: "end" }}>
            <div>
              <label className="input-label">Email</label>
              <input type="email" required className="input-field" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
            <div>
              <label className="input-label">Name (optional)</label>
              <input type="text" className="input-field" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="input-label">Password</label>
              <input type="password" required minLength={8} className="input-field" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            </div>
            <div>
              <label className="input-label">Role</label>
              <select className="input-field" value={newRole} onChange={e => setNewRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button type="submit" className="btn-primary" style={{ gridColumn: "1 / -1", width: "fit-content" }}>Create User</button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.name || "-"}</td>
                  <td>{u.email}</td>
                  <td>
                    {isAdmin && u.id !== currentUser.id ? (
                      <select 
                        value={u.role} 
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        style={{ padding: "0.25rem", borderRadius: "4px", backgroundColor: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className={`badge ${u.role === 'admin' ? 'badge-warning' : 'badge-neutral'}`}>
                        {u.role}
                      </span>
                    )}
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
