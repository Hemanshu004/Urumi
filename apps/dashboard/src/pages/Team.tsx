import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function Team() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUsers()
      .then(data => setUsers(data.users))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1 className="page-title">Team Management</h1>
      
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
                  <td style={{ fontWeight: 500 }}>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <span style={{ 
                      padding: "0.25rem 0.5rem", 
                      backgroundColor: u.role === "admin" ? "rgba(59, 130, 246, 0.2)" : "rgba(255, 255, 255, 0.1)",
                      color: u.role === "admin" ? "var(--primary)" : "var(--text-main)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      textTransform: "uppercase"
                    }}>
                      {u.role}
                    </span>
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
