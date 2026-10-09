// Central API Service
// Use VITE_API_URL or fallback to http://api.urumi.local for local dev
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://api.urumi.local";

async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Ensure credentials (cookies) are always sent
  const config: RequestInit = {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  const response = await fetch(url, config);
  
  if (response.status === 401 && endpoint !== "/api/auth/login") {
    // If unauthorized and not logging in, we might want to trigger a logout
    // For simplicity, we can just throw and let the UI handle it
    throw new Error("Unauthorized");
  }
  
  if (!response.ok) {
    let errorMsg = "API Error";
    try {
      const errData = await response.json();
      errorMsg = errData.error || errData.message || errorMsg;
    } catch (e) {
      errorMsg = response.statusText;
    }
    throw new Error(errorMsg);
  }
  
  // Return null for 204 No Content
  if (response.status === 204) {
    return null;
  }
  
  return response.json();
}

export const api = {
  login: (data: any) => fetchApi("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),
  logout: () => fetchApi("/api/auth/logout", { method: "POST" }),
  
  getMe: () => fetchApi("/api/auth/me", { method: "GET" }),
  getUsers: () => fetchApi("/api/auth/users", { method: "GET" }),
  
  getServers: () => fetchApi("/api/servers", { method: "GET" }),
  addServer: (data: any) => fetchApi("/api/servers", { method: "POST", body: JSON.stringify(data) }),
  updateServer: (id: number, data: any) => fetchApi(`/api/servers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteServer: (id: number) => fetchApi(`/api/servers/${id}`, { method: "DELETE" }),
  
  getApiKeys: () => fetchApi("/api/api-keys", { method: "GET" }),
  createApiKey: (data: any) => fetchApi("/api/api-keys", { method: "POST", body: JSON.stringify(data) }),
  revokeApiKey: (id: number) => fetchApi(`/api/api-keys/${id}`, { method: "DELETE" }),
  
  getAuditLogs: () => fetchApi("/api/audit", { method: "GET" }),
  
  chat: (data: any) => fetchApi("/api/chat", { method: "POST", body: JSON.stringify(data) }),
};
