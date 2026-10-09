# Urumi MCP Gateway

## 1. Project Overview
The Urumi MCP Gateway is an enterprise-grade Kubernetes-native architecture for securely aggregating, proxying, and exposing Model Context Protocol (MCP) servers. It provides a React dashboard, LLM agent chat interface, and external API integrations for seamless, secure tool usage.

## 2. Architecture
The architecture comprises:
- **Gateway (Node.js/Express):** Acts as the central MCP server and client. Aggregates upstream tools, performs RBAC, sanitizes LLM boundaries, and prevents credentials leakage.
- **Dashboard (React):** A user-friendly control panel for managing connected MCP servers, generating API keys, and chatting with the LLM Agent.
- **MCP Upstreams (Node.js):** Isolated microservices (e.g., `woo-mcp`, `github-mcp`, `weather-mcp`) bridging the Gateway to actual data sources like WooCommerce, GitHub APIs, and Weather endpoints.
- **Data Persistence:** PostgreSQL for Gateway configurations and MariaDB for WordPress.

## 3. Prerequisites
- Docker & Kind
- kubectl
- Helm

## 4. Local Kind Setup
Run `infra/scripts/setup-local.sh` to initialize the Kind cluster, ingress controllers, and storage provisioning.

## 5. Helm Deployment
Run `helm install urumi infra/helm/urumi -n urumi --create-namespace` to deploy all configurations and pods natively.
For development, use `values-local.yaml`, and for production, use `values-prod.yaml` using the exact same Helm chart.

## 6. WordPress/WooCommerce Setup
After deploying, run `infra/scripts/seed-woo.sh` to scaffold the store, create API credentials, and seed the initial database.

## 7. Dashboard Access
Navigate to [http://dashboard.urumi.local](http://dashboard.urumi.local).

## 8. Admin/Member Credentials Setup
By default, the seed script provisions:
- Admin: `admin@urumi.local` (Password: `admin123`)
- Member: `member@urumi.local` (Password: `member123`)

## 9. API Key Generation
Login to the Dashboard -> Navigate to 'API Keys' -> Generate a new key. Keys are irrevocably hashed in the database and tied to specific user IDs for audit attribution.

## 10. Connecting an External MCP Client
Configure your external MCP client (e.g., Claude Desktop) to target `http://api.urumi.local/mcp` and inject the HTTP header `Authorization: Bearer <API_KEY>`.

## 11. Chat Agent Usage
Login to the Dashboard, navigate to 'Agent Chat', and submit natural language prompts. The LLM processes the query, securely executes available Gateway tools via server-side logic, and returns results.

## 12. How to Place an Order
Navigate to [http://shop.urumi.local](http://shop.urumi.local). Add products to the cart and checkout using COD.

## 13. How to Test Upstream Failure
Navigate to the Dashboard, disable a specific upstream server, and observe the `tools/list` instantly reflecting the change. Alternatively, use `kubectl delete pod` on an MCP server; the Gateway strictly isolates the failure and keeps all other tools fully functional.

## 14. Audit Logs
Every executed tool—whether via Chat Agent or External MCP Client—is permanently logged in PostgreSQL, tracking user identity, tool latency, source boundaries, and outcomes.

## 15. Security Model
See `docs/SECURITY.md` for a comprehensive breakdown of NetworkPolicies, Non-root enforcements, SSRF prevention, and AES-256-GCM configurations.

## 16. Local vs Production Configuration
See `docs/ARCHITECTURE.md` for environmental disparities between `values-local.yaml` and `values-prod.yaml`.
