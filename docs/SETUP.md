# Urumi Setup Guide

## 1. Local Development (Kind)

### Prerequisites
- Docker, kubectl, Helm, and Kind installed.

### Fresh Local Kind Installation
1. Make scripts executable: `chmod +x infra/scripts/*.sh`
2. Run kind initialization: `./infra/scripts/setup-local.sh`
   *(This creates the cluster and installs the Nginx Ingress Controller.)*

### Required Local Hostnames
Map the following hostnames to `127.0.0.1` in your `/etc/hosts` file:
```text
127.0.0.1 shop.urumi.local api.urumi.local dashboard.urumi.local
```

### Building and Loading Local Images
To build the images locally and load them into the Kind cluster so Helm can use them without pushing to a registry:
```bash
# Example for gateway
docker build -t urumi-gateway:latest ./apps/gateway
kind load docker-image urumi-gateway:latest --name urumi-cluster
# Repeat for dashboard, github-mcp, weather-mcp, woo-mcp
```

### Installing or Upgrading with Local Values
Install or upgrade the Helm chart using the default local values:
```bash
helm upgrade --install urumi infra/helm/urumi -n urumi -f infra/helm/urumi/values-local.yaml --create-namespace
```

### Verifying Health, Readiness, and Connectivity
1. Watch the pod status until they show `READY 1/1`:
   `kubectl get pods -n urumi -w`
2. Test dashboard access: open `http://dashboard.urumi.local`
3. Test Gateway health: `curl http://api.urumi.local/health/live`
4. Test WordPress access: `http://shop.urumi.local`
5. Run the WooCommerce seed script if it's a fresh install:
   `./infra/scripts/seed-woo.sh`

---

## 2. Production-Style Deployment

A production deployment typically involves pulling images from a real registry, setting production hosts, and supplying strong secrets. Note: Unless performed on a real cluster (like EKS or GKE), this is a "production-style" configuration rather than a fully verified production deployment.

### Configuring a Production-Style Deployment
1. Prepare your overrides in `values-prod.yaml`. Ensure you override:
   - `ingress.hosts` (e.g., `shop.example.com`, `api.example.com`, `dashboard.example.com`)
   - `<app>.image.pullPolicy` to `IfNotPresent` or `Always`.
   - `<app>.image.repository` to your actual registry URL.
   - Resource limits and requests.
2. Deploy using Helm, passing strong secrets directly (or via a secret manager):
```bash
helm upgrade --install urumi infra/helm/urumi -n urumi \
  -f infra/helm/urumi/values-prod.yaml \
  --set secrets.adminPassword="STRONG_ADMIN_PASSWORD" \
  --set secrets.jwtSecret="STRONG_32_CHAR_JWT_SECRET" \
  --set secrets.llmApiKey="YOUR_LLM_PROVIDER_KEY" \
  --create-namespace
```

### Rolling Back a Failed Helm Upgrade
If a Helm upgrade fails or introduces instability, you can easily roll back to the previous revision:
```bash
# List revision history
helm history urumi -n urumi

# Rollback to the previous stable revision (e.g., revision 1)
helm rollback urumi 1 -n urumi
```

### Note on Production Verification
The production-style configuration uses external image registries and standard ingress hostnames. It has been verified via Helm templating and YAML validation, but a true production verification requires executing the deployment on a real VPS or managed Kubernetes cluster.
