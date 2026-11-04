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

The evaluation sequence is organized into two distinct acceptance flows:
- **Part 1: User A — Admin and WooCommerce Demonstration**
- **Part 2: User B — External MCP Client Demonstration**
- **Part 3: Architecture & Security Verification Walkthrough**

---

## Part 1: User A — Admin and WooCommerce Demonstration

### Step 1: Admin Creates a New Product via Chat Agent
1. Open the Urumi Dashboard in your browser:
   - **Live GCP:** [https://dashboard.34.14.187.15.nip.io](https://dashboard.34.14.187.15.nip.io)
   - **Local Kind:** [http://dashboard.urumi.local](http://dashboard.urumi.local)
2. Log in as **User A (Dashboard Admin)**:
   - Email: `admin@urumi.local`
   - Password: `admin123`
3. Click on the **Chat** tab in the sidebar.
4. **Create a Product via Natural Language:**
   - Prompt:
     ```text
     Create a new WooCommerce product named "Urumi Tactical Hoodie" priced at 79.99 with description "Heavyweight fleece hoodie."
     ```
   - **Expected Result:** The Chat Agent invokes the administrative tool `woocommerce__create_product`. The agent confirms product creation and displays the newly assigned product ID (e.g., `#25`) and price.
5. **Verify in Storefront Catalog:**
   - Open the WooCommerce storefront:
     - **Live GCP:** [https://shop.34.14.187.15.nip.io/shop/](https://shop.34.14.187.15.nip.io/shop/)
     - **Local Kind:** [http://shop.urumi.local/shop/](http://shop.urumi.local/shop/)
   - Confirm that the newly created product **"Urumi Tactical Hoodie"** ($79.99) is immediately published and visible in the store catalog.

---

### Step 2: Customer Places an Order for the Newly Created Product
1. In the storefront (`/shop/`), click on the newly created product: **Urumi Tactical Hoodie** ($79.99).
2. Click **Add to cart**.
3. Click **View cart** and proceed to checkout:
   - Live GCP: `https://shop.34.14.187.15.nip.io/checkout/`
   - Local Kind: `http://shop.urumi.local/checkout/`
4. Fill in customer checkout details:
   - First Name: `John`, Last Name: `Doe`
   - Street Address: `123 Test Street`, City: `Testville`, Postcode: `12345`
   - Phone: `555-555-5555`, Email: `john@example.com`
5. Select payment option **Cash on delivery** and click **Place order**.
6. **Expected Observation:** The order confirmation receipt page appears (`/checkout/order-received/<id>/...`). **Record the actual Order ID** generated on this receipt (e.g. if the confirmation heading says "Order #28", record `28`). Do not rely on a hardcoded number, as the sequential counter reflects all prior storefront activity.
7. *(Optional Store Admin Verification):*
   - Log in to WordPress Admin (`/wp-login.php`, credentials `admin` / `password`).
   - Navigate to **WooCommerce > Orders** to observe that the order for **John Doe** with the recorded Order ID is recorded with status **Processing**.

---

### Step 3: Admin Retrieves Today's Orders via Chat Agent
1. Return to the Urumi Dashboard Chat tab (logged in as `admin@urumi.local`).
2. Ask the Chat Agent to retrieve today's orders:
   - Prompt:
     ```text
     Retrieve today's orders from WooCommerce.
     ```
3. **Expected Observation:** The Chat Agent calls `woocommerce__list_orders` and renders the structured orders table directly in the conversation panel.

---

### Step 4: Verification of Order Attribution to the Newly Created Product
1. **Instructions:** Inspect the retrieved order in the Chat UI.
2. **Expected Observation:**
   - **Order ID:** Matches the actual Order ID recorded from the checkout receipt in Step 2.
   - **Customer:** Displays `John Doe`.
   - **Line Items:** Contains the exact product created in Step 1: **"Urumi Tactical Hoodie"** (Quantity: 1, Price: $79.99).
   - **Order Status:** `Processing`.
3. Click **View raw response** on the tool execution panel to observe the structured JSON payload containing the exact product ID, line item details, and total.

---

## Part 2: User B — External MCP Client Demonstration

### Step 5: Connect External MCP Client with Member API Key
This section demonstrates connecting external MCP clients (such as an external AI MCP client, the official **MCP Inspector**, or cURL) to the Gateway's `/mcp` endpoint using a scoped member API key.

#### 1. Generate a Member API Key
1. In an incognito or separate browser window, open the Urumi Dashboard:
   - **Live GCP:** [https://dashboard.34.14.187.15.nip.io](https://dashboard.34.14.187.15.nip.io)
   - **Local Kind:** [http://dashboard.urumi.local](http://dashboard.urumi.local)
2. Log in as **User B (Member)**:
   - Email: `member@urumi.local`
   - Password: `member123`
3. Navigate to the **API Keys** tab and click **Create Key**.
4. Label it `Member Client Key` and copy the generated key (`urumi_<64-hex-chars>`). This key will be used throughout the external-client demonstration until revoked in Step 12.

#### 2. Connection Options
Set your environment variables in your terminal:
```bash
# Target Live GCP Deployment:
GATEWAY_URL="https://api.34.14.187.15.nip.io/mcp"

# OR Target Local Kind Cluster:
# GATEWAY_URL="http://api.urumi.local/mcp"

MEMBER_KEY="urumi_YOUR_COPIED_KEY_HERE"
```

- **Option A — Capable AI MCP Client (e.g. Claude Desktop, Cursor, or MCP Agent):**
  Configure the external AI client to connect to Urumi's Gateway endpoint using `mcp-remote` with your `MEMBER_KEY` header (see Step 8 for detailed configuration).
- **Option B — Interactive MCP Inspector (Web UI):**
  ```bash
  npx @modelcontextprotocol/inspector
  ```
  Open `http://localhost:5173`, choose transport `Streamable HTTP` (or `SSE`), set URL to `$GATEWAY_URL`, add header `Authorization: Bearer $MEMBER_KEY`, and click **Connect**.
- **Option C — Direct Terminal JSON-RPC via cURL:**
  All subsequent steps provide verified commands interacting directly with the `/mcp` gateway endpoint.

---

### Step 6: Discover Authorized Member Tools via External Client
1. **Instructions:** From your terminal, query the available tools using the member API key:
   ```bash
   curl -s -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/list"
     }' | jq .
   ```
2. **Expected Observation:**
   - The Gateway evaluates RBAC permissions for the `member` role and returns only authorized tools:
     - `woocommerce__list_products`
     - `woocommerce__list_orders`
     - `woocommerce__get_order`
     - `weather__get_weather`
     - `github__list_issues`
   - Administrative-only tools (such as `woocommerce__create_product`, `woocommerce__update_order_status`, or server management endpoints) are **excluded** from discovery.

---

### Step 7: Query WooCommerce Orders via External MCP Client
1. **Instructions:** Invoke the authorized `woocommerce__list_orders` tool through the external MCP protocol:
   ```bash
   curl -s -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 2,
       "method": "tools/call",
       "params": {
         "name": "woocommerce__list_orders",
         "arguments": {
           "per_page": 5
         }
       }
     }' | jq .
   ```
2. **Expected Observation:**
   - Returns a successful JSON-RPC 2.0 response (`"result": { "content": [...] }`).
   - The order list contains the order matching the actual Order ID recorded from Step 2, confirming that the external client retrieves the order placed for the newly created product.

---

### Step 8: Multi-Upstream Task Execution via External AI MCP Client
This step demonstrates an external AI MCP client coordinating a task that requires tools from two separate upstream servers (`weather-mcp` and `woo-mcp`) through the single Gateway connection.

1. **Configure an External AI MCP Client:**
   Connect a capable AI MCP client (e.g., Claude Desktop, Cursor, or an MCP-enabled agent) to Urumi's Gateway. For example, in Claude Desktop configuration (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "urumi": {
         "command": "npx",
         "args": [
           "-y",
           "mcp-remote",
           "https://api.34.14.187.15.nip.io/mcp",
           "--header",
           "Authorization: Bearer urumi_YOUR_MEMBER_KEY"
         ]
       }
     }
   }
   ```
   *(Replace with `http://api.urumi.local/mcp` if targeting the local Kind cluster).*

2. **Submit a Coordinated Natural-Language Request:**
   Prompt the external AI client with a single request requiring both weather and store data:
   ```text
   What is the current weather in Tokyo, and what products are available in our store?
   ```

3. **Expected Observation:**
   - The external AI client inspects the Gateway's advertised tools and determines that two separate tools are required to fulfill the request.
   - It issues two automated tool calls via the Gateway:
     1. `weather__get_weather` with arguments `{"latitude": 35.6762, "longitude": 139.6503}` (routed to `weather-mcp`).
     2. `woocommerce__list_products` (routed to `woo-mcp`).
   - The AI client synthesizes the combined data from both upstreams into a single unified response.

4. **Low-Level Protocol Verification (Alternative / Protocol Audit):**
   If an external AI desktop client is not configured, the evaluator can verify that the Gateway successfully routes tools to both distinct upstreams over the same external client connection using direct JSON-RPC calls:
   ```bash
   # Call 1: Routed to weather-mcp
   curl -s -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 3,
       "method": "tools/call",
       "params": {
         "name": "weather__get_weather",
         "arguments": { "latitude": 35.6762, "longitude": 139.6503 }
       }
     }' | jq .

   # Call 2: Routed to woo-mcp
   curl -s -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 4,
       "method": "tools/call",
       "params": {
         "name": "woocommerce__list_products",
         "arguments": { "per_page": 2 }
       }
     }' | jq .
   ```
   *Note:* Executing these two sequential JSON-RPC requests via cURL confirms that the Gateway routes calls to both backends over the member session; automated multi-tool reasoning and coordination is performed by an AI client connected to the endpoint.

---

### Step 9: Upstream Disablement & Tool Discovery Removal Verification
1. **Instructions:**
   - Log in to the Dashboard as **Admin (`admin@urumi.local`)** and navigate to the **Servers** tab.
   - Locate the **Weather** upstream server and click the **Disable** toggle.
   - Observe that the server badge transitions to **Disconnected**.
2. **Query Tool Discovery via External Client:**
   Using the existing member API key (`$MEMBER_KEY`), query `tools/list`:
   ```bash
   curl -s -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 5,
       "method": "tools/list"
     }' | jq '.result.tools[].name'
   ```
3. **Expected Observation:**
   - `weather__get_weather` is **absent** from the returned tool discovery list.
   - Only tools for enabled upstreams (`woocommerce` and `github`) are discoverable.
4. Attempting to call `weather__get_weather` directly returns a tool execution error (`Upstream server weather is not available`).
5. Re-enable the Weather server on the **Servers** tab. Run the `tools/list` query again; observe that `weather__get_weather` reappears in tool discovery.

---

### Step 10: Upstream Pod Failure Isolation & Recovery (Local Kind Cluster)
1. **Instructions:** In your terminal, explicitly target the local Kind development cluster context (`kind-urumi-local`) and namespace `urumi` to simulate an upstream service crash:
   ```bash
   kubectl --context kind-urumi-local scale deployment weather-mcp -n urumi --replicas=0
   ```
   > **Safety Note:** This command explicitly targets `--context kind-urumi-local` so that remote GCP or production environments are never affected.

2. **Verify Upstream Isolation via External Client:**
   Test the remaining healthy upstreams using the member API key:
   ```bash
   curl -s -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 6,
       "method": "tools/call",
       "params": {
         "name": "woocommerce__list_orders",
         "arguments": { "per_page": 2 }
       }
     }' | jq .
   ```
3. **Expected Observation:**
   - `woocommerce__list_orders` executes successfully. The crash of `weather-mcp` does not affect or destabilize the WooCommerce MCP service or Gateway.
   - On the Dashboard **Servers** tab, the background health poll marks Weather as **Unreachable / Error**.

4. **Restore the Upstream Deployment:**
   Restore the replica count in the local Kind cluster:
   ```bash
   kubectl --context kind-urumi-local scale deployment weather-mcp -n urumi --replicas=1
   kubectl --context kind-urumi-local wait --for=condition=ready pod -l app=weather-mcp -n urumi --timeout=60s
   ```
5. **Expected Observation:** Within the 30-second health poll loop, the Gateway re-establishes connection, marks the server **Connected**, and restores weather tools automatically.

---

### Step 11: Persistent Audit Ledger & Identity Attribution Inspection
1. **Instructions:** Log in as **Admin (`admin@urumi.local`)** and open the **Audit Logs** tab in the Dashboard.
2. **Expected Observation:**
   - **Identity Attribution:**
     - Operations executed by User A (Chat Agent) display `admin@urumi.local` (User ID 1).
     - Operations executed by User B (External MCP Client) display `member@urumi.local` (User ID 2).
   - **Execution Metadata:** Verify that every entry records `Timestamp`, `User`, `Server`, `Tool`, `Arguments`, `Duration (ms)`, and `Outcome` (`success`, `denied`, or `error`).
   - Click on an audit entry to inspect the full JSON argument payload.

---

### Step 12: Immediate API Key Revocation Verification
1. **Instructions:**
   - In the Dashboard as **User B (`member@urumi.local`)**, navigate to the **API Keys** tab.
   - Click **Revoke** on `Member Client Key`.
2. **Test Revoked Key from Terminal:**
   Immediately attempt to use the revoked key (`$MEMBER_KEY`):
   ```bash
   curl -s -i -X POST "$GATEWAY_URL" \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 7,
       "method": "tools/list"
     }'
   ```
3. **Expected Observation:**
   - Returns **`HTTP/1.1 401 Unauthorized`**.
   - Body: `{"error":"Invalid or revoked API key"}`.
   - Revocation takes effect immediately: no further `tools/list` or `tools/call` operations can be performed with this key.

---

## Part 3: Architecture & Security Verification Walkthrough

1. **Kubernetes Resources & Health Status:**
   ```bash
   # Pods, Services, and Deployments in the urumi namespace (explicitly targeting local Kind cluster)
   kubectl --context kind-urumi-local get pods,svc,deploy -n urumi

   # Secrets and Persistent Volume Claims (local-path provisioned)
   kubectl --context kind-urumi-local get secret,pvc -n urumi

   # Traefik / Nginx Ingress Rules
   kubectl --context kind-urumi-local get ingress -n urumi

   # Helm Release History
   helm history urumi -n urumi
   ```

2. **Key Security Mechanisms to Highlight:**
   - **Layer-7 Ingress Boundary:** External traffic enters solely through Traefik / Nginx Ingress to Dashboard, Gateway, and WordPress. Upstream MCP servers and databases run as internal ClusterIP services without public ingress exposure.
   - **Non-root execution:** Containers for Gateway and MCP upstreams enforce `runAsNonRoot: true` (`UID 1000`), Dashboard enforces `UID 101`.
   - **Token auto-mount disabled:** `automountServiceAccountToken: false` on `urumi-sa`.
   - **Unified Helm Chart:** Both local development and GCP k3s production deployments use the exact same chart (`infra/helm/urumi`), configuring environments cleanly through layered values files (`values-local.yaml` vs. `values-prod.yaml` + `values-gcp.yaml`).
   - **Secret Protection:** Auto-generated database passwords and master encryption keys are preserved across upgrades via Helm `lookup`, preventing credential rotation accidents.
