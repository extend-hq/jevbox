#!/usr/bin/env bash
set -euo pipefail
: "${AWS_PROFILE:?Set an explicit AWS_PROFILE}"
: "${AWS_REGION:?Set an explicit AWS_REGION}"
: "${TARGET_ACCOUNT_ID:?Set TARGET_ACCOUNT_ID}"
: "${BLOCKED_ACCOUNT_IDS:?Set comma-separated protected account IDs including PROD 1}"
if [[ ! "$TARGET_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
  echo 'Invalid target account ID' >&2
  exit 1
fi
IFS=',' read -r -a blocked_accounts <<< "$BLOCKED_ACCOUNT_IDS"
for blocked_account in "${blocked_accounts[@]}"; do
  if [[ ! "$blocked_account" =~ ^[0-9]{12}$ ]] || [[ "$blocked_account" == "$TARGET_ACCOUNT_ID" ]]; then
    echo 'Protected account check failed' >&2
    exit 1
  fi
done
current_account="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" --query Account --output text)"
if [[ "$current_account" != "$TARGET_ACCOUNT_ID" ]]; then
  echo 'Current credentials do not match the target account' >&2
  exit 1
fi
printf 'Verified isolated target account %s in %s. No resources changed.\n' "$current_account" "$AWS_REGION"
