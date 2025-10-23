#!/usr/bin/env node
import process from 'node:process';
import { MongoClient } from 'mongodb';

function parseArgs(argv) {
  const args = {
    windowHours: 24,
    baselineGapHours: 0,
    mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/gw2',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      // ignore positional args for now
      continue;
    }
    const [key, rawValue] = token.split('=');
    const value = rawValue ?? argv[i + 1];
    switch (key) {
      case '--window-hours':
        if (value != null) {
          args.windowHours = Number.parseFloat(value);
          if (!Number.isFinite(args.windowHours) || args.windowHours <= 0) {
            throw new Error('window-hours must be a positive number');
          }
        }
        if (rawValue == null) {
          i += 1;
        }
        break;
      case '--baseline-gap-hours':
        if (value != null) {
          args.baselineGapHours = Number.parseFloat(value);
          if (!Number.isFinite(args.baselineGapHours) || args.baselineGapHours < 0) {
            throw new Error('baseline-gap-hours must be zero or a positive number');
          }
        }
        if (rawValue == null) {
          i += 1;
        }
        break;
      case '--mongo-url':
        if (value == null) {
          throw new Error('--mongo-url requires a value');
        }
        args.mongoUrl = value;
        if (rawValue == null) {
          i += 1;
        }
        break;
      default:
        // ignore unknown switches to keep script forgiving
        break;
    }
  }

  return args;
}

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index];
}

function summarizeApiMetrics(entries) {
  const byEndpoint = new Map();
  for (const entry of entries) {
    const key = entry?.endpoint ? String(entry.endpoint) : 'unknown';
    if (!byEndpoint.has(key)) {
      byEndpoint.set(key, {
        total: 0,
        errors: 0,
        stale: 0,
        cacheHit: 0,
        cacheMiss: 0,
        durations: [],
      });
    }
    const stats = byEndpoint.get(key);
    stats.total += 1;
    if (entry?.stale) {
      stats.stale += 1;
    }
    const statusCode = Number(entry?.statusCode);
    if (Number.isFinite(statusCode) && statusCode >= 500) {
      stats.errors += 1;
    }
    if (entry?.cacheHit === true) {
      stats.cacheHit += 1;
    }
    if (entry?.cacheMiss === true) {
      stats.cacheMiss += 1;
    }
    const duration = Number(entry?.durationMs);
    if (Number.isFinite(duration) && duration >= 0) {
      stats.durations.push(duration);
    }
  }

  const summary = {};
  for (const [endpoint, stats] of byEndpoint.entries()) {
    const staleRatio = stats.total > 0 ? stats.stale / stats.total : 0;
    const errorRatio = stats.total > 0 ? stats.errors / stats.total : 0;
    const cacheLookups = stats.cacheHit + stats.cacheMiss;
    const cacheHitRatio = cacheLookups > 0 ? stats.cacheHit / cacheLookups : null;
    summary[endpoint] = {
      total: stats.total,
      staleRatio,
      errorRatio,
      cacheHitRatio,
      latencyP95: computePercentile(stats.durations, 0.95),
      latencyP99: computePercentile(stats.durations, 0.99),
    };
  }
  return summary;
}

function summarizeWebVitals(entries) {
  const metricsMap = new Map();
  for (const entry of entries) {
    const key = entry?.metric ? String(entry.metric) : null;
    const value = Number(entry?.value);
    if (!key || !Number.isFinite(value)) {
      continue;
    }
    if (!metricsMap.has(key)) {
      metricsMap.set(key, { values: [], ratings: { good: 0, needsImprovement: 0, poor: 0 } });
    }
    const bucket = metricsMap.get(key);
    bucket.values.push(value);
    const rating = typeof entry?.rating === 'string' ? entry.rating.toLowerCase().replace(/\s+/g, '') : '';
    if (rating === 'good') {
      bucket.ratings.good += 1;
    } else if (rating === 'needsimprovement') {
      bucket.ratings.needsImprovement += 1;
    } else if (rating === 'poor') {
      bucket.ratings.poor += 1;
    }
  }

  const summary = {};
  for (const [metric, bucket] of metricsMap.entries()) {
    const sorted = bucket.values.sort((a, b) => a - b);
    const count = sorted.length;
    const average = count > 0 ? sorted.reduce((acc, value) => acc + value, 0) / count : null;
    summary[metric] = {
      count,
      average,
      p75: computePercentile(sorted, 0.75),
      p95: computePercentile(sorted, 0.95),
      goodPercentage: count > 0 ? (bucket.ratings.good / count) * 100 : null,
    };
  }
  return summary;
}

function formatDelta(current, baseline, { suffix = '', precision = 2 } = {}) {
  if (current == null && baseline == null) {
    return 'n/a';
  }
  if (baseline == null) {
    return `${current?.toFixed?.(precision) ?? current}${suffix}`;
  }
  if (current == null) {
    return `n/a (${baseline?.toFixed?.(precision) ?? baseline}${suffix} baseline)`;
  }
  const delta = current - baseline;
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '→';
  const formattedDelta = `${delta >= 0 ? '+' : ''}${delta.toFixed(precision)}${suffix}`;
  return `${current.toFixed(precision)}${suffix} (${arrow} ${formattedDelta})`;
}

