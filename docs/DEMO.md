# Urumi End-to-End Demonstration Guide

This guide provides a verified, reproducible demonstration sequence for technical evaluation of the Urumi MCP Gateway. It matches the required end-to-end evaluation flow and validates all architecture, security, and integration capabilities across both the **Live GCP k3s Deployment** and the **Local Kind Development Cluster**.

---

## Evaluation Environments & Access URLs

Evaluators can run this entire verification flow against either the live remote GCP cluster or a local Kind instance:

| Component / Interface | Live Deployed Environment (GCP k3s VM) | Local Development Environment (Kind Cluster) |
| :--- | :--- | :--- |
| **Administrative Dashboard** | [https://dashboard.34.14.187.15.nip.io](https://dashboard.34.14.187.15.nip.io) | [http://dashboard.urumi.local](http://dashboard.urumi.local) |
| **API Gateway Backend** | [https://api.34.14.187.15.nip.io](https://api.34.14.187.15.nip.io) | [http://api.urumi.local](http://api.urumi.local) |
| **WooCommerce Storefront** | [https://shop.34.14.187.15.nip.io](https://shop.34.14.187.15.nip.io) | [http://shop.urumi.local](http://shop.urumi.local) |
| **External MCP Endpoint** | `https://api.34.14.187.15.nip.io/mcp` | `http://api.urumi.local/mcp` |

---

## Health Verification

Verify cluster pods and endpoints before starting the evaluation:

```bash
# Option A: Verify Live GCP Deployment
curl -s -k https://api.34.14.187.15.nip.io/health/live
# Expected output: {"status":"healthy"}

curl -s -k https://api.34.14.187.15.nip.io/health/ready
# Expected output: {"status":"ready"}

# Option B: Verify Local Kind Cluster (if evaluating locally)
grep urumi.local /etc/hosts
kubectl --context kind-urumi-local get pods -n urumi
curl -s http://api.urumi.local/health/live
curl -s http://api.urumi.local/health/ready
```

### Verified Development Credentials & Access Separation
> **Important Distinction:** WordPress and Urumi are independent applications with separate authentication databases. WordPress credentials manage the WooCommerce store backend (`/wp-admin`), while Urumi credentials manage the MCP Gateway and Dashboard. Only development credentials configured in the repository are documented here; never expose or reuse production secrets.

| Application | Account / Role | Login URL (Local / GCP) | Identifier | Password | Origin in Repo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Urumi Dashboard** | Administrator (User A) | `dashboard.urumi.local` / `dashboard.34.14.187.15.nip.io` | `admin@urumi.local` | `admin123` | Seeded via `values-local.yaml` |
| **Urumi Dashboard** | Member (User B) | `dashboard.urumi.local` / `dashboard.34.14.187.15.nip.io` | `member@urumi.local` | `member123` | Seeded via `values-local.yaml` |
| **WordPress Storefront** | Store Administrator | `shop.urumi.local/wp-login.php` / `shop.34.14.187.15.nip.io/wp-login.php` | `admin` | `password` | Seeded via `infra/scripts/seed-woo.sh` |

---

## Standout Features Matrix

| Feature | Status | Primary Code Location | Description |
| :--- | :---: | :--- | :--- |
| **Multi-Upstream MCP Aggregation** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts`<br/>`apps/gateway/src/mcp/server.ts` | Dynamically connects to independent MCP upstreams over Streamable HTTP and SSE; aggregates tools into unified registry. |
| **Collision-Safe Namespacing** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts`<br/>`apps/gateway/src/mcp/registry.ts` | Automatically prefixes tool names deterministically (`${serverName}__${toolName}`) to eliminate naming collisions. |
| **Role-Based Tool Permissions (RBAC)** | **Implemented** | `apps/gateway/src/utils/rbac.ts`<br/>`apps/gateway/src/routes/chat.ts`<br/>`apps/gateway/src/mcp/server.ts` | Gating enforced at context assembly, external discovery, and execution. Blocks unauthorized executions with HTTP/JSON-RPC 403. |
| **Hashed API Keys & Instant Revocation** | **Implemented** | `apps/gateway/src/routes/apiKeys.ts`<br/>`apps/gateway/src/mcp/server.ts` | Keys formatted as `urumi_<hex>`, indexed by prefix, stored as salted bcrypt hashes. Immediate 401 on revocation. |
| **Persistent Audit Logging** | **Implemented** | `apps/gateway/src/services/audit.ts`<br/>`apps/gateway/src/routes/audit.ts` | Comprehensive ledger tracking `userId`, `serverId`, `toolName`, `requestParams`, `outcome`, `durationMs`, and timestamps. |
| **Failure Isolation & Auto-Recovery** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts` | Background polling isolates crashing servers; exponential backoff reconnection with jitter restores tools automatically. |
| **Context Budgeting & Token Pruning** | **Implemented** | `apps/gateway/src/utils/contextBudget.ts`<br/>`apps/gateway/src/routes/chat.ts` | Bounds tool results, prunes GitHub search repos to top 5 and essential fields, groups atomic dialogue blocks, handles 413/400 errors. |
| **SSRF Prevention Engine** | **Implemented** | `apps/gateway/src/utils/ssrf.ts` | DNS resolution, IP range blocking (loopback, metadata, link-local), private RFC1918 deny-by-default with service allowlist. |
| **Encrypted Upstream Credentials** | **Implemented** | `apps/gateway/src/utils/crypto.ts`<br/>`apps/gateway/src/routes/servers.ts` | AES-256-GCM encryption at rest in PostgreSQL; decrypted in memory only at connection time; sanitized from member APIs. |
| **K8s Least-Privilege & NetworkPolicies**| **Implemented** | `infra/helm/urumi/templates/network-policies.yaml`<br/>`infra/helm/urumi/templates/rbac.yaml` | `default-deny-all` firewall; upstreams have no external ingress; `automountServiceAccountToken: false`; non-root containers. |
| **Context-Aware Chat Agent** | **Implemented** | `apps/gateway/src/routes/chat.ts`<br/>`apps/dashboard/src/pages/Chat.tsx` | Multi-turn reasoning with automated MCP tool dispatch, parameter sanitization, and native frontend data table rendering. |
| **Multi-Store Provisioning** | *Not Implemented* | N/A (Architecture constraint) | Single WooCommerce store per deployment; multi-tenant store provisioning was an optional non-core feature. |
| **OAuth2 / SSO Integration** | *Not Implemented* | N/A (Architecture constraint) | Employs local JWT authentication with HttpOnly cookies and Bearer API keys. |

---

## End-to-End Evaluation Sequence

### Step 1: Storefront Navigation & Test Order Completion
1. Open the storefront in your browser:
   - **Live GCP:** [https://shop.34.14.187.15.nip.io/shop/](https://shop.34.14.187.15.nip.io/shop/)
   - **Local Kind:** [http://shop.urumi.local/shop/](http://shop.urumi.local/shop/)
2. Locate the seeded product **Urumi T-Shirt** ($19.99) and click **Add to cart**.
3. Click **View cart** and proceed to checkout:
   - Live GCP: `https://shop.34.14.187.15.nip.io/checkout/`
   - Local Kind: `http://shop.urumi.local/checkout/`
4. Fill in test customer billing details:
   - First Name: `John`, Last Name: `Doe`
   - Street Address: `123 Test Street`, City: `Testville`, Postcode: `12345`
   - Phone: `555-555-5555`, Email: `john@example.com`
5. Select payment option **Cash on delivery** and click **Place order**.
6. Verify the order receipt page appears (`/checkout/order-received/...`) and note the generated Order ID (e.g., `#24`).
7. Verify in WooCommerce store administration:
   - Navigate to store admin:
     - Live GCP: `https://shop.34.14.187.15.nip.io/wp-login.php`
     - Local Kind: `http://shop.urumi.local/wp-login.php`
   - Log in with WordPress store administrator credentials: username `admin`, password `password`.
   - In the left sidebar, navigate to **WooCommerce > Orders**.
   - Confirm the order for **John Doe** is visible with status **Processing**.

---

### Step 2: User A (Admin) — Product Creation & Order Querying via Chat
1. Open the Urumi Dashboard:
   - **Live GCP:** [https://dashboard.34.14.187.15.nip.io](https://dashboard.34.14.187.15.nip.io)
   - **Local Kind:** [http://dashboard.urumi.local](http://dashboard.urumi.local)
2. Log in as **User A (Urumi Dashboard Admin)**:
   - Email: `admin@urumi.local`
   - Password: `admin123`
3. Click on the **Chat** tab in the sidebar.
4. **Create a Product via Natural Language:**
   - Prompt:
     ```text
     Create a new WooCommerce product named "Urumi Tactical Hoodie" priced at 79.99 with description "Heavyweight fleece hoodie."
     ```
   - **Verification:** The Chat Agent invokes `woocommerce__create_product`. The response confirms product creation with its new ID and price.
   - **Cross-check in Storefront:** Refresh the storefront (`/shop/`) to confirm the new "Urumi Tactical Hoodie" is immediately live in the catalog.
5. **Query Orders via Natural Language:**
   - Prompt:
     ```text
     What are the recent orders in WooCommerce?
     ```
   - **Verification:** The Chat Agent executes `woocommerce__list_orders` and renders the structured orders table showing the order placed in Step 1.

---

### Step 3: User B (Member) — External MCP Client Connection & Discovery

This step verifies connecting external MCP clients (such as the official **MCP Inspector** or cURL) to the Gateway's `/mcp` endpoint using a scoped member API key.

#### 1. Generate a Member API Key
1. Log in to the Dashboard as **User B (Member)** in an incognito window:
   - Live GCP: `https://dashboard.34.14.187.15.nip.io` (or local `http://dashboard.urumi.local`)
   - Email: `member@urumi.local`
   - Password: `member123`
2. Navigate to the **API Keys** tab and click **Create Key**. Label it `Member Inspector Key`.
3. Copy the raw generated key (`urumi_<64-hex-chars>`).

#### 2. Connect with MCP Inspector (Interactive Web UI)
1. Run the MCP Inspector CLI locally:
   ```bash
   npx @modelcontextprotocol/inspector
   ```
2. Open the URL shown in the console output (typically `http://localhost:5173`).
3. Fill in the connection settings:
   - **Transport Type:** `Streamable HTTP` (or `SSE`)
   - **URL:** `https://api.34.14.187.15.nip.io/mcp` (or `http://api.urumi.local/mcp` if evaluating locally)
   - **Custom Headers:**
     - Key: `Authorization`
     - Value: `Bearer urumi_YOUR_COPIED_KEY_HERE`
4. Click **Connect**.
5. **Verify Permitted Tools Discovery:**
   - Click **List Tools** in the Inspector UI.
   - Observe that only tools permitted for the `member` role are returned (`woocommerce__list_products`, `woocommerce__list_orders`, `weather__get_weather`, `github__list_issues`). Administrative-only tools (like product deletion or server registration) are omitted.
6. **Execute a Tool via Inspector:**
   - Select `weather__get_weather`.
   - Provide arguments in the form: `{"latitude": 48.8566, "longitude": 2.3522}` (Paris).
   - Click **Run Tool**.
   - Observe the returned JSON-RPC 2.0 response containing current weather metrics.

#### 3. Connect with MCP Inspector via CLI Proxy
Alternatively, launch MCP Inspector directly connected via CLI:
```bash
MEMBER_KEY="urumi_YOUR_COPIED_KEY_HERE"
GATEWAY_URL="https://api.34.14.187.15.nip.io/mcp"

npx -y @modelcontextprotocol/inspector npx -y mcp-remote "$GATEWAY_URL" --header "Authorization: Bearer $MEMBER_KEY"
```

#### 4. Direct Terminal Discovery & Invocation via cURL
```bash
# Discover permitted tools (tools/list)
curl -s -X POST "$GATEWAY_URL" \
  -H "Authorization: Bearer $MEMBER_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }' | jq .

# Execute an authorized tool call (tools/call)
curl -s -X POST "$GATEWAY_URL" \
  -H "Authorization: Bearer $MEMBER_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "weather__get_weather",
      "arguments": {
        "latitude": 48.8566,
        "longitude": 2.3522
      }
    }
  }' | jq .
```
**Verification:** Gateway executes the tool on `weather-mcp` and returns structured weather data for Paris with audit log attribution.

---

### Step 4: Multi-Upstream Execution in a Single Prompt
1. In the Dashboard Chat (logged in as Admin or Member with permissions):
2. Submit a prompt requiring two independent upstreams:
   ```text
   What is the current weather in Tokyo, and what are the latest products in our WooCommerce store?
   ```
3. **Verification:**
   - The Gateway coordinates two tool calls:
     1. `weather__get_weather` (routed to `weather-mcp`)
     2. `woocommerce__list_products` (routed to `woo-mcp`)
   - Both executions succeed, and the LLM synthesizes the combined response with structured tables for products and weather data.

---

### Step 5: API Key Immediate Revocation Verification
1. As **User B (`member@urumi.local`)**, go to the **API Keys** page in the dashboard.
2. Click **Revoke** on the `Member Inspector Key` created in Step 3.
3. Immediately test the revoked key from your terminal:
   ```bash
   curl -s -i -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 3,
       "method": "tools/list"
     }'
   ```
4. **Verification:**
   - Returns **`HTTP/1.1 401 Unauthorized`**.
   - Body: `{"error":"Invalid or revoked API key"}`.
   - The revoked key is immediately barred with zero delay.

---

### Step 6: Upstream Disablement Verification
1. Log in as **Admin (`admin@urumi.local`)** and navigate to the **Servers** tab.
2. Locate the **Weather** upstream server and click the **Disable** toggle.
3. Observe the server badge transitions to **Disconnected**.
4. In the **Chat** tab, ask:
   ```text
   What is the weather in London right now?
   ```
5. **Verification:**
   - The LLM does not execute `weather__get_weather`.
   - The agent informs you that weather capabilities are not available or permissions have been revoked.
6. Re-enable the server on the **Servers** tab. The server transitions to **Connected**, and tools are restored immediately.

---

### Step 7: Upstream Pod Failure Isolation & Recovery
1. Verify all upstreams are connected on the **Servers** tab.
2. In your cluster terminal (targeting either local Kind or GCP k3s), scale down the `weather-mcp` deployment:
   ```bash
   kubectl scale deployment weather-mcp -n urumi --replicas=0
   ```
3. In the Dashboard Chat, test the remaining upstreams:
   ```text
   List the products in WooCommerce.
   ```
4. **Verification:**
   - `woocommerce__list_products` executes successfully on `woo-mcp`. The WooCommerce integration is completely unaffected by the failed weather service.
5. On the **Servers** tab, the background health check marks the Weather server as **Unreachable / Error**.
6. Restore the weather pod:
   ```bash
   kubectl scale deployment weather-mcp -n urumi --replicas=1
   kubectl wait --for=condition=ready pod -l app=weather-mcp -n urumi --timeout=60s
   ```
7. **Verification:** Within the 30-second health poll loop, the Gateway re-establishes connection, marks the server **Connected**, and restores tools automatically.

---

### Step 8: Audit Ledger & Identity Attribution Inspection
1. Log in as **Admin (`admin@urumi.local`)** and open the **Audit Logs** tab.
2. Inspect the chronological audit table:
   - Verify every tool call executed across Steps 2, 3, 4, and 7 is recorded.
   - Verify the `User` column displays the correct identity (`admin@urumi.local` for Chat operations, `member@urumi.local` for Member API key calls).
   - Verify execution metadata: `Server`, `Tool`, `Arguments`, `Duration (ms)`, and `Outcome` (`success`, `denied`, `error`).
   - Click on an audit entry to inspect the full JSON argument payload.

---

### Step 9: Architecture & Deployment Strategy Walkthrough
1. **Kubernetes Resources & Health Status:**
   ```bash
   # Pods, Services, and Deployments in the urumi namespace
   kubectl get pods,svc,deploy -n urumi

   # Secrets and Persistent Volume Claims (local-path provisioned)
   kubectl get secret,pvc -n urumi

   # Traefik / Nginx Ingress Rules
   kubectl get ingress -n urumi

   # Helm Release History
   helm history urumi -n urumi
   ```
2. **Key Security Mechanisms to Highlight:**
   - **Layer-7 Ingress Boundary:** External traffic enters solely through Traefik Ingress to Dashboard, Gateway, and WordPress. Upstream MCP servers and databases run as internal ClusterIP services without public ingress exposure.
   - **Non-root execution:** Containers for Gateway and MCP upstreams enforce `runAsNonRoot: true` (`UID 1000`), Dashboard enforces `UID 101`.
   - **Token auto-mount disabled:** `automountServiceAccountToken: false` on `urumi-sa`.
   - **Unified Helm Chart:** Both local development and GCP k3s production deployments use the exact same chart (`infra/helm/urumi`), configuring environments cleanly through layered values files (`values-local.yaml` vs. `values-prod.yaml` + `values-gcp.yaml`).
   - **Secret Protection:** Auto-generated database passwords and master encryption keys are preserved across upgrades via Helm `lookup`, preventing credential rotation accidents.
