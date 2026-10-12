# Urumi MCP Gateway

Urumi is an enterprise-grade AI Model Context Protocol (MCP) Gateway built with TypeScript, Node.js/Express, React, Kubernetes, and Helm. It acts as a secure, centralized reverse proxy that aggregates, namespaces, authorizes, and audits multiple upstream MCP microservices (including WooCommerce, GitHub, and Weather) for consumption by Large Language Models (LLMs) and external MCP clients (such as Claude Desktop and MCP Inspector).

---

## 1. Project Overview

### Problem Solved
Modern Large Language Models require access to private business tools and data sources. Direct connection between models/clients and raw backend APIs introduces severe operational and security challenges:
- **Credential Proliferation & Exposure:** Giving LLMs or client applications raw database credentials, GitHub tokens, or WooCommerce API keys risks catastrophic data loss, unauthorized access, and credential leakage.
- **Lack of Governance & Identity Attribution:** External tools execute with high platform privileges without knowing which end-user triggered the action.
- **Tool Collisions & Monolithic Bloat:** Combining multiple microservices with similar tool names (e.g. `search`, `get_status`) causes namespace collisions.
- **Cascading Failures:** When an upstream tool microservice crashes or times out, it should not bring down the entire AI assistant.

### How Urumi Solves This
1. **Centralized Gateway as PEP/PDP:** Serves as both Policy Enforcement Point and Policy Decision Point. Enforces per-tool Role-Based Access Control (RBAC), Server-Side Request Forgery (SSRF) validation, and immutable audit logs.
2. **Dual-Role MCP Architecture:** Operates as an MCP Client to internal upstream microservices and exposes a single unified MCP Server endpoint (`/mcp`) externally.
3. **Collision-Safe Namespacing:** Deterministically prefixes upstream tools (`${serverName}__${toolName}`) to prevent name collisions across heterogeneous upstreams.
4. **Credential Isolation:** Client credentials (JWT tokens or API keys) strictly terminate at the Gateway. Upstreams run in isolated network zones and receive only internal credentials.
5. **Fault Isolation & Health Monitoring:** Independent pod deployments and automated background health loops ensure that a failure in one service does not affect others.

---

### Technology Stack
- **API Gateway Backend:** Node.js 22, Express 4, TypeScript, `@modelcontextprotocol/sdk` v1.0, `@modelcontextprotocol/server` v2.3, `@modelcontextprotocol/client` v2.3, Drizzle ORM, PostgreSQL (`pg`), Jose (JWT), Bcrypt, Helmet, CORS.
- **Administrative Dashboard:** React 19, TypeScript, Vite, React Router v7, Lucide Icons, Pure Vanilla CSS design system (zero Tailwind dependency).
- **Upstream MCP Microservices:**
  - `woo-mcp`: Node.js, Express, `@woocommerce/woocommerce-rest-api` v3.
  - `github-mcp`: Node.js, Express, `@octokit/rest`.
  - `weather-mcp`: Node.js, Express, Open-Meteo REST API.
- **Databases & Applications:** PostgreSQL 15 (`gateway-db`), WordPress 6.7 + WooCommerce 8.7, MariaDB 11 (`wordpress-db`).
- **Infrastructure & Orchestration:** Kubernetes (Kind / k3s), Ingress-Nginx / Traefik, Helm v3, Docker.

---

### Architecture Diagram

