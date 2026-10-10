# Urumi Final Demo Script

This document provides a step-by-step reproducible script demonstrating all critical functional requirements of the Urumi MCP Gateway.

## Prerequisites
- Docker, Kind, and Helm installed.
- A running Kind cluster with the Urumi Helm chart deployed (`helm install urumi infra/helm/urumi -n urumi`).
- An external MCP Client (e.g., Claude Desktop or MCP CLI).
- A seeded WooCommerce instance (`./infra/scripts/seed-woo.sh`).
- Local DNS entries for `shop.urumi.local`, `api.urumi.local`, and `dashboard.urumi.local` mapped to `127.0.0.1`.

---

## Demo Sequence

### Step 1: Architecture, Helm Deployment, and Health Checks
- **Action:** Run `kubectl get pods,svc,networkpolicy -n urumi`.
- **Expected Output:** Isolated pods for `gateway`, `dashboard`, `weather-mcp`, `github-mcp`, `woo-mcp`, `gateway-db`, and `wordpress`. Probes are active.
- **Action:** Open `http://api.urumi.local/health/live`.
- **Expected Output:** Returns a 200 OK indicating the Gateway API is healthy.

### Step 2: Admin and Member Login
- **Action:** Navigate to `http://dashboard.urumi.local`.
- **Expected Output:** Log in with `admin@urumi.local` (password: `admin123`). Navigate through the dashboard. Then log out and log in with `member@urumi.local` (password: `member123`) to confirm RBAC on the dashboard limits access appropriately.

### Step 3: MCP Server Registration and Tool Discovery
- **Action:** Log in as `admin`. Go to the **Servers** tab.
- **Expected Output:** See `weather`, `woocommerce`, and `github` upstreams connected. The Gateway dynamically discovers their tools (`weather__get_weather`, `woocommerce__list_products`, etc.).

### Step 4: User-Specific API-Key Creation
- **Action:** As `member@urumi.local`, navigate to the **API Keys** tab and click **Create Key**.
- **Expected Output:** A unique API key is presented once. Copy this key to your clipboard.

### Step 5: External MCP Client Connection
- **Action:** Configure your external MCP Client (e.g., Claude Desktop or Inspector) to connect via SSE:
  - URL: `http://api.urumi.local/mcp`
  - Header: `Authorization: Bearer <YOUR_API_KEY>`
- **Expected Output:** The client connects using only the gateway URL and the user's API key. It discovers all tools the `member` is permitted to use. The client does not need upstream URLs or credentials.

### Step 6: Tool Permissions and Immediate Revocation
- **Action:** In the external MCP client, attempt to call a sensitive tool (e.g., `weather__get_weather`).
- **Expected Output:** If denied, the Gateway actively blocks the call.
- **Action:** As the admin in the dashboard, grant `weather__get_weather` to the `member` role. Try again in the external client.
- **Expected Output:** The execution succeeds.
- **Action:** As the admin, instantly revoke the permission. Try again on the external client's existing connection.
- **Expected Output:** The call is instantly rejected with a `403 Forbidden` despite the connection being persistent.

### Step 7: Product Creation Through Chat
- **Action:** Log in as admin. Open the **Chat** tab and type: "Create a WooCommerce product named 'Urumi Jacket' priced at 49.99."
- **Expected Output:** The LLM successfully utilizes the `woocommerce__create_product` tool, resulting in a successful creation confirmation.

### Step 8: Storefront Checkout and Order Visibility
- **Action:** Open the storefront at `http://shop.urumi.local`.
- **Expected Output:** See the newly created 'Urumi Jacket' and the seeded 'Urumi T-Shirt'.
- **Action:** Add a product to your cart and proceed to checkout.
- **Action:** Complete the checkout with local test data (e.g., John Doe, Testville) and select 'Cash on Delivery'.
- **Action:** Log in to `http://shop.urumi.local/wp-admin` (admin/password).
- **Expected Output:** Navigate to WooCommerce > Orders to see the completed order.

### Step 9: Today's Order Query
- **Action:** Return to the Gateway Chat as admin and ask: "What are today's orders in WooCommerce?"
- **Expected Output:** The LLM queries the `woocommerce__list_orders` tool and reports back the order you just placed in Step 8.

### Step 10: Multi-Upstream Prompt
- **Action:** In the Chat tab, ask: "What is the weather in Paris, and what are the latest products in WooCommerce?"
- **Expected Output:** The LLM agent uses both `weather__get_weather` and `woocommerce__list_products` tools in the same prompt resolution, leveraging both upstream services seamlessly.

### Step 11: API-Key Revocation
- **Action:** As `member@urumi.local`, go to API Keys and delete the key you created.
- **Action:** Attempt to issue a new tool call or reconnect the external MCP client using that key.
- **Expected Output:** Access is denied immediately with a `401 Unauthorized` response.

### Step 12: Upstream Failure Isolation and Recovery
- **Action:** Scale down the weather upstream using the terminal: `kubectl scale deployment weather-mcp -n urumi --replicas=0`
- **Expected Output:** On the dashboard Servers tab, the weather upstream transitions to an unhealthy/disconnected state.
- **Action:** Attempt to call `weather__get_weather` via the Chat.
- **Expected Output:** The tools are no longer executable. Other upstreams (like GitHub and WooCommerce) continue working perfectly.
- **Action:** Scale the upstream back up: `kubectl scale deployment weather-mcp -n urumi --replicas=1`
- **Expected Output:** The Gateway auto-reconnects, and tool discovery recovers. The weather tools become executable again.

### Step 13: Audit Logs and Security Boundaries
- **Action:** Navigate to the **Audit Logs** tab in the dashboard.
- **Expected Output:** You see a chronological ledger of all tool calls made during this demo. It includes successful product creations, multi-upstream usage, and the denied tool attempts (Step 6), enforcing strict identity attribution and security boundaries.
