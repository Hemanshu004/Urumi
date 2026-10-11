# Urumi MCP Gateway

## What is Urumi?
Urumi is an AI-focused Model Context Protocol (MCP) Gateway built with Node.js/TypeScript, React, Kubernetes, and Helm. It acts as a central hub to securely aggregate, proxy, and expose multiple upstream MCP servers (such as WooCommerce, GitHub, and Weather). It provides a React dashboard, an LLM agent chat interface, and external API integrations for seamless, secure tool usage.

## Architecture & Main Components

```mermaid
flowchart TD
    Client[External MCP Client (e.g., Claude)] -->|HTTP/SSE| Gateway[Urumi Gateway (Express)]
    Browser[User Browser] -->|HTTP| Dashboard[React Dashboard]
    Dashboard -->|REST| Gateway
    Gateway -->|MCP HTTP Transport| Woo[woo-mcp]
    Gateway -->|MCP HTTP Transport| Github[github-mcp]
    Gateway -->|MCP HTTP Transport| Weather[weather-mcp]
    Woo -->|REST API| WooCommerce[WooCommerce/WordPress]
    Github -->|REST API| GithubAPI[GitHub API]
    Weather -->|REST API| WeatherAPI[Weather Service]
    Gateway <-->|SQL| DB[(MariaDB/PostgreSQL)]
```

### Main Components
- **Gateway (Node.js/Express):** Acts as the central MCP server and client. It handles authentication, RBAC, session management, SSRF validation, and audit logging.
- **Dashboard (React/Vite):** A Single Page Application (SPA) for managing connected MCP servers, generating API keys, viewing audit logs, and interacting with the LLM Chat Agent.
- **MCP Upstreams (Node.js):** Isolated microservices (`woo-mcp`, `github-mcp`, `weather-mcp`) that bridge the Gateway to external systems.
- **Database:** MariaDB (or PostgreSQL) for Gateway configuration (users, keys, servers, audit logs) and WordPress data.

## How the MCP Gateway Works
The Gateway operates in a dual role:
1. **As an MCP Client:** It uses `@modelcontextprotocol/client` to connect to upstream MCP servers using HTTP transports. It syncs tools from upstreams and namespaces them (e.g., `github__list_issues`).
2. **As an MCP Server:** It uses `@modelcontextprotocol/sdk/server` to expose the aggregated tools to external clients via the `/mcp` API route.

## How the Chat Agent Uses MCP Tools
Users can interact with an LLM via the `/api/chat` route. The flow is:
1. The user sends a prompt.
2. The Gateway provides the LLM with the user's prompt, conversation history, and a list of all available MCP tools (filtered by RBAC).
3. The LLM responds with tool calls.
4. The Gateway intercepts these tool calls, executes them securely against the appropriate upstream MCP servers, and records an audit log for each execution.
5. Tool results are fed back to the LLM (or directly to the user if final), and structured data is rendered natively on the dashboard.

## Authentication and API Keys
- **Dashboard Auth:** Users authenticate via `/api/auth/login` and receive a JWT stored in an HttpOnly cookie.
- **External Client Auth:** External MCP clients authenticate by passing an API key in the `Authorization: Bearer <API_KEY>` header to `/mcp`.
- **Key Management:** API keys are generated via the dashboard. The raw keys are shown once, and only a `bcrypt` hash and a prefix are stored in the database for security.

## RBAC (Role-Based Access Control)
The system supports `admin` and `member` roles. Tool-level RBAC is enforced per-tool. Admins have access to all tools, while members may be restricted from certain sensitive tools. Tool exposure in both the Chat Agent and `/mcp` endpoints is filtered based on the authenticated user's role.

## Audit Logging
Every tool execution (whether initiated by the Chat Agent or an external MCP client) is tracked and stored in the `audit_logs` table. The logs capture the user ID, upstream server, tool name, request parameters, outcome (success, error, timeout, denied), and execution duration.

## Upstream Server Management
Upstream servers can be managed (enabled/disabled) via the dashboard. The Gateway dynamically connects or disconnects these servers without restarting. When a server is connected, its URL is validated against SSRF attacks to ensure it does not access internal restricted networks unexpectedly. 

## Kubernetes Architecture
Urumi is designed to run on Kubernetes. The setup includes:
- **Deployments & Services:** For the Gateway, Dashboard, MariaDB, WordPress, and all MCP upstreams.
- **ConfigMaps & Secrets:** Environment variables and credentials are provided natively via K8s Secrets.
- **Ingress:** Routes external traffic to the Dashboard, Gateway API, and WordPress frontend.
- **NetworkPolicies:** Enforce strict pod-to-pod communication boundaries.

## Local Setup & Helm Deployment
### Prerequisites
- Docker & Kind
- kubectl
- Helm

### 1. Initialize Cluster
Run the provided script to initialize a local Kind cluster with ingress and storage:
```bash
./infra/scripts/setup-local.sh
```

### 2. Helm Deployment
Deploy the entire stack using Helm. 
```bash
helm install urumi infra/helm/urumi -n urumi --create-namespace
```
Secrets will be auto-generated if not provided. To create the initial admin and member accounts, you must explicitly provide passwords via `--set secrets.adminPassword=YOUR_PASSWORD --set secrets.memberPassword=YOUR_PASSWORD` or a values file.

### 3. WordPress/WooCommerce Scaffold
Once pods are running, initialize WooCommerce:
```bash
./infra/scripts/seed-woo.sh
```

## Required Environment Variables
To fully utilize the chat agent and external integrations, the following secrets should be defined in `secrets.yaml` or injected via Helm values (`.Values.secrets`):
- `LLM_API_KEY`: The API key for the LLM provider.
- `GITHUB_TOKEN`: A valid GitHub Personal Access Token for the `github-mcp` server.

