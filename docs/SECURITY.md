# Threat Model & Security Validations

## Protections Implemented
- **SSRF Prevention:** Gateway restricts `tools/call` external URLs to eliminate AWS/GCP metadata and link-local ranges using `ipaddr.js`.
- **Encrypted Runtime Credentials:** Database stores configurations securely mapped via `AES-256-GCM`.
- **API Key Hashing:** Access keys are passed through `bcrypt`, preventing plain-text theft.
- **Revocation Check:** Immediate mid-flight request validation ensures disabled tokens cannot finish transactions.
- **NetworkPolicies:** Pod-to-Pod traffic strictly abides by an explicitly whitelisted `default-deny` firewall.
- **Least-Privilege Containers:** The following workloads use security contexts to enforce non-root execution (`runAsNonRoot: true`):
  - **Gateway and MCP workloads:** Run as the `node` user (`runAsUser: 1000`).
  - **Dashboard:** Runs as the `nginx-unprivileged` user (`runAsUser: 101`).
  - *Note (Limitations and Future Hardening):* Database workloads (MariaDB, PostgreSQL) and WordPress currently do not have security contexts configured in the Helm templates. They have not been hardened for non-root execution in this release.

## Threat Vectors and Limitations

- **Client Tokens and Upstream Authentication:** Client JWT tokens are evaluated at the Gateway and are **not** forwarded to upstream MCP servers. This decouples user sessions from backend services. Instead, the Gateway authenticates upstream requests using shared, encrypted credentials stored in the `upstream_servers` database table, which it decrypts and attaches as Bearer tokens.
- **Prompt Injection via MCP Tools:** While NetworkPolicies and SSRF protections isolate the Gateway infrastructure, they do **not** prevent model-level prompt injection. Malicious content returned by an upstream tool (e.g., a poisoned GitHub issue or WooCommerce product description) is fed directly into the LLM context, which could influence the model to execute unintended tool calls.
- **Member-to-Member Isolation (Limitation):** The Gateway enforces Role-Based Access Control (RBAC), not user-level isolation. There are no per-user upstream credentials. All users with the `member` role share access to the same globally configured upstream servers and tools. Consequently, one member can access or modify upstream resources created by another member if the tool permits it.
- **Shared Upstream Credentials (Residual Risk):** Because upstream credentials are provided globally to the MCP servers, any member authorized to invoke a tool assumes the privileges of that shared credential (e.g., a global GitHub token). Even though the member cannot extract or see the credential, they can invoke any operation permitted by it, bounded only by the tool's explicit implementation and the Gateway's RBAC.
- **Credential Leakage:** Browsers solely receive tool execution results. Upstream secrets strictly terminate at the Gateway memory.
- **Cross-Member Manipulation:** Audit Logging strictly tracks `userId` alongside executed tools, providing an audit trail for shared credential usage.
