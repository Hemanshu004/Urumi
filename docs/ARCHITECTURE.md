# System Design & Architecture

## Gateway as MCP Client + MCP Server
The Gateway implements a dual-role architecture:
1. **MCP Client**: Connects via `StreamableHTTPClientTransport` to internal upstream servers (WooCommerce, GitHub, Weather).
2. **MCP Server**: Exposes a unified `tools/list` and `tools/call` endpoint publicly.

## Tool Aggregation & Namespace Strategy
Upstream tools are dynamically aggregated. To prevent naming collisions, the Gateway enforces namespacing (e.g., `list_orders` from `woo-mcp` becomes `woocommerce__list_orders`). 

## Tool Routing
When a tool call is executed, the Gateway decrypts the namespaced tool string, queries the `ClientManager` map for the raw tool identity, and forwards the arguments directly to the respective upstream MCP microservice.

## Upstream Credentials & Isolation
The browser **never** sees upstream credentials. Connections to external REST APIs (e.g. WooCommerce) happen explicitly within the isolated internal pods. Credentials added via the UI are AES-256-GCM encrypted and only loaded into memory by the Gateway right before establishing the `StreamableHTTPClientTransport` session.

## Failure Isolation & Health Checking
If `github-mcp` crashes, it has zero impact on `woo-mcp`. The Gateway dynamically drops tools from the registry upon health-check failures and prevents cascading timeouts.

## Local vs Production
- **Local:** `values-local.yaml` focuses on `http` ingress rules mapping to `.local` TLDs, single replicas, and HostPath persistent volumes.
- **Production:** `values-prod.yaml` forces `https` TLS annotations, highly available replica sets, and Cloud Provider StorageClasses. The Helm chart strictly remains identical; environments purely differ in overriding parameters.
