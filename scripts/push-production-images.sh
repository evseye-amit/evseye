#!/usr/bin/env bash
set -euo pipefail

PROD_ACCOUNT_ID=735792833529
PROD_REGION=ap-south-2
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${AWS_PROFILE:?Set AWS_PROFILE=evseye-prod-tf before running this script}"

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "Commit or clean the working tree before publishing production images." >&2
  exit 1
fi

ACTUAL_ACCOUNT="$(aws sts get-caller-identity --region "$PROD_REGION" --query Account --output text)"
if [[ "$ACTUAL_ACCOUNT" != "$PROD_ACCOUNT_ID" ]]; then
  echo "AWS profile points to account $ACTUAL_ACCOUNT; expected $PROD_ACCOUNT_ID." >&2
  exit 1
fi

API_REPO="$(terraform -chdir="$REPO_ROOT/infra" output -raw ecr_api_url)"
WEB_REPO="$(terraform -chdir="$REPO_ROOT/infra" output -raw ecr_web_url)"
for REPO in "$API_REPO" "$WEB_REPO"; do
  if [[ "$REPO" != "$PROD_ACCOUNT_ID.dkr.ecr.$PROD_REGION.amazonaws.com/"* ]]; then
    echo "Unexpected ECR repository: $REPO" >&2
    exit 1
  fi
done

IMAGE_TAG="$(git -C "$REPO_ROOT" rev-parse HEAD)"
aws ecr get-login-password --region "$PROD_REGION" | docker login \
  --username AWS --password-stdin "$PROD_ACCOUNT_ID.dkr.ecr.$PROD_REGION.amazonaws.com"

docker buildx build --platform linux/amd64 --file "$REPO_ROOT/apps/api/Dockerfile" \
  --tag "$API_REPO:$IMAGE_TAG" --tag "$API_REPO:latest" --push "$REPO_ROOT"
docker buildx build --platform linux/amd64 --file "$REPO_ROOT/apps/web/Dockerfile" \
  --tag "$WEB_REPO:$IMAGE_TAG" --tag "$WEB_REPO:latest" --push "$REPO_ROOT"

echo "Pushed production API and web images tagged $IMAGE_TAG."
