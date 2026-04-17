#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR" >&2
  exit 1
fi

set -a
source .env
set +a

required_vars=(
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  ASSET_BUCKET_NAME
  ASSET_REGISTRY_PUBLIC_BASE_URL
  BETTER_AUTH_SECRET
  GITHUB_CLIENT_ID
  GITHUB_CLIENT_SECRET
  AUTH_GOOGLE_ID
  AUTH_GOOGLE_SECRET
  OPENAI_API_KEY
  OPENAI_MODEL
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required env var: $var_name" >&2
    exit 1
  fi
done

SERVICE_NAME="${LIGHTSAIL_SERVICE_NAME:-mobisim}"
LIGHTSAIL_REGION="${LIGHTSAIL_REGION:-us-west-2}"
IMAGE_NAME="${LIGHTSAIL_IMAGE_NAME:-mobisim:prod}"
RUNTIME_AWS_REGION="${RUNTIME_AWS_REGION:-${AWS_REGION:-us-west-1}}"

echo "Building ${IMAGE_NAME} for linux/amd64..."
docker buildx build --platform linux/amd64 --load -t "$IMAGE_NAME" .

echo "Pushing image to Lightsail service ${SERVICE_NAME} in ${LIGHTSAIL_REGION}..."
push_output="$(
  aws lightsail push-container-image \
    --region "$LIGHTSAIL_REGION" \
    --service-name "$SERVICE_NAME" \
    --label webapp \
    --image "$IMAGE_NAME"
)"

echo "$push_output"

registered_image="$(printf '%s\n' "$push_output" | sed -n 's/^Refer to this image as "\([^"]*\)".*/\1/p')"

if [[ -z "$registered_image" ]]; then
  echo "Failed to extract registered image reference from Lightsail push output." >&2
  exit 1
fi

echo "Deploying ${registered_image}..."
aws lightsail create-container-service-deployment \
  --region "$LIGHTSAIL_REGION" \
  --service-name "$SERVICE_NAME" \
  --containers "{
    \"app\": {
      \"image\": \"${registered_image}\",
      \"environment\": {
        \"NODE_ENV\": \"production\",
        \"HOST\": \"0.0.0.0\",
        \"PORT\": \"3000\",
        \"AWS_REGION\": \"${RUNTIME_AWS_REGION}\",
        \"AWS_ACCESS_KEY_ID\": \"${AWS_ACCESS_KEY_ID}\",
        \"AWS_SECRET_ACCESS_KEY\": \"${AWS_SECRET_ACCESS_KEY}\",
        \"ASSET_BUCKET_NAME\": \"${ASSET_BUCKET_NAME}\",
        \"ASSET_REGISTRY_PUBLIC_BASE_URL\": \"${ASSET_REGISTRY_PUBLIC_BASE_URL}\",
        \"AUTH_SECRET\": \"${BETTER_AUTH_SECRET}\",
        \"AUTH_TRUST_HOST\": \"true\",
        \"AUTH_GITHUB_ID\": \"${GITHUB_CLIENT_ID}\",
        \"AUTH_GITHUB_SECRET\": \"${GITHUB_CLIENT_SECRET}\",
        \"AUTH_GOOGLE_ID\": \"${AUTH_GOOGLE_ID}\",
        \"AUTH_GOOGLE_SECRET\": \"${AUTH_GOOGLE_SECRET}\",
        \"OPENAI_API_KEY\": \"${OPENAI_API_KEY}\",
        \"OPENAI_MODEL\": \"${OPENAI_MODEL}\"
      },
      \"ports\": {
        \"3000\": \"HTTP\"
      }
    }
  }" \
  --public-endpoint containerName=app,containerPort=3000,healthCheck='{healthyThreshold=2,unhealthyThreshold=3,timeoutSeconds=5,intervalSeconds=30,path=/,successCodes=200-499}'

echo "Submitted deployment for ${registered_image}."
