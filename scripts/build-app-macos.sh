#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run renderer:build
if [[ "${SPEAKMORE_SKIP_BACKEND_BUILD:-0}" != "1" ]]; then
  npm run build:backend:mac
fi
npm run build:resources:mac

if [[ "${SPEAKMORE_MAC_SIGN:-0}" != "1" ]]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=false
fi

npx electron-builder --config packaging/electron-builder.yml --mac --arm64
npm run verify:app:mac
