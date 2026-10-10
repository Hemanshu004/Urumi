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
Secrets will be auto-generated for passwords if not provided, though you can pass explicit values via `--set` or a values file.

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
2. **Login:** Use the default admin credentials (`admin@urumi.local` / `admin123`).
3. **Verify Upstreams:** Navigate to the **Servers** page and ensure the upstream servers (`woo-mcp`, `github-mcp`, `weather-mcp`) are connected. You can disable/enable them here to test isolation.
4. **Chat Agent Flow:** Navigate to **Chat**, ask a question (e.g., "What is the weather in London?"), and observe the agent automatically invoking the `weather__get_weather` tool.
5. **Verify Audit Logs:** Go to the **Audit Logs** page to see the record of your recent tool executions.
6. **Generate API Key:** In the **API Keys** section, generate a key and configure your local external MCP client (like Claude Desktop) to connect to `http://api.urumi.local/mcp`.

## Standout Features
- **Dual-Role MCP Architecture:** Operates as both an MCP Client (to upstreams) and an MCP Server (to external clients), seamlessly aggregating and namespacing tools.
- **Dynamic Server Management:** Connect or disable upstream MCP servers dynamically through the Dashboard without restarting the Gateway.
- **Robust SSRF Prevention:** Strictly evaluates internal/external IP addresses to prevent external LLM inputs from exploiting internal metadata endpoints.
- **Role-Based Access Control:** Highly granular tool-level RBAC restricting `member` access to sensitive capabilities while allowing `admin` full operation.
- **Extensive Audit Logging:** Cryptographically hashed API keys tied intrinsically to User IDs, creating a non-repudiable ledger of all executions, their duration, and outcome boundaries.
- **Helm Local/Prod Parity:** Uses a single, unified Helm chart for both `kind` local deployment and clustered production environments, relying strictly on values overrides.
