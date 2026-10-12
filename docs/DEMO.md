# Urumi End-to-End Demonstration Guide

This guide provides a verified, reproducible demonstration sequence for technical evaluation of the Urumi MCP Gateway. It matches the required end-to-end evaluation flow and validates all architecture, security, and integration capabilities.

---

## Prerequisites & Verification

Ensure the local Kind cluster and ingress are active and hostnames are mapped:

```bash
# 1. Verify /etc/hosts contains the required mappings
grep urumi.local /etc/hosts
# Expected output:
# 127.0.0.1 shop.urumi.local api.urumi.local dashboard.urumi.local

# 2. Verify all cluster pods are running and ready (8 workloads)
kubectl --context kind-urumi-local get pods -n urumi
# Expected workloads:
# - urumi-gateway (1/1 Running)
# - urumi-dashboard (1/1 Running)
# - urumi-woo-mcp (1/1 Running)
# - github-mcp (1/1 Running)
# - weather-mcp (1/1 Running)
# - urumi-gateway-db-0 (1/1 Running)
# - urumi-wordpress (1/1 Running)
# - urumi-wordpress-db-0 (1/1 Running)

# 3. Verify Gateway liveness and readiness
curl -s http://api.urumi.local/health/live
# Expected output: {"status":"healthy"}

curl -s http://api.urumi.local/health/ready
# Expected output: {"status":"ready"}
```

### Verified Development Credentials & Access Separation
> **Important Distinction:** WordPress and Urumi are independent applications with separate authentication databases. WordPress credentials manage the WooCommerce store backend (`/wp-admin`), while Urumi credentials manage the MCP Gateway and Dashboard (`dashboard.urumi.local`). Only development credentials configured in the repository are documented here; never expose or reuse production secrets.

| Application | Account / Role | Login URL | Identifier | Password | Origin in Repo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Urumi Dashboard** | Administrator (User A) | `http://dashboard.urumi.local` | `admin@urumi.local` | `admin123` | Seeded via `values-local.yaml` |
| **Urumi Dashboard** | Member (User B) | `http://dashboard.urumi.local` | `member@urumi.local` | `member123` | Seeded via `values-local.yaml` |
| **WordPress Storefront** | Store Administrator | `http://shop.urumi.local/wp-login.php` | `admin` | `password` | Seeded via `infra/scripts/seed-woo.sh` |

---

## Standout Features Matrix

| Feature | Status | Primary Code Location | Description |
| :--- | :---: | :--- | :--- |
| **Multi-Upstream MCP Aggregation** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts`, `apps/gateway/src/mcp/server.ts` | Dynamically connects to independent MCP upstreams over Streamable HTTP and SSE; aggregates tools into unified registry. |
| **Collision-Safe Namespacing** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts:216`, `apps/gateway/src/mcp/registry.ts` | Automatically prefixes tool names deterministically (`${serverName}__${toolName}`) to eliminate naming collisions. |
| **Role-Based Tool Permissions (RBAC)** | **Implemented** | `apps/gateway/src/utils/rbac.ts`, `apps/gateway/src/routes/chat.ts`, `apps/gateway/src/mcp/server.ts` | Gating enforced at context assembly, external discovery, and execution. Blocks unauthorized executions with HTTP/JSON-RPC 403. |
| **Hashed API Keys & Instant Revocation** | **Implemented** | `apps/gateway/src/routes/apiKeys.ts`, `apps/gateway/src/mcp/server.ts:151` | Keys formatted as `urumi_<hex>`, indexed by prefix, stored as salted bcrypt hashes. Immediate 401 on revocation. |
| **Persistent Audit Logging** | **Implemented** | `apps/gateway/src/services/audit.ts`, `apps/gateway/src/routes/audit.ts` | Comprehensive ledger tracking `userId`, `serverId`, `toolName`, `requestParams`, `outcome`, `durationMs`, and timestamps. |
| **Failure Isolation & Auto-Recovery** | **Implemented** | `apps/gateway/src/mcp/clientManager.ts:77-245` | Background polling isolates crashing servers; exponential backoff reconnection with jitter restores tools automatically. |
| **SSRF Prevention Engine** | **Implemented** | `apps/gateway/src/utils/ssrf.ts` | DNS resolution, IP range blocking (loopback, metadata, link-local), private RFC1918 deny-by-default with service allowlist. |
| **Encrypted Upstream Credentials** | **Implemented** | `apps/gateway/src/utils/crypto.ts`, `apps/gateway/src/routes/servers.ts` | AES-256-GCM encryption at rest in PostgreSQL; decrypted in memory only at connection time; sanitized from member APIs. |
| **K8s Least-Privilege & NetworkPolicies**| **Implemented** | `infra/helm/urumi/templates/network-policies.yaml`, `templates/rbac.yaml` | `default-deny-all` firewall; upstreams have no external ingress; `automountServiceAccountToken: false`; non-root containers. |
| **Context-Aware Chat Agent** | **Implemented** | `apps/gateway/src/routes/chat.ts`, `apps/dashboard/src/pages/Chat.tsx` | Multi-turn reasoning with automated MCP tool dispatch, parameter sanitization, and native frontend data table rendering. |
| **Multi-Store Provisioning** | *Not Implemented* | N/A (Architecture constraint) | Single WooCommerce store per deployment; multi-tenant store provisioning was an optional non-core feature. |
| **OAuth2 / SSO Integration** | *Not Implemented* | N/A (Architecture constraint) | Employs local JWT authentication with HttpOnly cookies and Bearer API keys. |

---

## End-to-End Evaluation Sequence