```mermaid
flowchart TD
    subgraph Clients
        Browser[User Web Browser]
        ExtClient[External MCP Client<br/>e.g., Claude Desktop, Inspector]
    end

    subgraph Ingress Layer
        Ingress[Kubernetes Ingress Controller<br/>Nginx / Traefik]
    end

    subgraph Urumi Core Platform
        Dashboard[urumi-dashboard<br/>React SPA / Nginx<br/>Port 8080]
        Gateway[urumi-gateway<br/>Node.js Express MCP Gateway<br/>Port 3000]
        GatewayDB[(gateway-db<br/>PostgreSQL 15<br/>Port 5432)]
    end

    subgraph Internal MCP Upstream Services
        WooMCP[woo-mcp<br/>WooCommerce MCP Service<br/>Port 3001]
        GithubMCP[github-mcp<br/>GitHub MCP Service<br/>Port 3002]
        WeatherMCP[weather-mcp<br/>Weather MCP Service<br/>Port 3003]
    end

    subgraph External Systems & Backends
        WooCommerce[WordPress / WooCommerce Store<br/>Port 80]
        WooDB[(wordpress-db<br/>MariaDB 11<br/>Port 3306)]
        GithubAPI[GitHub REST API]
        WeatherAPI[Open-Meteo Weather API]
        LLMProvider[LLM Provider<br/>Groq / Gemini / OpenAI]
    end

    Browser -->|shop.urumi.local| Ingress
    Browser -->|dashboard.urumi.local| Ingress
    Browser -->|api.urumi.local| Ingress
    ExtClient -->|/mcp Bearer Token| Ingress

    Ingress -->|/| Dashboard
    Ingress -->|/api, /mcp, /health| Gateway
    Ingress -->|/| WooCommerce

    Dashboard -->|REST API & JWT Cookie| Gateway
    Gateway <-->|Drizzle ORM| GatewayDB
    Gateway <-->|Prompts & Tool Schemas| LLMProvider

    Gateway -->|Streamable HTTP / SSE| WooMCP
    Gateway -->|Streamable HTTP / SSE| GithubMCP
    Gateway -->|Streamable HTTP / SSE| WeatherMCP

    WooMCP <-->|REST API v3| WooCommerce
    WooCommerce <-->|MariaDB SQL| WooDB
    GithubMCP <-->|Octokit| GithubAPI
    WeatherMCP <-->|REST API| WeatherAPI
```

---

### Request Flow
1. **Tool Discovery:** Upon initialization, the Gateway queries registered upstream servers via `listTools()`, prefixes their names (e.g. `woocommerce__list_products`), and registers them in an in-memory tool registry.
2. **Client Interaction:**
   - **Chat Agent:** A user submits a query via the dashboard chat (`POST /api/chat`). The Gateway verifies the JWT cookie, extracts user role permissions, passes only allowed tool definitions to the LLM, intercepts generated tool calls, executes them securely, writes audit logs, and returns the response.
   - **External Client:** An external MCP client connects to `http://api.urumi.local/mcp` with an `Authorization: Bearer <API_KEY>` header. The Gateway verifies the key's bcrypt hash and prefix, filters tools by caller role, and processes requests over SSE or Streamable HTTP.
3. **Execution & Routing:** When an authorized tool is executed, the Gateway resolves the namespaced tool, strips null arguments, and invokes the tool on the appropriate upstream pod with a 30-second timeout.
4. **Upstream Operation:** The upstream microservice (`woo-mcp`) transforms the JSON-RPC request into an authenticated REST call to WooCommerce using internal credentials.
5. **Auditing & Attribution:** Every tool invocation (success, error, timeout, or denied) is persistently committed to the PostgreSQL `audit_logs` table with full argument payloads, high-resolution duration, outcome, and user ID.

---

## 2. Prerequisites & System Requirements

### Supported Tool Versions
- **Docker:** Engine v24.0+ or Docker Desktop v4.20+ (`docker info`)
- **Kind (Kubernetes in Docker):** v0.20+ (`kind version`)
- **kubectl:** v1.28+ (`kubectl version --client`)
- **Helm:** v3.12+ (`helm version`)
- **Node.js:** v20+ (for running test scripts locally)

### Local Resource & Port Requirements
- **Memory:** Minimum 4 GB RAM available for Docker.
- **CPU:** Minimum 2 CPU cores allocated to Docker.
- **Local Ports:** Port `80` and `443` must be available on `127.0.0.1` (used by Kind Ingress-Nginx). Ensure no local web servers (Apache, Nginx, or Caddy) are listening on port 80.

### Local Hosts Configuration
Add the following entry to your `/etc/hosts` file (or `C:\Windows\System32\drivers\etc\hosts` on Windows):
```text
127.0.0.1 shop.urumi.local api.urumi.local dashboard.urumi.local
```

### External Credentials (Optional)
To enable the LLM Chat Agent and GitHub integration:
- `LLM_API_KEY`: API key for Groq (default), OpenAI, or Google Gemini.
- `GITHUB_TOKEN`: GitHub Personal Access Token (for `github-mcp` issue and repository querying).

---

## 3. Local Deployment (Step-by-Step)

The local deployment is fully reproducible and automated. Commands that run sequentially are shown in sequence; separate terminal requirements are explicitly called out.

### Step 1: Clone and Enter the Repository
```bash
git clone https://github.com/Hemanshu004/urumi.git
cd urumi
```

### Step 2: Configure Environment & Make Scripts Executable
```bash
chmod +x infra/scripts/*.sh
```

### Step 3: Run Automated Cluster Setup
Run the canonical setup script. This script executes all steps sequentially and idles until all pods are ready:
```bash
./infra/scripts/setup-local.sh
```

