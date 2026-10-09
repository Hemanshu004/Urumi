#!/usr/bin/env bash
set -e

# Setup script for Urumi local development environment

CLUSTER_NAME="urumi-local"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 Setting up Urumi local environment..."

# 1. Create the Kind cluster if it does not exist
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "✅ Kind cluster '${CLUSTER_NAME}' already exists."
else
  echo "⏳ Creating Kind cluster '${CLUSTER_NAME}'..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${DIR}/kind/cluster-config.yaml"
fi

# 2. Install ingress-nginx
echo "⏳ Installing ingress-nginx..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "⏳ Waiting for ingress-nginx to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s

# 3. Deploy the Helm chart
echo "⏳ Deploying Helm chart..."
helm upgrade --install urumi "${DIR}/helm/urumi" \
  --namespace urumi --create-namespace \
  -f "${DIR}/helm/urumi/values.yaml" \
  -f "${DIR}/helm/urumi/values-local.yaml"

# 4. Wait for MariaDB and WordPress to become ready
echo "⏳ Waiting for MariaDB to be ready..."
kubectl wait --namespace urumi \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=database \
  --timeout=300s

echo "⏳ Waiting for WordPress to be ready..."
kubectl wait --namespace urumi \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=app \
  --timeout=300s

echo ""
echo "🎉 Local environment is ready!"
echo ""
echo "Verify pods:"
echo "  kubectl get pods -n urumi"
echo ""
echo "Verify ingress:"
echo "  kubectl get ingress -n urumi"
echo ""
echo "IMPORTANT: Ensure you have added the following to your /etc/hosts:"
echo "  127.0.0.1 shop.urumi.local"
echo ""
echo "Then access the storefront at: http://shop.urumi.local"
