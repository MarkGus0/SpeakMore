#!/usr/bin/env bash
set -euo pipefail

has_signing_identity=false
if [[ -n "${CSC_LINK:-}" || -n "${CSC_NAME:-}" ]]; then
  has_signing_identity=true
fi

has_notary_credentials=false
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  has_notary_credentials=true
fi
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  has_notary_credentials=true
fi
if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  has_notary_credentials=true
fi

if [[ "$has_signing_identity" != "true" ]]; then
  echo "缺少 macOS Developer ID 签名配置，请设置 CSC_LINK 或 CSC_NAME" >&2
  exit 1
fi

if [[ "$has_notary_credentials" != "true" ]]; then
  echo "缺少 Apple notarization 凭证，请设置 APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER，或 APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID，或 APPLE_KEYCHAIN_PROFILE" >&2
  exit 1
fi

export SPEAKMORE_MAC_SIGN=1
npm run build:app:mac
