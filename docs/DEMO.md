# Demonstration Flow

This script reproduces a full Definition-of-Done verification across 2 distinct identities.

1. **Architecture overview**: Explain the dual-role MCP structure.
2. **Kubernetes workloads**: Run `kubectl get pods -n urumi` to highlight segregated components.
3. **Dashboard login as User A (admin)**: Log into `http://dashboard.urumi.local`.
4. **Chat creates WooCommerce product**: "Create a product called Blue Widget with a price of 25."
5. **Place storefront order**: Navigate to `http://shop.urumi.local`, purchase the new item using COD.
6. **Chat retrieves today's order**: "What orders came in today?"
7. **Show audit log**: Reveal database logs confirming tool attribution to User A.
8. **Login/use User B API key**: Login as a member, generate a dedicated API Key.
9. **Connect external MCP client**: Point an external client to `http://api.urumi.local/mcp` using the Bearer token.
10. **Show aggregated tools**: Validate that `github__create_issue` and `woocommerce__list_orders` are exposed correctly.
11. **Execute WooCommerce call**: Retrieve the orders via the external client.
12. **Execute cross-server WooCommerce + GitHub flow**: Extract order details, and subsequently trigger `github__create_issue` to formulate a report.
13. **Revoke User B key**: Disable the key via the UI.
14. **Show rejection**: Demonstrate immediate `401 Unauthorized` responses on the external client.
15. **Disable upstream**: Turn off `github-mcp` inside the Dashboard.
16. **Show tools disappear**: Prove that GitHub tools are instantly stripped from the active registry.
17. **Kill upstream pod**: Run `kubectl delete pod -l app=weather-mcp -n urumi`.
18. **Show other servers remain healthy**: Execute a `woocommerce` tool to guarantee stability across pods.
19. **Explain security boundaries**: Verify the SSRF constraints and NetworkPolicies.
20. **Explain Helm local → production story**: Compare `values-local.yaml` to `values-prod.yaml`.
