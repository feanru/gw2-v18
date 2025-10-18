#!/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.."; pwd)
TARGET=/var/www/gw2
RELEASE=${1:-$(git rev-parse --short HEAD)}
KEEP=${KEEP:-3}

mkdir -p "$TARGET/releases/$RELEASE"
cp -a dist/. "$TARGET/releases/$RELEASE/"
ln -sfn "$TARGET/releases/$RELEASE" "$TARGET/current"

cd "$TARGET/releases"
ls -1t | tail -n +$((KEEP+1)) | xargs -r rm -rf

# Purge CDN cache to force revalidation of assets
node "$ROOT/scripts/purge-cdn.js"