function logEndpointComparison(name, current, baseline) {
  const total = formatDelta(current?.total ?? 0, baseline?.total ?? 0, { precision: 0 });
  const error = formatDelta((current?.errorRatio ?? 0) * 100, (baseline?.errorRatio ?? 0) * 100, {
    suffix: '%',
  });
  const stale = formatDelta((current?.staleRatio ?? 0) * 100, (baseline?.staleRatio ?? 0) * 100, {
    suffix: '%',
  });
  const p95 = formatDelta(current?.latencyP95, baseline?.latencyP95, { suffix: 'ms', precision: 0 });
  const cache = formatDelta((current?.cacheHitRatio ?? 0) * 100, (baseline?.cacheHitRatio ?? 0) * 100, {
    suffix: '%',
  });
  console.log(`• Endpoint ${name}: total ${total}, errores ${error}, stale ${stale}, p95 ${p95}, cache-hit ${cache}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const windowMs = args.windowHours * 60 * 60 * 1000;
  const gapMs = args.baselineGapHours * 60 * 60 * 1000;

  const now = new Date();
  const currentEnd = now;
  const currentStart = new Date(currentEnd.getTime() - windowMs);
  const baselineEnd = new Date(currentStart.getTime() - gapMs);
  const baselineStart = new Date(baselineEnd.getTime() - windowMs);

  const client = new MongoClient(args.mongoUrl, { ignoreUndefined: true });
  await client.connect();
  const db = client.db();

  try {
    const apiMetricsCollection = db.collection('apiMetrics');
    const currentMetrics = await apiMetricsCollection
      .find({ createdAt: { $gte: currentStart, $lt: currentEnd } }, {
        projection: { endpoint: 1, statusCode: 1, stale: 1, cacheHit: 1, cacheMiss: 1, durationMs: 1 },
      })
      .toArray();
    const baselineMetrics = await apiMetricsCollection
      .find({ createdAt: { $gte: baselineStart, $lt: baselineEnd } }, {
        projection: { endpoint: 1, statusCode: 1, stale: 1, cacheHit: 1, cacheMiss: 1, durationMs: 1 },
      })
      .toArray();

    const currentSummary = summarizeApiMetrics(currentMetrics);
    const baselineSummary = summarizeApiMetrics(baselineMetrics);

    const jsErrorsCollection = db.collection('jsErrors');
    const currentJsErrors = await jsErrorsCollection.countDocuments({
      receivedAt: { $gte: currentStart, $lt: currentEnd },
    });
    const baselineJsErrors = await jsErrorsCollection.countDocuments({
      receivedAt: { $gte: baselineStart, $lt: baselineEnd },
    });

    const webVitalsCollection = db.collection('webVitals');
    const currentVitals = await webVitalsCollection
      .find({ createdAt: { $gte: currentStart, $lt: currentEnd } }, { projection: { metric: 1, value: 1, rating: 1 } })
      .toArray();
    const baselineVitals = await webVitalsCollection
      .find({ createdAt: { $gte: baselineStart, $lt: baselineEnd } }, { projection: { metric: 1, value: 1, rating: 1 } })
      .toArray();

    const currentVitalsSummary = summarizeWebVitals(currentVitals);
    const baselineVitalsSummary = summarizeWebVitals(baselineVitals);

    console.log('=== Impact Report ===');
    console.log(`Ventana actual: ${currentStart.toISOString()} → ${currentEnd.toISOString()} (${args.windowHours}h)`);
    console.log(
      `Baseline: ${baselineStart.toISOString()} → ${baselineEnd.toISOString()} (${args.windowHours}h, gap ${args.baselineGapHours}h)`,
    );
    console.log('');

    const endpointNames = new Set([...Object.keys(currentSummary), ...Object.keys(baselineSummary)]);
    if (endpointNames.size === 0) {
      console.log('No se encontraron métricas de endpoints en el periodo seleccionado.');
    } else {
      for (const endpoint of endpointNames) {
        logEndpointComparison(endpoint, currentSummary[endpoint], baselineSummary[endpoint]);
      }
    }

    const jsErrorDelta = currentJsErrors - baselineJsErrors;
    const jsErrorArrow = jsErrorDelta > 0 ? '▲' : jsErrorDelta < 0 ? '▼' : '→';
    console.log('');
    console.log(
      `JS errors: ${currentJsErrors} (${jsErrorArrow} ${jsErrorDelta >= 0 ? '+' : ''}${jsErrorDelta} vs baseline)`,
    );

    if (Object.keys(currentVitalsSummary).length > 0) {
      console.log('');
      console.log('Core Web Vitals:');
      for (const metric of Object.keys(currentVitalsSummary)) {
        const currentStats = currentVitalsSummary[metric];
        const baselineStats = baselineVitalsSummary[metric] || {};
        const p75 = formatDelta(currentStats.p75, baselineStats.p75, { suffix: '', precision: 0 });
        const good = formatDelta(currentStats.goodPercentage, baselineStats.goodPercentage, { suffix: '%', precision: 1 });
        console.log(`• ${metric}: p75 ${p75}, % good ${good}`);
      }
    } else {
      console.log('');
      console.log('No hay muestras de Core Web Vitals en la ventana actual.');
    }

    if (jsErrorDelta > 0) {
      console.log('⚠️ Aumento de errores JS detectado, revisar stack traces recientes en el dashboard.');
    }
    for (const [endpoint, stats] of Object.entries(currentSummary)) {
      const baselineStats = baselineSummary[endpoint] || {};
      if ((stats.errorRatio ?? 0) > (baselineStats.errorRatio ?? 0)) {
        console.log(`⚠️ ${endpoint}: incremento de errores (${(stats.errorRatio * 100).toFixed(2)}% actuales)`);
      }
    }
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error('generate-impact-report failed:', err.message);
  process.exitCode = 1;
});
