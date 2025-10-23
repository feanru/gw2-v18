'use strict';

const os = require('os');

const DEFAULT_SERVICE_WORKER_METRICS_KEY =
  process.env.SW_CACHE_METRICS_KEY || process.env.SERVICE_WORKER_METRICS_KEY || 'telemetry:swCacheMetrics';

function sanitizeMetricName(name) {
  if (!name) {
    return '';
  }
  return String(name)
    .replace(/[^a-zA-Z0-9:_]/g, '_')
    .replace(/^[^a-zA-Z_]+/, '');
}

function sanitizeLabelName(name) {
  if (!name) {
    return '';
  }
  return String(name)
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[^a-zA-Z_]+/, '');
}

function escapeLabelValue(value) {
  if (value == null) {
    return '';
  }
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels) {
  if (!labels || typeof labels !== 'object') {
    return '';
  }
  const parts = [];
  for (const [key, value] of Object.entries(labels)) {
    if (value == null) {
      continue;
    }
    const sanitizedName = sanitizeLabelName(key);
    if (!sanitizedName) {
      continue;
    }
    parts.push(`${sanitizedName}="${escapeLabelValue(value)}"`);
  }
  if (!parts.length) {
    return '';
  }
  return `{${parts.join(',')}}`;
}

function formatMetric(name, value, { help, type, labels } = {}) {
  const metricName = sanitizeMetricName(name);
  if (!metricName) {
    return '';
  }
  const lines = [];
  if (help) {
    lines.push(`# HELP ${metricName} ${String(help).replace(/\n+/g, ' ')}`);
  }
  if (type) {
    lines.push(`# TYPE ${metricName} ${type}`);
  }
  const numericValue = Number.isFinite(value) ? Number(value) : 0;
  lines.push(`${metricName}${formatLabels(labels)} ${numericValue}`);
  return lines.join('\n');
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

async function defaultFetchServiceWorkerMetrics(redis, key) {
  if (!redis || typeof redis.get !== 'function') {
    return null;
  }
  try {
    const raw = await redis.get(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const normalized = {
      hit: Number.isFinite(parsed.hit) ? Number(parsed.hit) : 0,
      miss: Number.isFinite(parsed.miss) ? Number(parsed.miss) : 0,
      stale: Number.isFinite(parsed.stale) ? Number(parsed.stale) : 0,
      lastUpdated: Number.isFinite(parsed.lastUpdated) ? Number(parsed.lastUpdated) : null,
    };
    if (!Number.isFinite(normalized.lastUpdated) && parsed.lastUpdated) {
      const ts = Date.parse(parsed.lastUpdated);
      normalized.lastUpdated = Number.isFinite(ts) ? ts : null;
    }
    return normalized;
  } catch (err) {
    return null;
  }
}

function parseRedisInfo(raw) {
  if (typeof raw !== 'string') {
    return {};
  }
  const result = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

let fetchServiceWorkerMetrics = defaultFetchServiceWorkerMetrics;

function createMetricsHandler({
  buildDashboardSnapshot,
  getRedisClient,
  serviceWorkerMetricsKey = DEFAULT_SERVICE_WORKER_METRICS_KEY,
  now = () => new Date(),
} = {}) {
  if (typeof buildDashboardSnapshot !== 'function') {
    throw new TypeError('metrics: buildDashboardSnapshot must be a function');
  }
  if (typeof getRedisClient !== 'function') {
    throw new TypeError('metrics: getRedisClient must be a function');
  }

  const key = serviceWorkerMetricsKey || DEFAULT_SERVICE_WORKER_METRICS_KEY;

  async function collectRedisMetrics() {
    const redis = await getRedisClient();
    if (!redis) {
      return {
        up: 0,
        latencyMs: null,
        info: {},
        serviceWorker: null,
      };
    }
    let latencyMs = null;
    const start = process.hrtime.bigint();
    try {
      await redis.ping();
      const diff = process.hrtime.bigint() - start;
      latencyMs = Number(diff) / 1e6;
    } catch (err) {
      return {
        up: 0,
        latencyMs: null,
        info: {},
        serviceWorker: null,
      };
    }

    let info = {};
    try {
      const raw = await redis.info();
      info = parseRedisInfo(raw);
    } catch (err) {
      info = {};
    }

    let serviceWorker = null;
    try {
      serviceWorker = await fetchServiceWorkerMetrics(redis, key);
    } catch (err) {
      serviceWorker = null;
    }

    return {
      up: 1,
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
      info,
      serviceWorker,
    };
  }

  async function collectMetrics() {
    const [snapshot, redisMetrics] = await Promise.all([
      buildDashboardSnapshot(),
      collectRedisMetrics(),
    ]);

    const lines = [];
    const generatedAt = now();
    const generatedTs = generatedAt instanceof Date ? generatedAt.getTime() : Date.parse(generatedAt);
    if (Number.isFinite(generatedTs)) {
      lines.push(
        formatMetric('gw2_metrics_generated_at_timestamp', generatedTs / 1000, {
          help: 'Unix timestamp when the metrics payload was generated',
          type: 'gauge',
        }),
      );
    }

    if (snapshot && typeof snapshot === 'object') {
      const responses = snapshot.responses || {};
      if (Number.isFinite(responses.total)) {
        lines.push(
          formatMetric('gw2_api_responses_total', responses.total, {
            help: 'Total API responses recorded in the current dashboard window',
            type: 'gauge',
          }),
        );
      }
      if (Number.isFinite(responses.stale)) {
        lines.push(
          formatMetric('gw2_api_responses_stale', responses.stale, {
            help: 'Total stale API responses in the current dashboard window',
            type: 'gauge',
          }),
        );
      }
      if (Number.isFinite(responses.ratio)) {
        lines.push(
          formatMetric('gw2_api_responses_stale_ratio', responses.ratio, {
            help: 'Ratio of stale responses over the total responses',
            type: 'gauge',
          }),
        );
      }

      const latency = snapshot.latency || {};
      if (Number.isFinite(latency.p95)) {
        lines.push(
          formatMetric('gw2_api_latency_p95_ms', latency.p95, {
            help: 'p95 latency for API responses in milliseconds',
            type: 'gauge',
          }),
        );
      }
      if (Number.isFinite(latency.p99)) {
        lines.push(
          formatMetric('gw2_api_latency_p99_ms', latency.p99, {
            help: 'p99 latency for API responses in milliseconds',
            type: 'gauge',
          }),
        );
      }

      const ttfb = snapshot.ttfb || {};
      if (Number.isFinite(ttfb.p95)) {
        lines.push(
          formatMetric('gw2_api_ttfb_p95_ms', ttfb.p95, {
            help: 'p95 time-to-first-byte in milliseconds',
            type: 'gauge',
          }),
        );
      }
      if (Number.isFinite(ttfb.p99)) {
        lines.push(
          formatMetric('gw2_api_ttfb_p99_ms', ttfb.p99, {
            help: 'p99 time-to-first-byte in milliseconds',
            type: 'gauge',
          }),
        );
      }

      const payloadStats = snapshot.payload || {};
      if (Number.isFinite(payloadStats.p95Bytes)) {
        lines.push(
          formatMetric('gw2_api_payload_p95_bytes', payloadStats.p95Bytes, {
            help: 'p95 response payload size in bytes',
            type: 'gauge',
          }),
        );
      }

      const jsErrors = snapshot.jsErrors || {};
      if (Number.isFinite(jsErrors.count)) {
        lines.push(
          formatMetric('gw2_js_errors_total', jsErrors.count, {
            help: 'Total JavaScript errors observed in the telemetry window',
            type: 'gauge',
          }),
        );
      }
      if (Number.isFinite(jsErrors.perMinute)) {
        lines.push(
          formatMetric('gw2_js_errors_per_minute', jsErrors.perMinute, {
            help: 'Average JavaScript errors per minute during the telemetry window',
            type: 'gauge',
          }),
        );
      }
      if (Number.isFinite(jsErrors.lastErrorAgeMinutes)) {
        lines.push(
          formatMetric('gw2_js_errors_last_age_minutes', jsErrors.lastErrorAgeMinutes, {
            help: 'Minutes since the last JavaScript error was recorded',
            type: 'gauge',
          }),
        );
      }

      const ingestion = snapshot.ingestionFailures || {};
      if (Number.isFinite(ingestion.total24h)) {
        lines.push(
          formatMetric('gw2_ingestion_failures_total_24h', ingestion.total24h, {
            help: 'Total ingestion failures across monitored collections in the last 24h',
            type: 'gauge',
          }),
        );
      }
      if (ingestion.byCollection && typeof ingestion.byCollection === 'object') {
        for (const [collection, value] of Object.entries(ingestion.byCollection)) {
          if (!Number.isFinite(value)) {
            continue;
          }
          lines.push(
            formatMetric('gw2_ingestion_failures_collection_24h', value, {
              help: 'Ingestion failures in the last 24h by collection',
              type: 'gauge',
              labels: { collection },
            }),
          );
        }
      }

      const freshness = snapshot.freshness || {};
      for (const [collection, stats] of Object.entries(freshness)) {
        if (!stats || typeof stats !== 'object') {
          continue;
        }
        if (Number.isFinite(stats.lastUpdatedAgeMinutes)) {
          lines.push(
            formatMetric('gw2_collection_freshness_age_minutes', stats.lastUpdatedAgeMinutes, {
              help: 'Minutes since the collection was last updated',
              type: 'gauge',
              labels: { collection },
            }),
          );
        }
        if (Number.isFinite(stats.count)) {
          lines.push(
            formatMetric('gw2_collection_document_count', stats.count, {
              help: 'Number of documents recorded for the collection',
              type: 'gauge',
              labels: { collection },
            }),
          );
        }
      }

      const mongo = snapshot.mongo || {};
      if (mongo.indexStats && typeof mongo.indexStats === 'object') {
        for (const [collection, stats] of Object.entries(mongo.indexStats)) {
          if (!stats || typeof stats !== 'object') {
            continue;
          }
          if (Number.isFinite(stats.totalIndexSize)) {
            lines.push(
              formatMetric('gw2_mongo_index_size_bytes', stats.totalIndexSize, {
                help: 'Total index size in bytes by collection',
                type: 'gauge',
                labels: { collection },
              }),
            );
          }
          if (Number.isFinite(stats.storageSize)) {
            lines.push(
              formatMetric('gw2_mongo_storage_size_bytes', stats.storageSize, {
                help: 'Total storage size in bytes by collection',
                type: 'gauge',
                labels: { collection },
              }),
            );
          }
          if (Number.isFinite(stats.count)) {
            lines.push(
              formatMetric('gw2_mongo_document_count', stats.count, {
                help: 'Document count by collection in MongoDB',
                type: 'gauge',
                labels: { collection },
              }),
            );
          }
          if (typeof stats.exceeded === 'boolean') {
            lines.push(
              formatMetric('gw2_mongo_index_threshold_exceeded', stats.exceeded ? 1 : 0, {
                help: 'Flag indicating whether the index footprint threshold was exceeded',
                type: 'gauge',
                labels: { collection },
              }),
            );
          }
        }
      }
    }

    lines.push(
      formatMetric('gw2_redis_up', redisMetrics.up ? 1 : 0, {
        help: 'Redis availability status (1 = reachable)',
        type: 'gauge',
      }),
    );
    if (Number.isFinite(redisMetrics.latencyMs)) {
      lines.push(
        formatMetric('gw2_redis_ping_latency_ms', redisMetrics.latencyMs, {
          help: 'Redis ping latency in milliseconds',
          type: 'gauge',
        }),
      );
    }
    const redisInfo = redisMetrics.info || {};
    const usedMemory = Number.parseInt(redisInfo.used_memory, 10);
    if (Number.isFinite(usedMemory)) {
      lines.push(
        formatMetric('gw2_redis_used_memory_bytes', usedMemory, {
          help: 'Redis used memory in bytes',
          type: 'gauge',
        }),
      );
    }
    const connectedClients = Number.parseInt(redisInfo.connected_clients, 10);
    if (Number.isFinite(connectedClients)) {
      lines.push(
        formatMetric('gw2_redis_connected_clients', connectedClients, {
          help: 'Number of connected Redis clients',
          type: 'gauge',
        }),
      );
    }

    if (redisMetrics.serviceWorker) {
      const sw = redisMetrics.serviceWorker;
      const categories = [
        ['hit', sw.hit],
        ['miss', sw.miss],
        ['stale', sw.stale],
      ];
      for (const [type, value] of categories) {
        if (!Number.isFinite(value)) {
          continue;
        }
        lines.push(
          formatMetric('gw2_service_worker_cache_total', value, {
            help: 'Service worker cache operations grouped by result',
            type: 'gauge',
            labels: { type },
          }),
        );
      }
      if (Number.isFinite(sw.lastUpdated)) {
        lines.push(
          formatMetric('gw2_service_worker_cache_last_updated_timestamp', sw.lastUpdated / 1000, {
            help: 'Unix timestamp of the last service worker metrics update',
            type: 'gauge',
          }),
        );
      }
    }

    const loadAvg = os.loadavg();
    if (Array.isArray(loadAvg) && loadAvg.length >= 3) {
      lines.push(
        formatMetric('gw2_system_load_average', loadAvg[0], {
          help: 'System load average over 1 minute',
          type: 'gauge',
          labels: { window: '1m' },
        }),
      );
      lines.push(
        formatMetric('gw2_system_load_average', loadAvg[1], {
          help: 'System load average over 5 minutes',
          type: 'gauge',
          labels: { window: '5m' },
        }),
      );
      lines.push(
        formatMetric('gw2_system_load_average', loadAvg[2], {
          help: 'System load average over 15 minutes',
          type: 'gauge',
          labels: { window: '15m' },
        }),
      );
    }

    return `${lines.filter(Boolean).join('\n')}`;
  }

  return async function handleMetricsRequest(req, res) {
    try {
      const body = await collectMetrics();
      const payload = body.endsWith('\n') ? body : `${body}\n`;
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
    } catch (err) {
      const message = err && err.message ? err.message : 'metrics unavailable';
      const fallback = `# metrics_error ${escapeLabelValue(message)}\n`;
      res.writeHead(503, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Length': Buffer.byteLength(fallback),
      });
      res.end(fallback);
    }
  };
}

function setFetchServiceWorkerMetrics(fn) {
  fetchServiceWorkerMetrics = typeof fn === 'function' ? fn : defaultFetchServiceWorkerMetrics;
}

function resetFetchServiceWorkerMetrics() {
  fetchServiceWorkerMetrics = defaultFetchServiceWorkerMetrics;
}

module.exports = {
  createMetricsHandler,
  __setFetchServiceWorkerMetrics: setFetchServiceWorkerMetrics,
  __resetFetchServiceWorkerMetrics: resetFetchServiceWorkerMetrics,
};
