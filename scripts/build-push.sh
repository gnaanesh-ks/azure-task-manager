#!/usr/bin/env bash
# Build and push all three service images to Azure Container Registry (ACR).
#
# Usage:
#   ./scripts/build-push.sh <acr_name> <image_tag>
#
# Example:
#   ./scripts/build-push.sh taskmanageracr $(git rev-parse --short HEAD)
#
# Prerequisite: the ACR already exists, e.g.:
#   az acr create --resource-group task-manager-rg --name taskmanageracr --sku Standard

set -euo pipefail

ACR_NAME="${1:?Usage: build-push.sh <acr_name> <tag>}"
TAG="${2:?Usage: build-push.sh <acr_name> <tag>}"

REGISTRY="${ACR_NAME}.azurecr.io"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Logging in to ACR ($REGISTRY) =="
az acr login --name "$ACR_NAME"

build_and_push () {
  local name="$1"
  local context="$2"
  local repo="${REGISTRY}/task-manager/${name}"

  echo "== Building ${name} =="
  docker build -t "${repo}:${TAG}" -t "${repo}:latest" "$context"

  echo "== Pushing ${name} =="
  docker push "${repo}:${TAG}"
  docker push "${repo}:latest"
}

build_and_push "frontend"     "${ROOT_DIR}/frontend"
build_and_push "auth-service" "${ROOT_DIR}/backend/auth-service"
build_and_push "task-service" "${ROOT_DIR}/backend/task-service"

echo "== Done. Update helm/task-manager/values.yaml (or your GitOps repo's values overlay) with tag: ${TAG} =="

# Alternative: skip local docker entirely and let ACR build in the cloud
# (useful in CI agents without a Docker daemon), e.g.:
#   az acr build --registry "$ACR_NAME" --image "task-manager/frontend:${TAG}" "${ROOT_DIR}/frontend"
