#!/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_SCRIPT=${DEPLOY_SCRIPT:-"$ROOT/scripts/deploy.sh"}
ROLLBACK_SCRIPT=${ROLLBACK_SCRIPT:-"$ROOT/scripts/rollback.sh"}
RELEASE=""
CANARY_PERCENT=${CANARY_PERCENT:-10}
PROMOTE_PERCENT=${PROMOTE_PERCENT:-100}
CANARY_WAIT=${CANARY_WAIT_SECONDS:-300}
METRICS_URL=${METRICS_URL:-${DEPLOY_METRICS_URL:-"http://localhost:8080/metrics"}}
METRICS_SAMPLES=${METRICS_SAMPLES:-3}
METRICS_SAMPLE_INTERVAL=${METRICS_SAMPLE_INTERVAL:-30}
LATENCY_P50_THRESHOLD=${LATENCY_P50_THRESHOLD:-450}
LATENCY_P95_THRESHOLD=${LATENCY_P95_THRESHOLD:-750}
LATENCY_P99_THRESHOLD=${LATENCY_P99_THRESHOLD:-1100}
STALE_PERCENT_THRESHOLD=${STALE_PERCENT_THRESHOLD:-15}
MIN_NOT_MODIFIED_RATIO=${MIN_NOT_MODIFIED_RATIO:-0.1}
MAX_BYTES_PER_VISIT=${MAX_BYTES_PER_VISIT:-800000}
PROMOTE=${PROMOTE:-1}

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Options:
  -r, --release <sha|tag>   Release identifier (defaults to current git commit)
  -c, --canary <percent>    Canary traffic percentage (default: $CANARY_PERCENT)
  -w, --wait <seconds>      Wait time before sampling metrics (default: $CANARY_WAIT)
  -m, --metrics <url>       Metrics endpoint to evaluate (default: $METRICS_URL)
  -s, --samples <count>     Number of metric samples to evaluate (default: $METRICS_SAMPLES)
  -i, --interval <seconds>  Seconds between metric samples (default: $METRICS_SAMPLE_INTERVAL)
  --dry-run                 Log actions without executing deploy or rollback
  --skip-promote            Run canary and metrics validation only
  -h, --help                Show this help message
USAGE
}

log() {
  printf '[deploy-control] %s\n' "$1"
}

error() {
  printf '[deploy-control][error] %s\n' "$1" >&2
  exit 1
}

require_executable() {
  if [ ! -x "$1" ]; then
    error "Required script '$1' is not executable"
  fi
}

parse_args() {
  local dry_run=0
  while [ $# -gt 0 ]; do
    case "$1" in
      -r|--release)
        shift
        [ $# -gt 0 ] || error "--release requires a value"
        RELEASE="$1"
        ;;
      -c|--canary)
        shift
        [ $# -gt 0 ] || error "--canary requires a value"
        CANARY_PERCENT="$1"
        ;;
      -w|--wait)
        shift
        [ $# -gt 0 ] || error "--wait requires a value"
        CANARY_WAIT="$1"
        ;;
      -m|--metrics)
        shift
        [ $# -gt 0 ] || error "--metrics requires a value"
        METRICS_URL="$1"
        ;;
      -s|--samples)
        shift
        [ $# -gt 0 ] || error "--samples requires a value"
        METRICS_SAMPLES="$1"
        ;;
      -i|--interval)
        shift
        [ $# -gt 0 ] || error "--interval requires a value"
        METRICS_SAMPLE_INTERVAL="$1"
        ;;
      --dry-run)
        dry_run=1
        ;;
      --skip-promote)
        PROMOTE=0
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        error "Unknown argument: $1"
        ;;
    esac
    shift
  done
  DRY_RUN=$dry_run
}

extract_metric() {
  local payload="$1"
  local metric="$2"
  printf '%s\n' "$payload" | awk -v name="$metric" '$1 == name { print $2 }' | tail -n 1
}

compare_le() {
  local value="$1"
  local threshold="$2"
  awk -v value="$value" -v threshold="$threshold" 'BEGIN {
    if (value == "" || threshold == "") exit 1;
    if (value + 0 != value) exit 1;
    if (threshold + 0 != threshold) exit 1;
    exit !(value <= threshold);
  }'
}