### Step 1: Storefront Navigation & Test Order Completion
1. Open the storefront in your browser:
   ```text
   http://shop.urumi.local/shop/
   ```
2. Click **Add to cart** on the seeded product **Urumi T-Shirt** ($19.99).
3. Click **View cart** and proceed to checkout (`http://shop.urumi.local/checkout/`).
4. Fill in test customer billing details:
   - First Name: `John`
   - Last Name: `Doe`
   - Street Address: `123 Test Street`
   - City: `Testville`
   - Postcode: `12345`
   - Phone: `555-555-5555`
   - Email: `john@example.com`
5. Select **Cash on delivery** and click **Place order**.
6. Verify the order confirmation page appears (`/checkout/order-received/...`) and note the generated Order ID (e.g., `#24`).
7. Verify in WooCommerce store administration:
   - Navigate to `http://shop.urumi.local/wp-login.php`.
   - Log in with WordPress store administrator credentials: username `admin`, password `password` (seeded in WordPress by `infra/scripts/seed-woo.sh`).
   - In the left sidebar, navigate to **WooCommerce > Orders**.
   - Confirm the order for **John Doe** is visible with status **Processing**.

---

### Step 2: User A (Admin) — Product Creation & Order Querying via Chat
1. Open the Urumi Dashboard:
   ```text
   http://dashboard.urumi.local
   ```
2. Log in as **User A (Urumi Dashboard Admin)**:
   - Email: `admin@urumi.local`
   - Password: `admin123`
   *(Configured in `infra/helm/urumi/values-local.yaml` for the Gateway database)*
3. Click on the **Chat** tab in the sidebar.
4. **Create a Product:**
   - Prompt:
     ```text
     Create a new WooCommerce product named "Urumi Tactical Hoodie" priced at 79.99 with description "Heavyweight fleece hoodie."
     ```
   - **Verification:** The Chat Agent invokes `woocommerce__create_product`. The response confirms product creation with its new ID and price.
   - **Cross-check in Storefront:** Refresh `http://shop.urumi.local/shop/` to see the new "Urumi Tactical Hoodie" listed in the catalog.
5. **Query Today's Orders:**
   - Prompt:
     ```text
     What are the recent orders in WooCommerce?
     ```
   - **Verification:** The Chat Agent executes `woocommerce__list_orders` and renders the structured orders table showing the order placed in Step 1.

---

### Step 3: User B (Member) — External MCP Client Connection & Discovery
1. Log in to the Dashboard as **User B (Member)** in an incognito window or after logging out:
   - Email: `member@urumi.local`
   - Password: `member123`
2. Navigate to the **API Keys** tab and click **Create Key**. Label it `Member External Client`.
3. Copy the generated key (e.g., `urumi_e6b014...`).
4. Connect via an external MCP Client (e.g., curl or MCP Inspector):
   ```bash
   MEMBER_KEY="<COPIED_KEY>"

   # Discover permitted tools via the Gateway MCP endpoint
   curl -s -X POST http://api.urumi.local/mcp \
     -H "Authorization: Bearer $MEMBER_KEY" \
     -H "Accept: application/json, text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "tools/list"
     }' | jq .
   ```
5. **Verification:**
   - Response contains tools permitted for the `member` role (`woocommerce__list_products`, `woocommerce__list_orders`, `weather__get_weather`, `github__list_issues`).
   - Notice that administrative-only tools are excluded.
6. Execute an authorized tool call:
   ```bash
   curl -s -X POST http://api.urumi.local/mcp \
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
7. **Verification:** The Gateway executes the tool on `weather-mcp` and returns the weather for Paris.

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
2. Click **Revoke** on the `Member External Client` key created in Step 3.
3. Immediately test the revoked key from your terminal:
   ```bash
   curl -s -i -X POST http://api.urumi.local/mcp \
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
   - The agent responds: `You currently have no tools available or permissions have been revoked...` or informs you that weather capabilities are not available.
6. Re-enable the server on the **Servers** tab. The server transitions to **Connected**, and tools are restored immediately.

---

### Step 7: Upstream Pod Failure Isolation & Recovery
1. Verify all upstreams are connected on the **Servers** tab.
2. In your terminal, terminate the `weather-mcp` deployment:
   ```bash
   kubectl --context kind-urumi-local scale deployment weather-mcp -n urumi --replicas=0
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
   kubectl --context kind-urumi-local scale deployment weather-mcp -n urumi --replicas=1
   kubectl --context kind-urumi-local wait --for=condition=ready pod -l app=weather-mcp -n urumi --timeout=60s
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
1. **Kubernetes Resources:**
   ```bash
   # Pods, Services, and Deployments
   kubectl --context kind-urumi-local get pods,svc,deploy -n urumi

   # Secrets and Persistent Volumes
   kubectl --context kind-urumi-local get secret,pvc -n urumi

   # Network Policies (default-deny and explicit rules)
   kubectl --context kind-urumi-local get networkpolicy -n urumi
   ```
2. **Key Security Mechanisms to Highlight:**
   - **Non-root execution:** Containers for Gateway and MCP upstreams enforce `runAsNonRoot: true` (`UID 1000`), Dashboard enforces `UID 101`.
   - **Token auto-mount disabled:** `automountServiceAccountToken: false` on `urumi-sa`.
   - **Pod-level isolation:** Upstream MCP servers and databases have no Ingress endpoints and can only be contacted via internal ClusterIP by authorized pods under NetworkPolicies.
   - **Unified Helm Chart:** Both local development and VPS/k3s production deployments use the exact same chart (`infra/helm/urumi`), configuring environments purely through values files (`values-local.yaml` vs. `values-prod.yaml`).
