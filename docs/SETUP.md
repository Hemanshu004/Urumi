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

## 2. Production Deployment (GCP k3s VM & Linux VPS)

The Urumi platform is deployed and running live on a Google Cloud Platform (GCP) Compute Engine virtual machine running **k3s** with **Traefik Ingress**. All components are deployed in the `urumi` namespace and managed through Helm.

### Live Production Endpoints

| Service / Interface | Public URL / Endpoint | Transport / Protocol | Backend Service |
| :--- | :--- | :--- | :--- |
| **Administrative Dashboard** | [https://dashboard.34.14.187.15.nip.io](https://dashboard.34.14.187.15.nip.io) | HTTPS / Browser | `urumi-dashboard` (port 80 $\rightarrow$ 8080) |
| **API Gateway Backend** | [https://api.34.14.187.15.nip.io](https://api.34.14.187.15.nip.io) | HTTPS / REST | `gateway` (port 3000) |
| **WooCommerce Storefront** | [https://shop.34.14.187.15.nip.io](https://shop.34.14.187.15.nip.io) | HTTPS / Browser | `urumi-wordpress` (port 80) |
| **External MCP Endpoint** | `https://api.34.14.187.15.nip.io/mcp` | HTTPS / SSE & Streamable HTTP | `gateway` (`/mcp` route) |

### Architecture & Resource Details

1. **Traefik Ingress:**
   - Ingress class: `traefik` (k3s built-in ingress controller).
   - Routes `dashboard.34.14.187.15.nip.io`, `api.34.14.187.15.nip.io`, and `shop.34.14.187.15.nip.io`.
2. **Internal MCP Services:**
   - Upstream MCP microservices (`woo-mcp:3001`, `github-mcp:3002`, `weather-mcp:3003`) and databases (`gateway-db:5432`, `urumi-wordpress-db:3306`) are strictly internal **ClusterIP** services.
   - They do not expose public Ingress paths. External access is routed solely through the Gateway.
3. **Persistent Volume Claims (PVCs):**
   - Managed by k3s default `local-path` storage provisioner (`ReadWriteOnce`):
     - `gateway-db`: 5 GiB StatefulSet volume (`/var/lib/postgresql/data`).
     - `urumi-wordpress-db`: 5 GiB StatefulSet volume (`/var/lib/mysql`).
     - `urumi-wordpress`: 5 GiB PVC `urumi-wordpress-data` (`/var/www/html/wp-content`).
4. **Container Image Distribution:**
   - Production images are hosted on GitHub Container Registry:
     - `ghcr.io/hemanshu004/urumi-gateway:latest`
     - `ghcr.io/hemanshu004/urumi-dashboard:latest`
     - `ghcr.io/hemanshu004/urumi-woo-mcp:latest`
     - `ghcr.io/hemanshu004/urumi-github-mcp:latest`
     - `ghcr.io/hemanshu004/urumi-weather-mcp:latest`
   - Image pull authentication is handled via Kubernetes Secret `ghcr-creds` in namespace `urumi`.

---

### Step-by-Step Production Deployment Guide

#### 1. VPS / VM Prerequisites
- Linux VM (Ubuntu 22.04+ or Debian 12) with public IP, ports 80 and 443 open in firewall.
- k3s installed:
  ```bash
  curl -sfL https://get.k3s.io | sh -
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  ```
- Helm v3 installed:
  ```bash
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  ```
- Kubernetes secret for GHCR image pulling (if using private registry):
  ```bash
  kubectl create secret docker-registry ghcr-creds \
    --namespace urumi \
    --docker-server=ghcr.io \
    --docker-username=<GITHUB_USERNAME> \
    --docker-password=<GITHUB_PAT>
  ```

#### 2. Helm Values Hierarchy & Ordering
Production deployment uses a 3-tier values hierarchy applied in strict order:
1. `infra/helm/urumi/values.yaml` (base defaults and schemas)
2. `infra/helm/urumi/values-prod.yaml` (production settings: traefik, local-path storage, 5Gi sizes)
3. `infra/helm/urumi/values-gcp.yaml` (GCP live overrides: nip.io public domains, GHCR image references, 1 replica)

#### 3. Execute Helm Deployment
Deploy or upgrade the release, passing sensitive credentials securely via `--set`:
```bash
helm upgrade --install urumi infra/helm/urumi \
  --namespace urumi --create-namespace \
  -f infra/helm/urumi/values.yaml \
  -f infra/helm/urumi/values-prod.yaml \
  -f infra/helm/urumi/values-gcp.yaml \
  --set secrets.adminPassword="<STRONG_ADMIN_PASSWORD>" \
  --set secrets.memberPassword="<STRONG_MEMBER_PASSWORD>" \
  --set secrets.jwtSecret="<MIN_32_CHAR_JWT_SECRET>" \
  --set secrets.llmApiKey="<YOUR_LLM_API_KEY>" \
  --set secrets.githubToken="<YOUR_GITHUB_PAT>"
```

#### 4. Secret Management & Upgrade Safety
- Auto-generated database passwords, JWT secrets, and AES-256 master keys are preserved across subsequent `helm upgrade` commands via the chart's built-in `lookup` function.
- Production secrets (`adminPassword`, `memberPassword`, `jwtSecret`, `llmApiKey`, `githubToken`) should never be committed into Git repositories. Pass them via `--set` or an untracked `secrets-prod.yaml` file.

#### 5. Verify Pod, PVC, and Ingress Status
```bash
# Check workload readiness
kubectl get pods,pvc,ingress -n urumi

# Verify Gateway health endpoints
curl -s -k https://api.34.14.187.15.nip.io/health/live
# Expected: {"status":"healthy"}

curl -s -k https://api.34.14.187.15.nip.io/health/ready
# Expected: {"status":"ready"}
```

#### 6. Seed WooCommerce Store (Initial Setup Only)
```bash
./infra/scripts/seed-woo.sh
```

#### 7. Inspect Release History & Safe Rollback
```bash
# View release history
helm history urumi -n urumi

# Rollback to revision 1 if necessary
helm rollback urumi 1 -n urumi
```
*Note: Rolling back preserves persistent volume claims and existing database data.*

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
