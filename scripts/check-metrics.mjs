#!/usr/bin/env node
'use strict';

import fetch from 'node-fetch';

function parseArgs(argv) {
  const args = { url: process.env.METRICS_URL || 'http://localhost:3300/metrics', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--url' && argv[i + 1]) {
      args.url = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === '--json') {
      args.json = true;
      continue;
    }
    if (current === '--help' || current === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`check-metrics.mjs

Usage: node scripts/check-metrics.mjs [--url <endpoint>] [--json]

Options:
  --url   Endpoint de métricas (por defecto http://localhost:3300/metrics)
  --json  Imprime el resultado en formato JSON
  --help  Muestra esta ayuda
`);
}

function parseLabels(raw) {
  const labels = {};
  if (!raw) {
    return labels;
  }
  const inner = raw.slice(1, -1);
  if (!inner) {
    return labels;
  }
  const parts = inner.match(/([^=]+="(?:\\"|[^"])*"|[^=]+=[^,]+)(?=,|$)/g) || [];
  for (const part of parts) {
    const [name, valueRaw] = part.split('=');
    if (!name || valueRaw == null) {
      continue;
    }
    const key = name.trim();
    const normalized = valueRaw.trim();
    labels[key] = normalized.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

function parseMetrics(text) {
  const registry = new Map();
  if (typeof text !== 'string') {
    return registry;
  }
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (!match) {
      continue;
    }
    const name = match[1];
    const labels = parseLabels(match[2] || '');
    const value = Number(match[3]);
    if (!registry.has(name)) {
      registry.set(name, []);
    }
    registry.get(name).push({ labels, value });
  }
  return registry;
}

function findMetric(registry, name, matcher = () => true) {
  const entries = registry.get(name);
  if (!entries || !entries.length) {
    return null;
  }
  for (const entry of entries) {
    if (matcher(entry.labels || {})) {
      return entry.value;
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let response;
  try {
    response = await fetch(args.url, {
      headers: { Accept: 'text/plain' },
      timeout: 10_000,
    });
  } catch (err) {
    console.error(`[check-metrics] No se pudo conectar al endpoint ${args.url}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    console.error(`[check-metrics] Respuesta inesperada ${response.status} al consultar ${args.url}`);
    process.exitCode = 1;
    return;
  }

  const body = await response.text();
  const registry = parseMetrics(body);

  const summary = {
    url: args.url,
    generatedAt: new Date().toISOString(),
    apiResponses: findMetric(registry, 'gw2_api_responses_total'),
    jsErrors: findMetric(registry, 'gw2_js_errors_total'),
    redisUp: findMetric(registry, 'gw2_redis_up'),
    redisLatencyMs: findMetric(registry, 'gw2_redis_ping_latency_ms'),
    serviceWorkerHits: findMetric(
      registry,
      'gw2_service_worker_cache_total',
      (labels) => labels.type === 'hit',
    ),
    staleRatio: findMetric(registry, 'gw2_api_responses_stale_ratio'),
  };

  const missing = [];
  if (summary.apiResponses == null) {
    missing.push('gw2_api_responses_total');
  }
  if (summary.jsErrors == null) {
    missing.push('gw2_js_errors_total');
  }
  if (summary.redisUp == null) {
    missing.push('gw2_redis_up');
  }
  if (summary.serviceWorkerHits == null) {
    missing.push('gw2_service_worker_cache_total{type="hit"}');
  }

  if (args.json) {
    console.log(JSON.stringify({ summary, missing }, null, 2));
  } else {
    console.log('Métricas principales:');
    console.log(`  - API responses total: ${summary.apiResponses ?? 'n/d'}`);
    console.log(`  - API stale ratio: ${summary.staleRatio ?? 'n/d'}`);
    console.log(`  - JS errors (ventana): ${summary.jsErrors ?? 'n/d'}`);
    console.log(`  - Redis up: ${summary.redisUp ?? 'n/d'} (latencia ${summary.redisLatencyMs ?? 'n/d'} ms)`);
    console.log(`  - Service worker hits: ${summary.serviceWorkerHits ?? 'n/d'}`);
  }

  if (missing.length) {
    console.error(`[check-metrics] Faltan métricas obligatorias: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[check-metrics] Error inesperado: ${err.message}`);
  process.exitCode = 1;
});
