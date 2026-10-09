# Threat Model & Security Validations

## Protections Implemented
- **SSRF Prevention:** Gateway restricts `tools/call` external URLs to eliminate AWS/GCP metadata and link-local ranges using `ipaddr.js`.
- **Encrypted Runtime Credentials:** Database stores configurations securely mapped via `AES-256-GCM`.
- **API Key Hashing:** Access keys are passed through `bcrypt`, preventing plain-text theft.
- **Revocation Check:** Immediate mid-flight request validation ensures disabled tokens cannot finish transactions.
- **NetworkPolicies:** Pod-to-Pod traffic strictly abides by an explicitly whitelisted `default-deny` firewall.
- **Least-Privilege Containers:** Security contexts enforce `runAsUser: 1000` executing as standard `node` or `nginx-unprivileged`.

## Threat Vectors
- **Malicious MCP server/tool descriptions:** Tools are strictly routed through isolated upstream pods preventing local execution vulnerabilities on the Gateway.
- **Credential Leakage:** Browsers solely receive generalized tool execution confirmations. Upstream secrets strictly terminate at the Gateway memory.
- **Cross-Member Manipulation:** Audit Logging strictly tracks `userId` alongside API keys, eliminating repudiation of executed logic.
