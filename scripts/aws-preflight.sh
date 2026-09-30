#!/usr/bin/env bash
set -euo pipefail
: "${AWS_PROFILE:?Set an explicit AWS_PROFILE}"
: "${AWS_REGION:?Set an explicit AWS_REGION}"
: "${TARGET_ACCOUNT_ID:?Set TARGET_ACCOUNT_ID}"
if [[ ! "$TARGET_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
  echo 'Invalid target account ID' >&2
  exit 1
fi
current_account="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" --query Account --output text)"
if [[ "$current_account" != "$TARGET_ACCOUNT_ID" ]]; then
  echo 'Current credentials do not match the target account' >&2
  exit 1
fi
printf 'Verified target account %s in %s. No resources changed.\n' "$current_account" "$AWS_REGION"