**Sequential operations performed by `setup-local.sh`:**
1. Creates the Kind cluster `urumi-local` with port 80/443 bindings (`infra/kind/cluster-config.yaml`).
2. Installs `ingress-nginx` for Kind and waits for the controller pod to become ready.
3. Automatically triggers `./infra/scripts/build-local-images.sh` to build and load all 5 custom application images into Kind's container runtime:
   - `urumi-gateway:latest`
   - `urumi-dashboard:latest`
   - `urumi-woo-mcp:latest`
   - `urumi-github-mcp:latest`
   - `urumi-weather-mcp:latest`
4. Deploys the unified Helm chart with `values.yaml` and `values-local.yaml`.
5. Waits for all database (MariaDB, PostgreSQL) and application pods to reach `Ready 1/1` status.

---

### (Optional) Terminal 2: Monitor Workload Initialization
In a **separate terminal window**, monitor pod readiness in real time:
```bash
kubectl --context kind-urumi-local get pods -n urumi -w
```
Wait until all 8 pods transition to `Running` and `1/1 Ready`:
```text
NAME                               READY   STATUS    RESTARTS   AGE
github-mcp-xxx                     1/1     Running   0          2m
urumi-dashboard-xxx                1/1     Running   0          2m
urumi-gateway-xxx                  1/1     Running   0          2m
urumi-gateway-db-0                 1/1     Running   0          2m
urumi-woo-mcp-xxx                  1/1     Running   0          2m
urumi-wordpress-xxx                1/1     Running   0          2m
urumi-wordpress-db-0               1/1     Running   0          2m
weather-mcp-xxx                    1/1     Running   0          2m
```

---

### Step 4: Seed WooCommerce Store & REST API Keys
Once `setup-local.sh` finishes, initialize WooCommerce, sample catalog items, Cash on Delivery, and API keys:
```bash
./infra/scripts/seed-woo.sh
```

### Step 5: Verify Deployment Health
```bash
# 1. Gateway Liveness
curl -s http://api.urumi.local/health/live
# Expected output: {"status":"healthy"}

# 2. Gateway Readiness (Database connectivity verified)
curl -s http://api.urumi.local/health/ready
# Expected output: {"status":"ready"}

# 3. Informational API Root
curl -s http://api.urumi.local/
# Expected output: {"message":"Urumi MCP Gateway API","version":"0.1.0"}
```

