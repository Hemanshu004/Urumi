#!/usr/bin/env bash
set -euo pipefail

# Build and load custom Urumi Docker images into a local Kind cluster

CLUSTER_NAME="${1:-${KIND_CLUSTER_NAME:-urumi-local}}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${DIR}/.." && pwd)"

# Verify Docker daemon is accessible
if ! docker info >/dev/null 2>&1; then
  echo "❌ ERROR: Docker daemon is not running or not accessible."
  echo "Please start Docker and try again."
  exit 1
fi

# 5 custom application images and their build contexts
SERVICES=(
  "urumi-gateway:latest|${ROOT_DIR}/apps/gateway"
  "urumi-dashboard:latest|${ROOT_DIR}/apps/dashboard"
  "urumi-woo-mcp:latest|${ROOT_DIR}/apps/woo-mcp"
  "urumi-github-mcp:latest|${ROOT_DIR}/apps/github-mcp"
  "urumi-weather-mcp:latest|${ROOT_DIR}/apps/weather-mcp"
)

echo "📦 Building 5 custom Urumi Docker images..."

for item in "${SERVICES[@]}"; do
  IMAGE_TAG="${item%%|*}"
  CONTEXT_DIR="${item##*|}"
  echo "🔨 Building ${IMAGE_TAG} from ${CONTEXT_DIR}..."
  if ! docker build -t "${IMAGE_TAG}" "${CONTEXT_DIR}"; then
    echo "❌ ERROR: Failed to build Docker image '${IMAGE_TAG}'."
    exit 1
  fi
  echo "✅ Built ${IMAGE_TAG}"
done

# If --no-load or --build-only is passed, skip loading into Kind
if [[ "${2:-}" == "--no-load" || "${1:-}" == "--no-load" || "${2:-}" == "--build-only" || "${1:-}" == "--build-only" ]]; then
  echo "⏩ Skipping loading images into Kind (build-only requested)."
  exit 0
fi

# Verify Kind CLI is available
if ! command -v kind >/dev/null 2>&1; then
  echo "❌ ERROR: 'kind' command not found. Cannot load images into Kind cluster."
  exit 1
fi

# Verify Kind cluster exists
if ! kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo "❌ ERROR: Kind cluster '${CLUSTER_NAME}' not found."
  echo "Create the cluster first using: kind create cluster --name ${CLUSTER_NAME}"
  exit 1
fi

echo "📥 Loading images into Kind cluster '${CLUSTER_NAME}'..."
for item in "${SERVICES[@]}"; do
  IMAGE_TAG="${item%%|*}"
  echo "⏳ Loading ${IMAGE_TAG} into Kind cluster '${CLUSTER_NAME}'..."
  if ! kind load docker-image "${IMAGE_TAG}" --name "${CLUSTER_NAME}"; then
    echo "❌ ERROR: Failed to load '${IMAGE_TAG}' into Kind cluster '${CLUSTER_NAME}'."
    exit 1
  fi
  echo "✅ Loaded ${IMAGE_TAG}"
done

echo "🎉 All 5 custom application images built and loaded successfully into '${CLUSTER_NAME}'."
