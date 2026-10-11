# Urumi Architecture

This document describes the architectural design, components, integration points, and trade-offs of the Urumi platform.

## 1. System Design and Components

Urumi is an agentic platform designed to securely connect Large Language Models (LLMs) to a suite of tools through the Model Context Protocol (MCP), while strictly enforcing role-based access control and comprehensive auditing.

### Main Components
- **Dashboard (Frontend)**: A React-based Single Page Application. It serves as the primary interface for users to initiate chats and administrators to manage members, API keys, and MCP servers.
- **Gateway (Backend)**: An Express.js Node.js application that forms the core of Urumi. It acts as an intermediary between the dashboard/clients, the LLM provider, and the MCP upstream servers. It handles authentication, tool authorization, prompt construction, request routing, and auditing.
- **MCP Upstreams**: Standalone microservices implementing the Model Context Protocol. By default, the included upstream microservices communicate via Streamable HTTP (with SSE fallback supported by the Gateway). Examples include `github-mcp`, `weather-mcp`, and `woo-mcp`. They expose specific functionality (e.g., retrieving weather, listing products) without maintaining their own user authorization logic.
- **Databases**:
  - **Gateway DB (PostgreSQL)**: Stores core platform data, including users, roles, encrypted server credentials, API keys, and audit logs.
  - **WordPress DB (MariaDB)**: Dedicated backend relational database for WordPress and the included WooCommerce store.
- **Kubernetes / Helm Deployment**: The entire stack is orchestrated via Helm. Services run as isolated Pods within the Kubernetes cluster. Internal routing is handled by Kubernetes Services, and external access is managed through a central Ingress.

### Request Flow
1. **Client Interaction**: A user submits a prompt via the Dashboard or API.
2. **Gateway Processing**: The Gateway validates the request, verifying the user's identity via JWT authentication and role-based permissions.
3. **LLM Invocation**: The Gateway forwards the prompt, along with the schema of tools the user is *authorized* to use, to the LLM (e.g., Groq/Gemini).
4. **Tool Selection**: The LLM responds with a tool call.
5. **Upstream Execution**: The Gateway validates the tool call against the authorized tools list. If authorized, the Gateway invokes the corresponding tool on the appropriate MCP upstream via Streamable HTTP (or SSE where configured).
6. **LLM Completion**: The Gateway sends the tool's result back to the LLM to generate the final natural language response.
7. **Client Response**: The final response is streamed or returned to the user, and the action is logged in the Gateway DB.

### Architectural Trade-offs and Limitations
- **Stateless Upstreams**: MCP upstreams do not know *who* is invoking them. The Gateway handles all authorization. This simplifies upstream development but places a heavy security burden on the Gateway and limits the ability to apply fine-grained upstream-specific ACLs (e.g., "User A can only access GitHub repository X").
- **Gateway as a Single Point of Failure**: All LLM routing and tool executions pass through the Gateway. While this enables centralized auditing and security controls, it creates a potential bottleneck for high-throughput traffic.
- **Streamable HTTP / SSE Transport for MCP**: Upstream MCP services primarily communicate over Streamable HTTP (with fallback to Server-Sent Events / SSE for endpoints explicitly ending in `/sse`). This requires connection lifecycle management and introduces standard HTTP overhead compared to persistent binary protocols (like WebSockets or gRPC), but it simplifies debugging, stateless scaling, and reverse-proxying.
- **Internal Network Isolation vs Flexibility**: SSRF restrictions strictly limit MCP server URLs to internal namespaces (e.g., `urumi`). This enhances security by preventing the Gateway from interacting with arbitrary external APIs, but it limits administrators from adding external MCP services outside the allowed namespace list without reconfiguring the platform.

---

## 2. Standout Features

- **Tool Authorization & Enforcement**: The Gateway implements strict Role-Based Access Control (RBAC) down to the tool level. The LLM is only provided the schema of tools the user is permitted to use. Even if the LLM hallucinates or attempts to invoke an unauthorized tool, the Gateway blocks the invocation prior to reaching the upstream server.
- **Audit Attribution**: Every executed tool call is persistently logged in the `audit_logs` table, attaching the exact `user_id`, `server_id`, `tool_name`, `arguments`, and execution outcome (success, error, or denied).
- **Upstream Health Reporting**: The Gateway continuously monitors the availability of connected MCP upstreams via polling. Unresponsive servers are automatically marked as disconnected, and their tools are temporarily removed from the LLM context to prevent broken tool invocations.
- **SSRF Restrictions**: The Gateway explicitly restricts internal SSRF (Server-Side Request Forgery) by strictly validating the URLs of upstream servers against an environment-driven namespace allow-list, preventing unauthorized scanning or lateral movement within the cluster.
- **Credential Handling**: MCP server connection credentials (if any) are encrypted at rest in the PostgreSQL database using an AES-256-GCM cipher and are decrypted at runtime purely in memory when establishing upstream connections. The Gateway sanitizes the `GET /api/servers` responses to hide URLs and timeouts from non-admin members.

*(Note: These features reflect the current implementation state. Future plans, such as upstream-level ACLs or WebSockets support, are not yet integrated into the system).*

---

## 3. WooCommerce MCP Integration

Urumi includes a dedicated MCP integration for WooCommerce (`woo-mcp`), allowing the LLM to interact with a WordPress e-commerce store.

### Communication Approach
The `woo-mcp` server communicates with the WooCommerce backend via the **WooCommerce REST API** (v3), using the `@woocommerce/woocommerce-rest-api` client. It registers native MCP tools like `list_products`, `create_product`, `list_orders`, and `update_order_status`.

### Credential Configuration
- **Supply Mechanism**: The integration requires a `WOOCOMMERCE_CONSUMER_KEY` and `WOOCOMMERCE_CONSUMER_SECRET`. In the Helm deployment, these are securely generated or provided as Kubernetes Secrets and injected as environment variables into the `woo-mcp` container.
- **Usage**: The credentials are used directly by the `woo-client.ts` to instantiate the API constructor. Since internal traffic is often HTTP-only, `queryStringAuth: true` is explicitly enabled so WooCommerce accepts the credentials without strictly requiring HTTPS.

### Security Considerations
- **High Privilege**: The consumer key and secret effectively grant full read/write access to the WooCommerce store. The `woo-mcp` service must be kept strictly isolated from external access, receiving requests only from the Urumi Gateway.
- **No User Context**: The WooCommerce API executes actions under the identity of the API key owner, not the Urumi member who initiated the request. Urumi administrators must rely entirely on the Gateway's RBAC to control which members can trigger WooCommerce mutations.

---

## Architecture Diagram

```mermaid
flowchart TD
    Client[Dashboard / Client API] -->|HTTP/REST| Gateway[Urumi Gateway]

    subgraph Core Platform
        Gateway <--> GatewayDB[(Gateway DB: PostgreSQL)]
    end

    Gateway <-->|LLM Prompt + Tools| LLM[LLM Provider (Groq/Gemini)]

    subgraph Internal Network
        Gateway -->|Streamable HTTP / SSE| GithubMCP[github-mcp]
        Gateway -->|Streamable HTTP / SSE| WeatherMCP[weather-mcp]
        Gateway -->|Streamable HTTP / SSE| WooMCP[woo-mcp]
    end

    WooMCP <-->|REST API| WooCommerce[WordPress / WooCommerce]
    WooCommerce <--> WooDB[(WordPress DB: MariaDB)]
```
