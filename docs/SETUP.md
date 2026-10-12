# Urumi Setup & Deployment Guide

This guide provides practical, reproducible, step-by-step instructions for deploying Urumi both to a local Kind development cluster and to a k3s Linux VPS or production Kubernetes cluster.

---

## 1. Local Development Deployment (Kind)

### Prerequisites & Supported Versions
- **Docker Engine or Docker Desktop:** v24+ (`docker info`)
- **Kind (Kubernetes in Docker):** v0.20+ (`kind version`)
- **kubectl:** v1.28+ (`kubectl version --client`)
- **Helm:** v3.12+ (`helm version`)
- **Local Hostnames in `/etc/hosts`:**
  Map the following three local domains to `127.0.0.1`:
  ```text
  127.0.0.1 shop.urumi.local api.urumi.local dashboard.urumi.local
  ```

### Automated Single-Command Setup
The repository includes an end-to-end local setup script (`infra/scripts/setup-local.sh`):
```bash
# 1. Make all setup and build scripts executable
chmod +x infra/scripts/*.sh

# 2. Execute the automated setup script
./infra/scripts/setup-local.sh
```

**What `setup-local.sh` does automatically:**
1. Creates the Kind cluster `urumi-local` with port mappings for 80 and 443 using `infra/kind/cluster-config.yaml`.
2. Installs the official `ingress-nginx` controller for Kind and waits for the controller pod to become ready.
3. Automatically triggers `./infra/scripts/build-local-images.sh` to build all 5 custom application images and load them directly into Kind's container runtime:
   - `urumi-gateway:latest` (`apps/gateway`)
   - `urumi-dashboard:latest` (`apps/dashboard`)
   - `urumi-woo-mcp:latest` (`apps/woo-mcp`)
   - `urumi-github-mcp:latest` (`apps/github-mcp`)
   - `urumi-weather-mcp:latest` (`apps/weather-mcp`)
4. Deploys the unified Helm chart using `values.yaml` and `values-local.yaml` (where `imagePullPolicy: Never` is configured for local images).
5. Waits for all 8 database and application pods to achieve `Ready 1/1` status.

---

### Seeding WooCommerce Store & REST API
Once all pods are ready, run the WooCommerce initialization script:
```bash
./infra/scripts/seed-woo.sh
```
This script:
- Installs WP-CLI inside the WordPress pod.
- Configures WordPress site URL to `http://shop.urumi.local`.
- Installs and activates WooCommerce 8.7.0.
- Enables Cash on Delivery (COD) payment method.
- Creates the initial sample product **Urumi T-Shirt** ($19.99).
- Generates WooCommerce REST API v3 credentials and saves them to the Kubernetes Secret `urumi-woo-api`.
- Deploys an MU-plugin (`wc-rest-host-fix.php`) to permit internal HTTP REST requests.

---

### Verifying Local Deployment Health
Verify cluster workloads and endpoints sequentially:
```bash
# 1. Check pod status across the urumi namespace
kubectl --context kind-urumi-local get pods -n urumi
# All 8 pods must show STATUS: Running and READY: 1/1

# 2. Check Ingress status
kubectl --context kind-urumi-local get ingress -n urumi

# 3. Test Gateway Liveness and Readiness
curl -s http://api.urumi.local/health/live
# Expected: {"status":"healthy"}

curl -s http://api.urumi.local/health/ready
# Expected: {"status":"ready"}

# 4. Access URLs in your browser
# Dashboard:   http://dashboard.urumi.local
# Storefront:  http://shop.urumi.local
# Gateway API: http://api.urumi.local
```

### Default Local Credentials
- **Urumi Dashboard Admin:** `admin@urumi.local` / `admin123`
- **Urumi Dashboard Member:** `member@urumi.local` / `member123`
- **WordPress Admin:** `http://shop.urumi.local/wp-login.php` (User: `admin`, Pass: `password`)

---

### Local Development Image Rebuilding
When modifying code in `apps/`, rebuild and reload images without resetting the cluster:
```bash
# Rebuild and load all 5 images into Kind
./infra/scripts/build-local-images.sh urumi-local

# Restart deployments to use the fresh images
kubectl --context kind-urumi-local rollout restart deployment -n urumi
```

---

## 2. Production-Style k3s / VPS Deployment

> **Deployment Validation Notice:** The production Helm configuration (`values-prod.yaml`), Traefik ingress definitions, local-path volume claims, and deployment manifests have been strictly validated via `helm lint` and dry-run template rendering (`helm template`). However, a live deployment to a remote Linux VPS instance has not yet been executed; all live integration tests in this repository were conducted against the verified local Kind cluster.

Deploying Urumi to a Linux VPS running k3s or a managed Kubernetes cluster uses the exact same Helm chart (`infra/helm/urumi`), configured via `values-prod.yaml`.