compare_ge() {
  local value="$1"
  local threshold="$2"
  awk -v value="$value" -v threshold="$threshold" 'BEGIN {
    if (value == "" || threshold == "") exit 1;
    if (value + 0 != value) exit 1;
    if (threshold + 0 != threshold) exit 1;
    exit !(value >= threshold);
  }'
}

fetch_metrics() {
  if ! command -v curl >/dev/null 2>&1; then
    error "curl is required to fetch metrics"
  fi
  curl -fsSL "$METRICS_URL"
}

validate_metrics_sample() {
  local payload="$1"
  local latency_p50 latency_p95 latency_p99 stale_pct not_modified_ratio bytes_per_visit

  latency_p50=$(extract_metric "$payload" "gw2_api_latency_p50_ms")
  latency_p95=$(extract_metric "$payload" "gw2_api_latency_p95_ms")
  latency_p99=$(extract_metric "$payload" "gw2_api_latency_p99_ms")
  stale_pct=$(extract_metric "$payload" "gw2_api_responses_stale_percentage")
  not_modified_ratio=$(extract_metric "$payload" "gw2_api_responses_not_modified_ratio")
  bytes_per_visit=$(extract_metric "$payload" "gw2_api_bytes_per_visit")

  log "Metrics snapshot: p50=${latency_p50}ms p95=${latency_p95}ms p99=${latency_p99}ms stale=${stale_pct}% 304_ratio=${not_modified_ratio} bytes/visit=${bytes_per_visit}"

  compare_le "$latency_p50" "$LATENCY_P50_THRESHOLD"
  compare_le "$latency_p95" "$LATENCY_P95_THRESHOLD"
  compare_le "$latency_p99" "$LATENCY_P99_THRESHOLD"
  compare_le "$stale_pct" "$STALE_PERCENT_THRESHOLD"
  compare_ge "$not_modified_ratio" "$MIN_NOT_MODIFIED_RATIO"
  compare_le "$bytes_per_visit" "$MAX_BYTES_PER_VISIT"
}

validate_metrics() {
  local sample=1
  while [ $sample -le "$METRICS_SAMPLES" ]; do
    local payload
    if ! payload=$(fetch_metrics); then
      return 1
    fi
    if ! validate_metrics_sample "$payload"; then
      return 1
    fi
    sample=$((sample + 1))
    if [ $sample -le "$METRICS_SAMPLES" ]; then
      sleep "$METRICS_SAMPLE_INTERVAL"
    fi
  done
  return 0
}

run_deploy() {
  local percent="$1"
  local stage="$2"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] Would run $DEPLOY_SCRIPT for release $RELEASE at ${percent}% ($stage)"
    return
  fi
  CANARY_PERCENT="$percent" "$DEPLOY_SCRIPT" "$RELEASE"
}

main() {
  parse_args "$@"

  if [ -z "$RELEASE" ]; then
    RELEASE=$(git -C "$ROOT" rev-parse --short HEAD)
  fi

  require_executable "$DEPLOY_SCRIPT"
  require_executable "$ROLLBACK_SCRIPT"

  log "Starting canary deployment for release $RELEASE at ${CANARY_PERCENT}% traffic"
  run_deploy "$CANARY_PERCENT" "canary"

  if [ "$CANARY_WAIT" -gt 0 ]; then
    log "Waiting ${CANARY_WAIT}s for traffic to stabilize before sampling metrics"
    sleep "$CANARY_WAIT"
  fi

  log "Validating metrics from $METRICS_URL"
  if ! validate_metrics; then
    log "Metric validation failed during canary. Initiating rollback."
    if [ "$DRY_RUN" -eq 0 ]; then
      "$ROLLBACK_SCRIPT"
    fi
    exit 1
  fi

  if [ "$PROMOTE" -eq 0 ]; then
    log "Skipping promotion as requested"
    exit 0
  fi

  log "Metrics healthy. Promoting release $RELEASE to ${PROMOTE_PERCENT}% traffic"
  run_deploy "$PROMOTE_PERCENT" "promote"

  log "Performing post-promotion metrics validation"
  if ! validate_metrics; then
    log "Metric validation failed after promotion. Rolling back."
    if [ "$DRY_RUN" -eq 0 ]; then
      "$ROLLBACK_SCRIPT"
    fi
    exit 1
  fi

  if [ "$DRY_RUN" -eq 0 ]; then
    log "Deployment completed successfully"
  else
    log "[dry-run] Deployment flow completed"
  fi
}

main "$@"
