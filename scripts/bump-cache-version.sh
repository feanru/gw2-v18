#!/bin/bash
set -euo pipefail

FILE="$(dirname "$0")/../service-worker.js"

current=$(grep -oP 'const CACHE_VERSION = \K\d+' "$FILE")
next=$((current + 1))
sed -ri "s/const CACHE_VERSION = $current;/const CACHE_VERSION = $next;/" "$FILE"
echo "CACHE_VERSION bumped to $next"