### Verified Local URLs
- **Dashboard:** [http://dashboard.urumi.local](http://dashboard.urumi.local)
- **Storefront:** [http://shop.urumi.local](http://shop.urumi.local)
- **Storefront Admin:** [http://shop.urumi.local/wp-admin](http://shop.urumi.local/wp-admin)
- **API Gateway:** [http://api.urumi.local](http://api.urumi.local)

### Default Development Credentials
> **Important Distinction:** WordPress and Urumi are separate systems with independent authentication databases. The WordPress store administrator credentials manage the upstream ecommerce store at `shop.urumi.local/wp-admin`, while Urumi credentials manage the MCP Gateway and Dashboard at `dashboard.urumi.local`. Only these local development credentials are configured in the repository; never expose or reuse production secrets.

| System | Role / Account | Login URL | Identifier | Password | Origin in Repo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Urumi Dashboard** | Administrator | `http://dashboard.urumi.local` | `admin@urumi.local` | `admin123` | Seeded via `values-local.yaml` |
| **Urumi Dashboard** | Member | `http://dashboard.urumi.local` | `member@urumi.local` | `member123` | Seeded via `values-local.yaml` |
| **WordPress / WooCommerce** | Store Administrator | `http://shop.urumi.local/wp-login.php` | `admin` | `password` | Seeded via `infra/scripts/seed-woo.sh` |

---

## 4. WooCommerce Workflow

### 1. Storefront Browsing & Product Selection
1. Open the storefront at `http://shop.urumi.local/shop/`.
2. Locate the seeded product **Urumi T-Shirt** ($19.99).
3. Click **Add to cart**.

### 2. Test-Friendly Checkout
1. Click **View cart** or navigate to `http://shop.urumi.local/cart/`.
2. Click **Proceed to checkout** (`http://shop.urumi.local/checkout/`).
3. Fill in test customer billing details:
   - First Name: `John`, Last Name: `Doe`
   - Street Address: `123 Test Street`, City: `Testville`, Postcode: `12345`
   - Phone: `555-555-5555`, Email: `john@example.com`
4. Under Payment Options, select **Cash on delivery**.
5. Click **Place order**.
6. Note the generated Order ID on the receipt page (e.g. `#24`).

### 3. Verify in WooCommerce Administration
1. Go to `http://shop.urumi.local/wp-login.php`.
2. Log in with `admin` / `password`.
3. In the sidebar, navigate to **WooCommerce > Orders**.
4. Confirm the new order for `John Doe` is listed with status `Processing`.

### 4. Chat Agent Integration
1. Log in to the Urumi Dashboard at `http://dashboard.urumi.local` with `admin@urumi.local` / `admin123`.
2. Click the **Chat** tab.
3. **Create a Product:**
   ```text
   Create a new WooCommerce product named "Urumi Canvas Backpack" priced at 65.00 with description "Durable waterproof canvas bag."
   ```
   *The agent invokes `woocommerce__create_product`, reports success, and the item immediately appears on `http://shop.urumi.local/shop/`.*
4. **Query Orders:**
   ```text
   What are the recent orders in WooCommerce?
   ```
   *The agent invokes `woocommerce__list_orders` and renders the structured orders table showing order `#24`.*

---

## 5. External MCP Client Integration

### Gateway MCP Endpoint
- **URL:** `http://api.urumi.local/mcp`
- **Supported Transports:**
  - **Server-Sent Events (SSE):** Accessible via `GET /mcp` (or `/mcp/sse`). Establishes a persistent SSE stream and assigns a `sessionId`. Client sends subsequent JSON-RPC messages via `POST /mcp/message?sessionId=<sessionId>`.
  - **Streamable HTTP:** Accessible via `POST /mcp`. Directly accepts JSON-RPC 2.0 payloads and returns chunked or standard HTTP responses via `@modelcontextprotocol/server`.
- **Authentication:** Mandatory HTTP Header:
  ```text
  Authorization: Bearer <USER_API_KEY>
  ```

### API Key Generation
1. In the Dashboard (`http://dashboard.urumi.local`), log in as `member@urumi.local` (password: `member123`).
2. Navigate to the **API Keys** tab and click **Create Key**.
3. Label it `My External Client`.
4. Copy the raw key (`urumi_<64-hex-chars>`).

### Discovering Tools & Executing Calls
Execute requests directly from your terminal using curl or an MCP client:

```bash
API_KEY="urumi_YOUR_COPIED_KEY_HERE"

# 1. Discover permitted tools (tools/list)
curl -s -X POST http://api.urumi.local/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }' | jq .

# 2. Execute a tool call (tools/call)
curl -s -X POST http://api.urumi.local/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "weather__get_weather",
      "arguments": {
        "latitude": 40.7128,
        "longitude": -74.0060
      }
    }
  }' | jq .
```

### Configuring Claude Desktop
In Claude Desktop's configuration (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "urumi": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://api.urumi.local/mcp",
        "--header",
        "Authorization: Bearer urumi_YOUR_COPIED_KEY_HERE"
      ]
    }
  }
}
```

### API Key Revocation Verification
1. On the **API Keys** tab in the dashboard, click **Revoke** on the key.
2. Attempt to issue any subsequent tool discovery or execution call:
   ```bash
   curl -s -i -X POST http://api.urumi.local/mcp \
     -H "Authorization: Bearer $API_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}'
   ```
3. **Verification:** The request is rejected immediately with **`HTTP/1.1 401 Unauthorized`** and `{"error":"Invalid or revoked API key"}`.

### Transport Limitations & Session Guidance
- **In-Memory SSE Sessions:** The Gateway tracks active SSE streams in process memory (`sseTransports` in `apps/gateway/src/mcp/server.ts`).
- **Gateway Replica Constraint:** `gateway.replicas` must remain at `1`. Multiple replicas without sticky sessions at the Ingress controller will cause `POST /mcp/message?sessionId=...` calls routed to a different replica to fail with `404 Session not found`.
- **Transport Distinction:** Do not conflate SSE with Streamable HTTP. SSE maintains a long-lived GET connection; Streamable HTTP handles discrete POST requests via `@modelcontextprotocol/server`. Both are supported on `/mcp`.

---

## 6. Administration & Operations

### Upstream Server Registration & Management
- **Registration (`/api/servers`):** Admins can add custom upstream MCP servers with URL and timeout configuration.
- **SSRF Validation:** The Gateway strictly validates registered URLs, blocking loopback, AWS/GCP metadata (`169.254.169.254`), and unauthorized private RFC1918 subnets.
- **Runtime Disablement:** Toggling an upstream to "Disabled" drops all its tools from the registry and terminates active upstream sessions without restarting the Gateway.

### Role-Based Access Control (RBAC) & Tool Permissions
- **Admin Role:** Full access to all tools, server management, team member administration, and audit logs.
- **Member Role:** Access restricted to tools granted in the `role_permissions` table.
- **Permission Toggling:** Admins can grant or revoke tool permissions on the **Permissions** page. Revocation takes effect instantly across both Chat and external `/mcp` endpoints.

### Persistent Audit Logging
- Every tool invocation commits an entry to the `audit_logs` table.
- Captures: `User ID`, `Server ID`, `Tool Name`, `Arguments JSON`, `Execution Outcome` (`success`, `error`, `timeout`, `denied`), `Duration (ms)`, and `Timestamp`.
- Accessible to administrators on the **Audit Logs** dashboard page.

### Troubleshooting Common Errors
- **`ErrImageNeverPull`**: A custom application image is missing from Kind. Run `./infra/scripts/build-local-images.sh urumi-local`.
- **`401 Unauthorized` on `/mcp`**: The API key is invalid, improperly formatted, or has been revoked. Ensure the key starts with `urumi_` and is passed via `Authorization: Bearer <KEY>`.
- **`403 Forbidden` on Tool Call**: The caller's role does not have permission for the tool. Grant permission in the dashboard under **Permissions**.
- **`502 Bad Gateway` on Ingress**: Pods are still starting up. Run `kubectl get pods -n urumi` to inspect workload readiness.

---

## 7. Production Deployment (k3s / Linux VPS)

> **Deployment Validation Notice:** The production Helm configuration (`values-prod.yaml`), Traefik ingress definitions, local-path volume claims, and deployment manifests have been strictly validated via `helm lint` and dry-run template rendering (`helm template`). However, a live deployment to a remote Linux VPS instance has not yet been executed; all live integration tests in this repository were conducted against the verified local Kind cluster.

To deploy Urumi on a remote Linux VPS running k3s:

### 1. VPS Prerequisites
- Linux VPS with public IP, ports 80 and 443 open.
- k3s installed: `curl -sfL https://get.k3s.io | sh -` (`export KUBECONFIG=/etc/rancher/k3s/k3s.yaml`).
- Helm v3 installed.
- Public DNS A records configured: `shop.yourdomain.com`, `api.yourdomain.com`, `dashboard.yourdomain.com` pointing to the VPS IP.