### VPS Prerequisites
- **Linux VPS:** Ubuntu 22.04+ or Debian 12 with public IP, ports 80 and 443 open.
- **k3s Installed:**
  ```bash
  curl -sfL https://get.k3s.io | sh -
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  ```
- **Helm Installed:**
  ```bash
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  ```
- **DNS Records:**
  Configure public DNS A records pointing to your VPS public IP:
  - `shop.yourdomain.com` $\rightarrow$ `<VPS_IP>`
  - `api.yourdomain.com` $\rightarrow$ `<VPS_IP>`
  - `dashboard.yourdomain.com` $\rightarrow$ `<VPS_IP>`

### Step-by-Step Production Deployment
1. Build and push production container images to your registry (e.g., GitHub Container Registry):
   ```bash
   REGISTRY="ghcr.io/your-org"
   docker build -t ${REGISTRY}/urumi-gateway:0.1.0 ./apps/gateway && docker push ${REGISTRY}/urumi-gateway:0.1.0
   docker build -t ${REGISTRY}/urumi-dashboard:0.1.0 ./apps/dashboard && docker push ${REGISTRY}/urumi-dashboard:0.1.0
   docker build -t ${REGISTRY}/urumi-woo-mcp:0.1.0 ./apps/woo-mcp && docker push ${REGISTRY}/urumi-woo-mcp:0.1.0
   docker build -t ${REGISTRY}/urumi-github-mcp:0.1.0 ./apps/github-mcp && docker push ${REGISTRY}/urumi-github-mcp:0.1.0
   docker build -t ${REGISTRY}/urumi-weather-mcp:0.1.0 ./apps/weather-mcp && docker push ${REGISTRY}/urumi-weather-mcp:0.1.0
   ```

2. Review and configure `infra/helm/urumi/values-prod.yaml`:
   - Set `ingress.className: "traefik"` (k3s default).
   - Set your real public domain names under `ingress.hosts`.
   - Update image repositories to your registry URLs.
   - Confirm storage classes: `local-path` is used by default in k3s.
   - Confirm replica constraints: Keep `gateway.replicas: 1` (in-memory SSE session constraint) and `wordpress.replicas: 1` (ReadWriteOnce storage constraint).

3. Deploy using Helm, passing production secrets securely:
   ```bash
   helm upgrade --install urumi infra/helm/urumi \
     --namespace urumi --create-namespace \
     -f infra/helm/urumi/values.yaml \
     -f infra/helm/urumi/values-prod.yaml \
     --set secrets.adminPassword="<STRONG_ADMIN_PASSWORD>" \
     --set secrets.memberPassword="<STRONG_MEMBER_PASSWORD>" \
     --set secrets.jwtSecret="<MIN_32_CHAR_JWT_SECRET>" \
     --set secrets.llmApiKey="<YOUR_LLM_API_KEY>" \
     --set secrets.githubToken="<YOUR_GITHUB_PAT>"
   ```

4. Verify pod and PVC status:
   ```bash
   kubectl get pods,pvc,ingress -n urumi
   ```

5. Seed WooCommerce in the production WordPress instance:
   ```bash
   # Run the seed script targeting the production cluster context/namespace
   ./infra/scripts/seed-woo.sh
   ```

6. Rollback if needed:
   ```bash
   helm history urumi -n urumi
   helm rollback urumi 1 -n urumi
   ```

---

## 3. Common Troubleshooting Scenarios

| Issue | Root Cause | Resolution |
| :--- | :--- | :--- |
| **`ErrImageNeverPull`** | Custom image is missing from Kind's local container runtime. | Run `./infra/scripts/build-local-images.sh urumi-local` to build and load the 5 custom images into Kind. |
| **`ImagePullBackOff` on external images** | Network timeout or Docker Hub rate limiting on WordPress/MariaDB/PostgreSQL. | Check host internet connectivity. Test pulling manually: `docker pull wordpress:6.7-apache`. |
| **Ingress 502 Bad Gateway** | Target pod is still initializing or failing liveness/readiness probes. | Inspect pod logs and events: `kubectl describe pod <name> -n urumi` and `kubectl logs <name> -n urumi`. |
| **Ingress 404 Not Found** | Incorrect `Host` header sent to Ingress. | Ensure `/etc/hosts` contains `shop.urumi.local`, `api.urumi.local`, `dashboard.urumi.local` mapped to `127.0.0.1`. |
| **Gateway `FATAL: JWT_SECRET` exit** | `JWT_SECRET` is missing or shorter than 32 characters. | Supply a valid 32+ character JWT secret via Helm values or `--set secrets.jwtSecret=...`. |
| **`404 Session not found` on MCP** | External client posted to an SSE session on a different replica or expired session. | Verify `gateway.replicas: 1`. In-memory SSE transports require single-replica deployment. |
| **`403 Forbidden` on Tool Call** | Caller role (`member`) has not been granted permission for the requested namespaced tool. | Log in as `admin@urumi.local`, navigate to **Permissions**, and grant the tool to the `member` role. |
| **WooCommerce Seed Script Fails** | WordPress pod is not yet ready or MariaDB connection timed out. | Wait for `kubectl get pods -n urumi -l app.kubernetes.io/component=app` to show `1/1 Running`, then re-run `./infra/scripts/seed-woo.sh`. |
