#!/usr/bin/env bash
set -e

# Setup script for Urumi local development environment

CLUSTER_NAME="${KIND_CLUSTER_NAME:-urumi-local}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"
CLUSTER_CONFIG="${KIND_CLUSTER_CONFIG:-${DIR}/kind/cluster-config.yaml}"
NAMESPACE="${URUMI_NAMESPACE:-urumi}"
RELEASE_NAME="${URUMI_RELEASE:-urumi}"
VALUES_FILE="${URUMI_VALUES:-${DIR}/helm/urumi/values-local.yaml}"

echo "🚀 Setting up Urumi local environment (Cluster: $CLUSTER_NAME)..."

if [[ "$CLUSTER_NAME" == "urumi-isolated" ]]; then
  if [[ "$NAMESPACE" == "urumi" || "$RELEASE_NAME" == "urumi" ]]; then
    echo "❌ ERROR: Must not use default namespace or release name for isolated cluster."
    exit 1
  fi
fi

# 1. Create the Kind cluster if it does not exist
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "✅ Kind cluster '${CLUSTER_NAME}' already exists."
else
  echo "⏳ Creating Kind cluster '${CLUSTER_NAME}'..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${CLUSTER_CONFIG}"
fi

# Verify context before proceeding
ACTIVE_CONTEXT=$(kubectl config current-context)
if [[ "$ACTIVE_CONTEXT" != "$KUBE_CONTEXT" ]]; then
  echo "❌ ERROR: Active context is $ACTIVE_CONTEXT, but expected $KUBE_CONTEXT."
  echo "Aborting to prevent accidental operations on the wrong cluster."
  exit 1
fi

# 2. Install ingress-nginx
echo "⏳ Installing ingress-nginx..."
kubectl --context "$KUBE_CONTEXT" apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "⏳ Waiting for ingress-nginx to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s

# 3. Build and load custom Docker images
echo "⏳ Building and loading custom Docker images into Kind cluster '${CLUSTER_NAME}'..."
"${DIR}/scripts/build-local-images.sh" "${CLUSTER_NAME}"

# 4. Deploy the Helm chart
echo "⏳ Deploying Helm chart..."
helm upgrade --install "$RELEASE_NAME" "${DIR}/helm/urumi" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$NAMESPACE" --create-namespace \
  -f "${DIR}/helm/urumi/values.yaml" \
  -f "$VALUES_FILE"

# 5. Wait for database and application workloads to become ready
echo "⏳ Waiting for MariaDB to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=database \
  --timeout=300s

echo "⏳ Waiting for WordPress to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=app \
  --timeout=300s

echo "⏳ Waiting for Gateway DB to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=gateway-db \
  --timeout=300s

echo "⏳ Waiting for Gateway to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=gateway \
  --timeout=300s

echo "⏳ Waiting for Dashboard to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app=urumi-dashboard \
  --timeout=300s

echo "⏳ Waiting for WooCommerce MCP to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=woo-mcp \
  --timeout=300s

echo "⏳ Waiting for GitHub MCP to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app=github-mcp \
  --timeout=300s

echo "⏳ Waiting for Weather MCP to be ready..."
kubectl --context "$KUBE_CONTEXT" wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app=weather-mcp \
  --timeout=300s

echo ""
echo "🎉 Local environment is ready!"
echo ""
echo "Verify pods:"
echo "  kubectl --context $KUBE_CONTEXT get pods -n $NAMESPACE"
echo ""
echo "Verify ingress:"
echo "  kubectl --context $KUBE_CONTEXT get ingress -n $NAMESPACE"
echo ""
if [[ "$CLUSTER_NAME" == "urumi-local" ]]; then
  echo "IMPORTANT: Ensure you have added the following to your /etc/hosts:"
  echo "  127.0.0.1 shop.urumi.local api.urumi.local dashboard.urumi.local"
  echo ""
  echo "Next steps:"
  echo "  1. Initialize WooCommerce: ./infra/scripts/seed-woo.sh"
  echo "  2. Access the dashboard:   http://dashboard.urumi.local"
  echo "  3. Access the storefront:  http://shop.urumi.local"
  echo "  4. Access the API gateway: http://api.urumi.local"
else
  echo "Isolated mode deployed successfully. Host limits apply."
fi