### 2. Configure `values-prod.yaml`
Edit `infra/helm/urumi/values-prod.yaml`:
```yaml
ingress:
  enabled: true
  className: "traefik" # Default on k3s
  hosts:
    shop: shop.yourdomain.com
    api: api.yourdomain.com
    dashboard: dashboard.yourdomain.com

gatewayDb:
  persistence:
    storageClass: "local-path"

wordpressDb:
  storageClass: "local-path"

wordpress:
  storageClass: "local-path"
  replicas: 1 # Must remain 1 for ReadWriteOnce storage

gateway:
  replicas: 1 # Must remain 1 due to in-memory SSE sessions
  image:
    repository: your-registry/urumi-gateway
    tag: "0.1.0"
    pullPolicy: IfNotPresent
```

### 3. Deploy via Helm
```bash
helm upgrade --install urumi infra/helm/urumi \
  -n urumi --create-namespace \
  -f infra/helm/urumi/values.yaml \
  -f infra/helm/urumi/values-prod.yaml \
  --set secrets.adminPassword="STRONG_ADMIN_PASSWORD" \
  --set secrets.memberPassword="STRONG_MEMBER_PASSWORD" \
  --set secrets.jwtSecret="STRONG_32_CHAR_JWT_SECRET" \
  --set secrets.llmApiKey="YOUR_LLM_PROVIDER_KEY" \
  --set secrets.githubToken="YOUR_GITHUB_PAT"
```

---

## 8. Documentation Index

- [System Design & Tradeoffs](docs/ARCHITECTURE.md): Full component breakdown, tool routing algorithms, failure isolation, and architectural tradeoffs.
- [Threat Model & Security Validations](docs/SECURITY.md): Threat vectors, SSRF protections, RBAC matrices, and verified vs unresolved security risks.
- [End-to-End Demo Script](docs/DEMO.md): Step-by-step reproducible evaluation walkthrough matching assignment requirements.
- [Setup & Deployment Guide](docs/SETUP.md): Detailed deployment instructions for Kind and production k3s VPS.