## How to Run the Project & Verify Major Flows
1. **Access the Dashboard:** Go to `http://dashboard.urumi.local`.
2. **Login:** Use the admin credentials you provided via `.Values.secrets.adminPassword` (default email: `admin@urumi.local`). If you didn't provide a password during installation, no initial user is created.
3. **Verify Upstreams:** Navigate to the **Servers** page and ensure the upstream servers (`woo-mcp`, `github-mcp`, `weather-mcp`) are connected. You can disable/enable them here to test isolation.
4. **Chat Agent Flow:** Navigate to **Chat**, ask a question (e.g., "What is the weather in London?"), and observe the agent automatically invoking the `weather__get_weather` tool.
5. **Verify Audit Logs:** Go to the **Audit Logs** page to see the record of your recent tool executions.
6. **Generate API Key:** In the **API Keys** section, generate a key and configure your local external MCP client (like Claude Desktop) to connect to `http://api.urumi.local/mcp`.

## Operations & Security

### User and Role Management
Users can be assigned either an `admin` or `member` role. Role updates instantly limit access to administrative dashboard routes.

### Granting and Revoking Tool Permissions
Permissions are dynamically managed per role. Revoking a tool's permission immediately interrupts access in the Chat interface and External MCP endpoints without requiring session resets.

### API Key Creation and Revocation
Generate API keys for external MCP clients in the dashboard. The raw key is only shown once. Revoking a key terminates access instantly with a `401 Unauthorized` response on the next SSE heartbeat or REST call.

### Upstream Configuration and Credential Management
Upstream servers can be edited and toggled (enabled/disabled). Decrypted upstream credentials (like GitHub tokens or Woo API keys) are injected securely via the Gateway DB directly to the execution layer.

### Troubleshooting Disconnected MCP Servers
If an upstream disconnects:
1. The gateway executes an exponential backoff health loop with jitter.
2. Check the **Servers** tab for the exact failure reason (e.g. `ECONNREFUSED` or `Timeout`).
3. The Gateway logs (`/health/live`) continue functioning.
4. If a server is permanently unavailable, disable it in the UI to halt reconnection attempts.

### Backup, Restore, and Secret Rotation Limitations
- **Backup:** Use standard Postgres/MariaDB dump utilities to backup `gateway-db`.
- **Secret Rotation:** Currently, rotating the master `JWT_SECRET` invalidates all active dashboard sessions. 
- **Limitations:** API key hashes cannot be reversed; lost keys must be regenerated.

### Known Risks and Security Boundaries
- **SSRF Mitigation:** IP restrictions prevent LLM tools from pinging internal cloud metadata (e.g., `169.254.169.254`).
- **NetworkPolicies:** Pods are tightly constrained; `woo-mcp` can only communicate with the `wordpress` pod.
- **Warning:** Do NOT expose the upstream MCP microservices (ports 3001+) directly to external ingress.

## k3s/VPS Deployment Instructions

Deploying Urumi to a k3s cluster on a VPS provides a lightweight, production-ready environment.

### Prerequisites & Cluster Access
- **VPS:** A Linux VPS with port 80 open.
- **k3s Installed:** Install k3s (which includes a local-path storage provider and Traefik ingress by default).
- **Helm Installed:** Ensure Helm is installed on your VPS.
- **Kubeconfig:** Ensure you have cluster access (e.g., `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml`).

### DNS Configuration
Point your domains (e.g., `shop.example.com`, `api.example.com`, `dashboard.example.com`) to your VPS's public IP address.

### Custom Values Configuration (`values-prod.yaml`)
Create a `values-prod.yaml` file to configure your hostnames, storage, and replicas. **Note:** Replace the example hostnames with your actual production domains.
```yaml
# Required: Configure your actual domains
ingress:
  enabled: true
  className: "traefik" # k3s default, or "nginx" if you installed ingress-nginx
  hosts:
    shop: shop.example.com
    api: api.example.com
    dashboard: dashboard.example.com

# Optional: Explicitly specify the k3s storage class, or leave empty ("") to use the cluster default
gatewayDb:
  persistence:
    storageClass: "local-path"
wordpressDb:
  storageClass: "local-path"
wordpress:
  storageClass: "local-path"

# Optional: Scale replicas if your node has sufficient resources
gateway:
  replicas: 2
wooMcp:
  replicas: 2
```

*(Note on TLS and Ingress Limitations: The Urumi Helm chart currently generates HTTP-only Ingress resources. It does not natively support automated TLS blocks or cert-manager integration in its templates. TLS termination must be handled globally by your Ingress controller default certificate or a load balancer sitting in front of the cluster.)*

### Installation Command
Install or upgrade the chart using Helm. You must explicitly provide strong secrets.
```bash
helm upgrade --install urumi ./infra/helm/urumi -n urumi --create-namespace \
  -f values-prod.yaml \
  --set secrets.adminPassword="STRONG_ADMIN_PASSWORD" \
  --set secrets.memberPassword="STRONG_MEMBER_PASSWORD" \
  --set secrets.jwtSecret="STRONG_32_CHAR_JWT_SECRET" \
  --set secrets.llmApiKey="YOUR_LLM_PROVIDER_KEY"
```

### Basic Verification
1. **Check Pods:** Run `kubectl get pods -n urumi` to ensure all workloads are `Running` and PVCs are `Bound`.
2. **Access the Dashboard:** Visit `http://dashboard.example.com` (using your configured host) and log in with your admin credentials.
