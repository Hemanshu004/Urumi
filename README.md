# Urumi MCP Gateway

Urumi is an enterprise-grade AI Model Context Protocol (MCP) Gateway built with TypeScript, Node.js/Express, React, Kubernetes, and Helm. It acts as a secure, centralized reverse proxy that aggregates, namespaces, authorizes, and audits multiple upstream MCP microservices (including WooCommerce, GitHub, and Weather) for consumption by Large Language Models (LLMs) and external MCP clients (such as Claude Desktop and MCP Inspector).

---

## Deliverables & Quick Navigation Index

- **[Local Setup & Deployment Instructions](docs/SETUP.md#1-local-development-deployment-kind):** Reproducible automated Kind cluster deployment.
- **[Production GCP k3s Deployment Instructions](docs/SETUP.md#2-production-deployment-gcp-k3s-vm-linux-vps):** Helm-managed live deployment on GCP VM with Traefik Ingress.
- **[WooCommerce Order Placement & Verification](#4-woocommerce-workflow):** Catalog browsing, checkout, order receipt, and wp-admin verification ([walkthrough in docs/DEMO.md](docs/DEMO.md#step-1-storefront-navigation-test-order-completion)).
- **[Chat Agent Tool Invocation](#4-chat-agent-integration):** Multi-turn natural language LLM interaction with automated MCP tool dispatch ([walkthrough in docs/DEMO.md](docs/DEMO.md#step-2-user-a-admin-product-creation-order-querying-via-chat)).
- **[External MCP Client & MCP Inspector Connection](#5-external-mcp-client-integration):** Connecting via MCP Inspector Web UI, CLI proxy, and Claude Desktop ([walkthrough in docs/DEMO.md](docs/DEMO.md#step-3-user-b-member-external-mcp-client-connection-discovery)).
- **[System Design & Tradeoffs](docs/ARCHITECTURE.md):** Architecture, routing, failover, replica constraints, and design tradeoffs.
- **[Threat Model & Security Limitations](docs/SECURITY.md):** Attack vectors, SSRF validation, RBAC boundaries, and verified vs residual risks.
- **[Implemented Standout Features Matrix](#standout-features-matrix):** Feature implementation status with source code references.

---

## Verified Deployment Environments

The Urumi platform is deployed and verified across two active environments:

| Service / Interface | Local Development (Kind Cluster) | Live Deployed Environment (GCP k3s VM) |
| :--- | :--- | :--- |
| **Administrative Dashboard** | [http://dashboard.urumi.local](http://dashboard.urumi.local) | [https://dashboard.34.14.187.15.nip.io](https://dashboard.34.14.187.15.nip.io) |
| **API Gateway Backend** | [http://api.urumi.local](http://api.urumi.local) | [https://api.34.14.187.15.nip.io](https://api.34.14.187.15.nip.io) |
| **WooCommerce Storefront** | [http://shop.urumi.local](http://shop.urumi.local) | [https://shop.34.14.187.15.nip.io](https://shop.34.14.187.15.nip.io) |
| **External MCP Endpoint** | `http://api.urumi.local/mcp` | `https://api.34.14.187.15.nip.io/mcp` |
| **Ingress Controller** | `ingress-nginx` (nodePort 80/443) | `traefik` (k3s built-in) |
| **Storage Class** | Standard Kind HostPath | `local-path` (k3s default RWO storage) |
| **Helm Values Configuration** | `values.yaml` + `values-local.yaml` | `values.yaml` + `values-prod.yaml` + `values-gcp.yaml` |

---

## Standout Features Matrix

| Feature | Status | Primary Code Location | Implementation Summary |
| :--- | :---: | :--- | :--- |
| **Multi-Upstream MCP Aggregation** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts`<br/>`apps/gateway/src/mcp/server.ts` | Dynamically connects to independent MCP upstreams over Streamable HTTP and SSE; aggregates tools into unified registry. |
| **Collision-Safe Namespacing** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts`<br/>`apps/gateway/src/mcp/registry.ts` | Deterministically prefixes tool names (`${serverName}__${toolName}`) to prevent namespace collisions across services. |
| **Role-Based Tool Permissions (RBAC)** | **Implemented** | `apps/gateway/src/utils/rbac.ts`<br/>`apps/gateway/src/routes/chat.ts`<br/>`apps/gateway/src/mcp/server.ts` | 3-tier gating: filters chat LLM context, filters external `/mcp` discovery, intercepts execution dispatch with HTTP/JSON-RPC 403. |
| **Hashed API Keys & Instant Revocation** | **Implemented** | `apps/gateway/src/routes/apiKeys.ts`<br/>`apps/gateway/src/mcp/server.ts` | Keys formatted as `urumi_<hex>`, indexed by prefix, stored as salted bcrypt hashes. Immediate 401 rejection upon revocation. |
| **Persistent Audit Logging** | **Implemented** | `apps/gateway/src/services/audit.ts`<br/>`apps/gateway/src/routes/audit.ts` | PostgreSQL ledger recording `userId`, `serverId`, `toolName`, `requestParams`, `outcome`, `durationMs`, and precise timestamps. |
| **Failure Isolation & Auto-Recovery** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts` | Crashing or dead upstreams are isolated immediately; exponential backoff loop with jitter automatically restores tools upon recovery. |
| **Context Budgeting & Pruning** | **Implemented** | `apps/gateway/src/utils/contextBudget.ts`<br/>`apps/gateway/src/routes/chat.ts` | Bounds tool results, prunes GitHub repository searches to essential fields, groups dialogue blocks, prevents provider 413/400 errors. |
| **SSRF Prevention Engine** | **Implemented** | `apps/gateway/src/utils/ssrf.ts` | DNS resolution, IP range validation (loopback, metadata, link-local), private RFC1918 deny-by-default with service allowlist. |
| **Encrypted Upstream Credentials** | **Implemented** | `apps/gateway/src/utils/crypto.ts`<br/>`apps/gateway/src/routes/servers.ts` | AES-256-GCM encryption at rest in PostgreSQL; decrypted in memory only at connection time; sanitized from member APIs. |
| **Kubernetes Hardening & Least-Privilege** | **Implemented** | `infra/helm/urumi/templates/network-policies.yaml`<br/>`infra/helm/urumi/templates/rbac.yaml` | `default-deny-all` firewall; upstreams have no external ingress; `automountServiceAccountToken: false`; non-root containers (UID 1000/101). |
| **Context-Aware Chat Agent** | **Implemented** | `apps/gateway/src/routes/chat.ts`<br/>`apps/dashboard/src/pages/Chat.tsx` | Multi-turn reasoning with automated MCP tool dispatch, parameter sanitization, and native frontend data table rendering. |

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
        ExtClient[External MCP Client<br/>e.g., Claude Desktop, MCP Inspector]
    end

    subgraph Ingress Layer
        Ingress[Kubernetes Ingress Controller<br/>Nginx local / Traefik GCP]
    end

    subgraph Urumi Core Platform [Namespace: urumi]
        Dashboard[urumi-dashboard<br/>React SPA / Nginx<br/>Port 8080]
        Gateway[urumi-gateway<br/>Node.js Express MCP Gateway<br/>Port 3000]
        GatewayDB[(gateway-db<br/>PostgreSQL 15<br/>Port 5432)]
    end

    subgraph Internal MCP Upstream Services [Namespace: urumi - ClusterIP Only]
        WooMCP[woo-mcp<br/>WooCommerce MCP Service<br/>Port 3001]
        GithubMCP[github-mcp<br/>GitHub MCP Service<br/>Port 3002]
        WeatherMCP[weather-mcp<br/>Weather MCP Service<br/>Port 3003]
    end

    subgraph Backend Systems & External Services
        WooCommerce[WordPress / WooCommerce Store<br/>Port 80]
        WooDB[(wordpress-db<br/>MariaDB 11<br/>Port 3306)]
        GithubAPI[GitHub REST API]
        WeatherAPI[Open-Meteo Weather API]
        LLMProvider[LLM Provider<br/>Groq / Gemini / OpenAI]
    end

    Browser -->|shop.urumi.local / shop.34.14.187.15.nip.io| Ingress
    Browser -->|dashboard.urumi.local / dashboard.34.14.187.15.nip.io| Ingress
    Browser -->|api.urumi.local / api.34.14.187.15.nip.io| Ingress
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
- **Local Kind URL:** `http://api.urumi.local/mcp`
- **Live Deployed GCP URL:** `https://api.34.14.187.15.nip.io/mcp`
- **Supported Transports:**
  - **Server-Sent Events (SSE):** Accessible via `GET /mcp` (or `/mcp/sse`). Establishes a persistent SSE stream and assigns a `sessionId`. Client sends subsequent JSON-RPC messages via `POST /mcp/message?sessionId=<sessionId>`.
  - **Streamable HTTP:** Accessible via `POST /mcp`. Directly accepts JSON-RPC 2.0 payloads and returns chunked or standard HTTP responses via `@modelcontextprotocol/server`.
- **Authentication:** Mandatory HTTP Header:
  ```text
  Authorization: Bearer <USER_API_KEY>
  ```

### API Key Generation
1. In the Dashboard ([local](http://dashboard.urumi.local) or [live GCP](https://dashboard.34.14.187.15.nip.io)), log in as `member@urumi.local` (or admin).
2. Navigate to the **API Keys** tab and click **Create Key**.
3. Label it `My External Client`.
4. Copy the raw key (`urumi_<64-hex-chars>`). Plaintext is displayed only once.

### Connecting External MCP Clients with MCP Inspector

The official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (`@modelcontextprotocol/inspector`) allows interactive discovery, schema inspection, and tool execution against the Gateway.

#### Option A: Interactive Web UI (Recommended)
1. Start the MCP Inspector UI locally:
   ```bash
   npx @modelcontextprotocol/inspector
   ```
2. Open the URL provided in the console (typically `http://localhost:5173` or `http://localhost:6274`).
3. In the Inspector connection configuration:
   - **Transport Type:** Select `Streamable HTTP` (or `SSE`).
   - **URL:** Enter `https://api.34.14.187.15.nip.io/mcp` (or `http://api.urumi.local/mcp` for local Kind).
   - **Custom Headers:** Add:
     - Name: `Authorization`
     - Value: `Bearer urumi_YOUR_COPIED_KEY_HERE`
4. Click **Connect**.
5. **Inspect & Execute:**
   - Under **Tools**, click **List Tools** to see all tools permitted for your role (e.g. `woocommerce__list_products`, `weather__get_weather`).
   - Select a tool, fill in parameters in the auto-generated form, and click **Run Tool**.
   - Review JSON-RPC request/response payloads and latency metrics.

#### Option B: MCP Inspector via CLI Proxy
You can also launch MCP Inspector pre-connected via `mcp-remote`:
```bash
npx -y @modelcontextprotocol/inspector npx -y mcp-remote https://api.34.14.187.15.nip.io/mcp --header "Authorization: Bearer urumi_YOUR_COPIED_KEY_HERE"
```

### Direct Terminal Interaction via cURL
Execute requests directly from your terminal using curl against either the live GCP endpoint or local Kind:

```bash
# Set your API key and target Gateway endpoint
API_KEY="urumi_YOUR_COPIED_KEY_HERE"
GATEWAY_URL="https://api.34.14.187.15.nip.io/mcp" # or "http://api.urumi.local/mcp"

# 1. Discover permitted tools (tools/list)
curl -s -X POST "$GATEWAY_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }' | jq .

# 2. Execute an authorized tool call (tools/call)
curl -s -X POST "$GATEWAY_URL" \
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
    "urumi-gcp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://api.34.14.187.15.nip.io/mcp",
        "--header",
        "Authorization: Bearer urumi_YOUR_COPIED_KEY_HERE"
      ]
    },
    "urumi-local": {
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
   curl -s -i -X POST "$GATEWAY_URL" \
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

## 7. Production Deployment (GCP k3s VM)

The Urumi platform is deployed and running live on a Google Cloud Platform (GCP) Compute Engine virtual machine running **k3s** (lightweight Kubernetes) with the **Traefik Ingress controller**. Workloads are managed as a unified Helm release named `urumi` inside the dedicated `urumi` Kubernetes namespace.

### Live Production Endpoints

| Component | Live GCP URL / Endpoint | Protocol / Transport | Ingress Routing Target |
| :--- | :--- | :--- | :--- |
| **Administrative Dashboard** | [https://dashboard.34.14.187.15.nip.io](https://dashboard.34.14.187.15.nip.io) | HTTPS / Web Browser | Service `urumi-dashboard` (port 80 $\rightarrow$ 8080) |
| **API Gateway Backend** | [https://api.34.14.187.15.nip.io](https://api.34.14.187.15.nip.io) | HTTPS / JSON REST | Service `gateway` (port 3000) |
| **WooCommerce Storefront** | [https://shop.34.14.187.15.nip.io](https://shop.34.14.187.15.nip.io) | HTTPS / Web Browser | Service `urumi-wordpress` (port 80) |
| **External MCP Endpoint** | `https://api.34.14.187.15.nip.io/mcp` | HTTPS / SSE & Streamable HTTP | Service `gateway` (`/mcp` route) |

### Cluster Architecture & Resource Configuration

1. **Ingress & Host Routing:**
   - Managed by Traefik (`ingressClassName: traefik`), the default Ingress controller in k3s.
   - Host rules dispatch incoming HTTPS traffic for `dashboard.34.14.187.15.nip.io`, `api.34.14.187.15.nip.io`, and `shop.34.14.187.15.nip.io`.
2. **Internal-Only Microservices & Services:**
   - Upstream MCP microservices (`woo-mcp` port 3001, `github-mcp` port 3002, `weather-mcp` port 3003) and databases (`gateway-db` port 5432, `urumi-wordpress-db` port 3306) are deployed strictly as **ClusterIP** services.
   - None of these internal services expose Ingress routes; they are reachable only internally by authorized cluster workloads within the `urumi` namespace.
3. **Persistent Volume Claims (PVCs):**
   - Provisioned via k3s default `local-path` storage provisioner with `ReadWriteOnce` (RWO) access mode:
     - `gateway-db`: StatefulSet volume claim template allocating 5 GiB for PostgreSQL data (`/var/lib/postgresql/data`).
     - `urumi-wordpress-db`: StatefulSet volume claim template allocating 5 GiB for MariaDB data (`/var/lib/mysql`).
     - `urumi-wordpress`: Dedicated PVC (`urumi-wordpress-data`) allocating 5 GiB for WordPress plugins, themes, and uploads (`/var/www/html/wp-content`).
4. **Container Image Distribution:**
   - Production images are pulled from GitHub Container Registry:
     - `ghcr.io/hemanshu004/urumi-gateway:latest`
     - `ghcr.io/hemanshu004/urumi-dashboard:latest`
     - `ghcr.io/hemanshu004/urumi-woo-mcp:latest`
     - `ghcr.io/hemanshu004/urumi-github-mcp:latest`
     - `ghcr.io/hemanshu004/urumi-weather-mcp:latest`
   - Image pull secrets (`ghcr-creds`) are configured in the `urumi` namespace and linked to pod deployment manifests.

### Helm Values Hierarchy: Local vs. Production vs. GCP

The deployment relies on layered Helm value files to maintain environment parity:

```text
values.yaml (Base defaults & resource schemas)
   ├── values-local.yaml (Local Kind overrides: nginx ingress, *.urumi.local, dev credentials)
   └── values-prod.yaml  (Production baseline: traefik ingress, local-path storageClass, 5Gi PVCs)
         └── values-gcp.yaml (GCP live overrides: *.34.14.187.15.nip.io domains, ghcr.io images, 1 replica)
```

- **`values.yaml`:** Declares baseline container configurations, default probe parameters, non-sensitive database names, and template schemas.
- **`values-prod.yaml`:** Configures production-grade settings (Traefik Ingress class, `local-path` storage classes, expanded 5 GiB storage capacities, and stateless horizontal scaling guidelines).
- **`values-gcp.yaml`:** Applies environment-specific overrides for the live GCP VM:
  - Overrides public ingress domains with the assigned VM IP nip.io hostnames (`*.34.14.187.15.nip.io`).
  - Sets image repositories to `ghcr.io/hemanshu004/urumi-*` with `pullPolicy: Always`.
  - Sets workload replica counts to 1 to match the single-VM footprint and comply with stateful SSE transport (`gateway: 1`) and RWO volume (`wordpress: 1`) constraints.

### Secret Management Process

- **Auto-Generated Secrets & Upgrade Preservation:**
  - On initial deployment, Helm auto-generates cryptographically secure passwords for MariaDB root, MariaDB application user, PostgreSQL, JWT signing, and AES-256 master encryption keys via `randAlphaNum`.
  - On subsequent `helm upgrade` operations, the chart template uses Helm's `lookup` function to inspect the existing `urumi-secrets` Secret in the cluster, preserving existing passwords and master keys across upgrades without data corruption.
- **External Secret Provisioning:**
  - Sensitive administrative passwords (`adminPassword`, `memberPassword`) and external API keys (`llmApiKey`, `githubToken`) are never committed to Git repository values files.
  - They are supplied at deployment time via `--set` arguments or passed via an untracked local values file (e.g. `-f secrets-prod.yaml`).
- **Registry Credentials:**
  - Docker registry credentials for GHCR are stored in Kubernetes secret `ghcr-creds` in the `urumi` namespace, referenced by deployment `imagePullSecrets`.

### Helm Lifecycle Procedures

#### 1. Deploy or Upgrade Release
```bash
helm upgrade --install urumi infra/helm/urumi \
  --namespace urumi --create-namespace \
  -f infra/helm/urumi/values.yaml \
  -f infra/helm/urumi/values-prod.yaml \
  -f infra/helm/urumi/values-gcp.yaml \
  --set secrets.adminPassword="<SECURE_ADMIN_PASSWORD>" \
  --set secrets.memberPassword="<SECURE_MEMBER_PASSWORD>" \
  --set secrets.jwtSecret="<MIN_32_CHAR_JWT_SECRET>" \
  --set secrets.llmApiKey="<YOUR_LLM_API_KEY>" \
  --set secrets.githubToken="<YOUR_GITHUB_PAT>"
```

#### 2. Inspect Release History
```bash
helm history urumi -n urumi
```
Output displays revision numbers, deployment timestamps, chart version, release status, and descriptive messages.

#### 3. Safe Rollback
To rollback to a previous working release revision (e.g. revision 1):
```bash
helm rollback urumi 1 -n urumi
```
*Note on Rollbacks: Persistent Volume Claims (`local-path` PVCs) and auto-generated database secrets are preserved during rollbacks. Verify database schema compatibility before rolling back releases across schema migration boundaries.*

### Network Policy Notice
The Helm chart provides declarative Kubernetes `NetworkPolicy` manifests (`infra/helm/urumi/templates/network-policies.yaml`) configuring `default-deny-all` and explicit pod-to-pod ingress permissions. Active kernel-level enforcement of these policies requires a network policy controller / CNI plugin (such as Calico or kube-router). Perimeter security on the live cluster is actively enforced at Layer 7 by Traefik Ingress: only the Dashboard, API Gateway, and WordPress storefront expose ingress routes; internal MCP microservices and database ports are strictly ClusterIP services with no public perimeter exposure.

---

## 8. Documentation Index

- **Local Setup Instructions:** [docs/SETUP.md#1-local-development-deployment-kind](docs/SETUP.md#1-local-development-deployment-kind) — Complete Kind cluster automation, image builds, and health verification.
- **Production GCP k3s Deployment:** [docs/SETUP.md#2-production-deployment-gcp-k3s-vm-linux-vps](docs/SETUP.md#2-production-deployment-gcp-k3s-vm-linux-vps) — Step-by-step instructions for GCP VM, k3s, Traefik, Helm values, and secrets.
- **WooCommerce Order Placement & Verification:** [README.md #4. WooCommerce Workflow](#4-woocommerce-workflow) & [docs/DEMO.md #Step 1](docs/DEMO.md#step-1-storefront-navigation-test-order-completion) — Storefront shopping, Cash on Delivery checkout, and wp-admin order fulfillment audit.
- **Chat Agent Interaction Guide:** [README.md #4. Chat Agent Integration](#4-chat-agent-integration) & [docs/DEMO.md #Step 2](docs/DEMO.md#step-2-user-a-admin-product-creation-order-querying-via-chat) — Natural language tool dispatch, catalog updates, and order queries.
- **External MCP Client & MCP Inspector Integration:** [README.md #5. External MCP Client Integration](#5-external-mcp-client-integration) & [docs/DEMO.md #Step 3](docs/DEMO.md#step-3-user-b-member-external-mcp-client-connection-discovery) — Discovery and execution using MCP Inspector Web UI, CLI proxy, Claude Desktop, and cURL.
- **System Design & Architectural Tradeoffs:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Architectural responsibilities, namespacing algorithms, failure isolation, and replica constraints.
- **Threat Model & Security Limitations:** [docs/SECURITY.md](docs/SECURITY.md) — Trust zones, SSRF validation, RBAC boundaries, and verified vs residual risk matrix.
- **Standout Features & Source Code Locations:** [README.md #Standout Features Matrix](#standout-features-matrix) & [docs/DEMO.md #Standout Features Matrix](docs/DEMO.md#standout-features-matrix) — Comprehensive catalog of architectural and security differentiators.
