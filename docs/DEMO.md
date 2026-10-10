# Urumi Final Demo Script

This document provides a step-by-step reproducible script demonstrating all critical functional requirements of the Urumi MCP Gateway.

## Prerequisites
- A running Kind cluster with the Urumi Helm chart deployed (`helm install urumi infra/helm/urumi -n urumi`).
- An external MCP Client (e.g., Claude Desktop or MCP CLI) configured to allow arbitrary HTTP SSE server connections.
- The `ADMIN_PASSWORD` and `MEMBER_PASSWORD` secrets must have been injected during Helm installation.
- A functional WooCommerce instance with basic setup (can be done via `seed-woo.sh`).

## Demo Sequence

### Step 1: Architecture and Kubernetes Workloads
- **Action:** Run `kubectl get pods,svc,networkpolicy -n urumi`.
- **Expected Output:** You will see isolated pods for `gateway`, `dashboard`, `weather-mcp`, `github-mcp`, `woo-mcp`, `gateway-db`, and `wordpress`. Probes are active, and NetworkPolicies enforce restricted access.
- **Evidence:** Terminal output showing `Running` pods and explicitly restricted network policies.

### Step 2: WooCommerce Integration
- **Action:** Open `http://shop.urumi.local` (WordPress storefront). Add any product to the cart, navigate to checkout, and complete a "Cash on Delivery" order. Log into `http://shop.urumi.local/wp-admin` as the WP admin.
- **Expected Output:** The order appears under WooCommerce > Orders.
- **Evidence:** Browser screens showing the order confirmation and backend order visibility.

### Step 3: Upstream MCP Registration
- **Action:** Open the Gateway dashboard at `http://dashboard.urumi.local` and log in as the `admin@urumi.local` user. Navigate to the **Servers** tab.
- **Expected Output:** The `weather`, `woocommerce`, and `github` upstreams are visible, enabled, and show a `Connected` status badge with health information.

### Step 4: Admin Permission Grant
- **Action:** Navigate to the **Team** tab and assign permissions, or use the API. Grant the `member` role access to the `weather__get_weather` tool.
- **Expected Output:** The tool is explicitly granted.

### Step 5: Authorized Tool Execution
- **Action:** Log out and log in as `member@urumi.local`. Navigate to the **Chat** tab and ask: "What is the weather in Paris?"
- **Expected Output:** The agent executes `weather__get_weather` and returns a real-time response. The chat UI displays the tool execution badge as "Success".
- **Evidence:** The LLM's natural language response and the tool's JSON result in the UI.

### Step 6 & 7: Permission Revocation and Immediate Denial
- **Action:** Log back in as `admin@urumi.local` and **revoke** the `weather__get_weather` tool from the `member` role. Log back in as `member@urumi.local`. Type "What is the weather in London?" in the same chat session.
- **Expected Output:** The agent's response says: "You don't currently have permission to use the Weather `get_weather` tool."
- **Evidence:** No upstream invocation occurs. The chat UI shows a `denied` badge.

### Step 8 & 9: External Client Execution
- **Action:** In the dashboard (as member), go to **API Keys** and generate a new key. Configure your external MCP client to connect to `http://api.urumi.local/mcp` providing the `Authorization: Bearer <API_KEY>` header.
- **Expected Output:** The client lists the tools currently allowed for the `member` role. Request the client to execute a permitted tool. It returns the data successfully.

### Step 10: API Key Revocation
- **Action:** In the dashboard, delete the member's API key. Return to the external MCP client and attempt to execute another tool or reconnect.
- **Expected Output:** The client receives a `401 Unauthorized` HTTP error immediately.

### Step 11: Failure Isolation
- **Action:** Go to the **Servers** tab as admin. Toggle the `github` server to disabled. As a member, ask the chat for GitHub issues (denied/unknown) and then ask for WooCommerce products (which is still enabled).
- **Expected Output:** The GitHub tools disappear instantly from the registry. The WooCommerce request executes flawlessly. 
- **Evidence:** The Gateway does not crash; other upstreams are unaffected.

### Step 12: Upstream Recovery
- **Action:** Re-enable the `github` server in the UI.
- **Expected Output:** The health loop reconnects to the GitHub pod. The tools are immediately restored to the registry and become available for execution.

### Step 13: Audit Logs and Identity Attribution
- **Action:** Navigate to the **Audit Logs** tab in the dashboard.
- **Expected Output:** A ledger displaying every tool execution. It explicitly attributes the `member` user ID to the executions made via the external client API key and the chat. The denied Weather attempt explicitly registers as a `denied` outcome.

### Step 14: System Health
- **Action:** Return to the **Overview/Home** page.
- **Expected Output:** The Gateway Health badge displays "Healthy", confirming that database and Kubernetes probes are fully satisfied.
