#!/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARGET=${TARGET_DIR:-/var/www/gw2}
PURGE=${PURGE_CDN:-0}
ROLLBACK_RELEASE=${1:-}

log() {
  printf '[rollback] %s\n' "$1"
}

error() {
  printf '[rollback][error] %s\n' "$1" >&2
  exit 1
}

if [ ! -d "$TARGET/releases" ]; then
  error "Releases directory '$TARGET/releases' not found"
fi

current_link="$TARGET/current"
current_release=""
if [ -L "$current_link" ]; then
  current_release=$(basename "$(readlink "$current_link")")
fi

select_release=""
if [ -n "$ROLLBACK_RELEASE" ]; then
  if [ ! -d "$TARGET/releases/$ROLLBACK_RELEASE" ]; then
    error "Release '$ROLLBACK_RELEASE' not found in $TARGET/releases"
  fi
  select_release="$ROLLBACK_RELEASE"
else
  mapfile -t releases < <(ls -1t "$TARGET/releases")
  if [ ${#releases[@]} -lt 2 ]; then
    error "Not enough releases available to perform rollback"
  fi
  for candidate in "${releases[@]}"; do
    if [ "$candidate" != "$current_release" ]; then
      select_release="$candidate"
      break
    fi
  done
  if [ -z "$select_release" ]; then
    error "Unable to determine previous release"
  fi
fi

log "Switching active release to '$select_release'"
ln -sfn "$TARGET/releases/$select_release" "$current_link"

if [ "$PURGE" != "0" ]; then
  log "Purging CDN cache after rollback"
  node "$ROOT/scripts/purge-cdn.js"
fi

log "Rollback complete"
