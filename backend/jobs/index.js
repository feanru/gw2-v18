const http = require('http');
const { MongoClient } = require('mongodb');
const { log } = require('./logger');
const updateItems = require('./updateItems');
const updatePrices = require('./updatePrices');
const updateRecipes = require('./updateRecipes');
const buildRecipeTrees = require('./buildRecipeTrees');
const cleanupSnapshots = require('./cleanupSnapshots');
const { buildSyncHealthPayload } = require('./healthSummary');
const {
  getDashboardSnapshotCached: fetchDashboardSnapshot,
  invalidateDashboardSnapshotCache,
} = require('../api/index.js');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gw2';
const HEALTH_PORT = Number(process.env.HEALTH_PORT || process.env.PORT || 3100);
const HEALTH_HOST = process.env.HEALTH_HOST || '0.0.0.0';
const CACHE_TTL_FAST = Number(process.env.CACHE_TTL_FAST || 120);
const CACHE_TTL_SLOW = Number(process.env.CACHE_TTL_SLOW || 1800);
const RECIPE_TREE_INTERVAL = Number(process.env.RECIPE_TREE_INTERVAL || 3600);
const SNAPSHOT_CLEANUP_INTERVAL = Number(process.env.SNAPSHOT_CLEANUP_INTERVAL || 6 * 3600);
const MIN_INTERVAL_SECONDS = 30;

log('scheduler started');

const scheduledTimeouts = new Set();

function delay(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetries(jobFn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffFactor = 2,
    maxDelayMs = 60000,
    onAttemptStart,
    onAttemptSuccess,
    onAttemptFailure,
  } = options;

  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || 0));
  const factor = Number(backoffFactor) && Number(backoffFactor) > 0 ? Number(backoffFactor) : 2;
  const cappedMaxDelay = Math.max(0, Number(maxDelayMs) || 0);
  const baseDelay = Math.max(0, Number(initialDelayMs) || 0);

  let currentDelay = baseDelay;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (typeof onAttemptStart === 'function') {
      try {
        onAttemptStart(attempt);
      } catch (err) {
        log(`[scheduler] attempt logging error: ${err.message}`);
      }
    }

    try {
      const result = await jobFn();
      if (typeof onAttemptSuccess === 'function') {
        try {
          onAttemptSuccess(attempt, result);
        } catch (err) {
          log(`[scheduler] attempt success logging error: ${err.message}`);
        }
      }
      return result;
    } catch (err) {
      lastError = err;
      if (typeof onAttemptFailure === 'function') {
        try {
          onAttemptFailure(attempt, err);
        } catch (logErr) {
          log(`[scheduler] attempt failure logging error: ${logErr.message}`);
        }
      }

      if (attempt >= attempts) {
        break;
      }

      const delayMs = cappedMaxDelay > 0 ? Math.min(currentDelay, cappedMaxDelay) : currentDelay;
      if (delayMs > 0) {
        await delay(delayMs);
      }

      currentDelay = currentDelay > 0 ? currentDelay * factor : baseDelay * factor || baseDelay || 0;
      if (cappedMaxDelay > 0) {
        currentDelay = Math.min(currentDelay, cappedMaxDelay);
      }
    }
  }

  throw lastError;
}

function ensureIntervalSeconds(value, fallback) {
  const candidate = Number(value);
  if (Number.isFinite(candidate) && candidate > 0) {
    return Math.max(Math.floor(candidate), MIN_INTERVAL_SECONDS);
  }
  const fallbackCandidate = Number(fallback);
  if (Number.isFinite(fallbackCandidate) && fallbackCandidate > 0) {
    return Math.max(Math.floor(fallbackCandidate), MIN_INTERVAL_SECONDS);
  }
  return MIN_INTERVAL_SECONDS;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function computeCollectionInterval(collectionName, baseSeconds) {
  const { snapshot } = (await fetchDashboardSnapshot()) || {};
  if (!snapshot || !snapshot.freshness) {
    return baseSeconds;
  }

  const info = snapshot.freshness[collectionName];
  if (!info) {
    return baseSeconds;
  }

  let multiplier = 1;
  const now = Date.now();
  const lastUpdated = info.lastUpdated ? Date.parse(info.lastUpdated) : NaN;
  if (Number.isFinite(lastUpdated)) {
    const ageSeconds = Math.max(0, (now - lastUpdated) / 1000);
    if (ageSeconds > baseSeconds * 2) {
      multiplier *= 0.5;
    } else if (ageSeconds > baseSeconds * 1.1) {
      multiplier *= 0.8;
    } else if (ageSeconds < baseSeconds * 0.75) {
      multiplier *= 1.2;
    }
  } else {
    multiplier *= 0.85;
  }

  const failures = Number(info.failures24h) || 0;
  if (failures >= 5) {
    multiplier *= 0.4;
  } else if (failures >= 2) {
    multiplier *= 0.7;
  } else if (failures === 0) {
    multiplier *= 1.1;
  }

  if (collectionName === 'prices') {
    const ratio = typeof snapshot.responses?.ratio === 'number' ? snapshot.responses.ratio : null;
    if (ratio !== null) {
      if (ratio > 0.1) {
        multiplier *= 0.6;
      } else if (ratio < 0.02 && failures === 0) {
        multiplier *= 1.2;
      }
    }
    if (Array.isArray(snapshot.alerts) && snapshot.alerts.some((alert) => alert?.type === 'prices-stale')) {
      multiplier *= 0.6;
    }
  }

  const adjusted = ensureIntervalSeconds(baseSeconds * clamp(multiplier, 0.3, 3), baseSeconds);
  return Math.max(adjusted, MIN_INTERVAL_SECONDS);
}

async function computeRecipeTreeInterval(baseSeconds) {
  const { snapshot } = (await fetchDashboardSnapshot()) || {};
  if (!snapshot) {
    return baseSeconds;
  }

  let multiplier = 1;
  const ratio = typeof snapshot.responses?.ratio === 'number' ? snapshot.responses.ratio : null;
  if (ratio !== null) {
    if (ratio > 0.1) {
      multiplier *= 0.5;
    } else if (ratio < 0.02) {
      multiplier *= 1.2;
    }
  }

  const p95 = Number(snapshot.latency?.p95);
  if (Number.isFinite(p95)) {
    if (p95 > 2500) {
      multiplier *= 0.8;
    } else if (p95 < 1200) {
      multiplier *= 1.15;
    }
  }

  const alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts.map((entry) => entry?.type) : [];
  if (alerts.includes('prices-stale')) {
    multiplier *= 0.6;
  }

  const ingestionFailures = Number(snapshot.ingestionFailures?.total24h);
  if (Number.isFinite(ingestionFailures)) {
    if (ingestionFailures > 12) {
      multiplier *= 0.75;
    } else if (ingestionFailures === 0) {
      multiplier *= 1.1;
    }
  }

  const adjusted = ensureIntervalSeconds(baseSeconds * clamp(multiplier, 0.4, 2.5), baseSeconds);
  return Math.max(adjusted, MIN_INTERVAL_SECONDS);
}

const JOB_RETRY_OPTIONS = {
  updateItems: { maxAttempts: 4, initialDelayMs: 1000 },
  updateRecipes: { maxAttempts: 4, initialDelayMs: 1000 },
  updatePrices: { maxAttempts: 5, initialDelayMs: 500 },
  buildRecipeTrees: { maxAttempts: 3, initialDelayMs: 1500 },
  cleanupSnapshots: { maxAttempts: 3, initialDelayMs: 2000 },
};

function scheduleJob(name, intervalSeconds, jobFn, computeIntervalFn, options = {}) {
  const baseSeconds = ensureIntervalSeconds(intervalSeconds, MIN_INTERVAL_SECONDS);
  let timer = null;
  let running = false;

  const retryOptions = {
    ...(JOB_RETRY_OPTIONS[name] || {}),
    ...(options.retry || {}),
  };

  const planNext = async (reason) => {
    let nextSeconds = baseSeconds;
    if (typeof computeIntervalFn === 'function') {
      try {
        const candidate = await computeIntervalFn(baseSeconds);
        if (Number.isFinite(candidate) && candidate > 0) {
          nextSeconds = candidate;
        }
      } catch (err) {
        log(`[scheduler] ${name} interval computation error: ${err.message}`);
      }
    }

    const interval = ensureIntervalSeconds(nextSeconds, baseSeconds);
    if (timer) {
      clearTimeout(timer);
      scheduledTimeouts.delete(timer);
    }
    timer = setTimeout(() => {
      run('interval').catch((err) => log(`[scheduler] ${name} interval error: ${err.message}`));
    }, interval * 1000);
    scheduledTimeouts.add(timer);
    log(`[scheduler] ${name} next run in ${interval}s (${reason})`);
  };

  const run = async (trigger) => {
    if (running) {
      log(`[scheduler] ${name} skipped (${trigger}); previous run still executing`);
      return;
    }
    running = true;
    log(`[scheduler] ${name} triggered (${trigger})`);
    let attemptsUsed = 0;
    try {
      await runWithRetries(jobFn, {
        ...retryOptions,
        onAttemptStart: (attempt) => {
          attemptsUsed = attempt;
          log(`[scheduler] ${name} attempt ${attempt} started (${trigger})`);
        },
        onAttemptSuccess: (attempt) => {
          attemptsUsed = attempt;
          log(`[scheduler] ${name} attempt ${attempt} succeeded (${trigger})`);
        },
        onAttemptFailure: (attempt, err) => {
          attemptsUsed = attempt;
          log(`[scheduler] ${name} attempt ${attempt} failed (${trigger}): ${err.message}`);
        },
      });
      log(`[scheduler] ${name} completed (${trigger}) after ${attemptsUsed} attempt${attemptsUsed === 1 ? '' : 's'}`);
    } catch (err) {
      log(`[scheduler] ${name} failed (${trigger}) after ${attemptsUsed} attempt${attemptsUsed === 1 ? '' : 's'}: ${err.message}`);
    } finally {
      running = false;
      if (typeof computeIntervalFn === 'function') {
        try {
          await invalidateDashboardSnapshotCache();
        } catch (err) {
          log(`[scheduler] failed to invalidate dashboard snapshot cache: ${err.message}`);
        }
      }
      try {
        await planNext('post-run');
      } catch (err) {
        log(`[scheduler] ${name} schedule error: ${err.message}`);
      }
    }
  };

  run('startup').catch((err) => log(`[scheduler] ${name} initial run error: ${err.message}`));
}

scheduleJob('updateItems', CACHE_TTL_SLOW, updateItems, (base) => computeCollectionInterval('items', base), {
  retry: JOB_RETRY_OPTIONS.updateItems,
});
scheduleJob('updateRecipes', CACHE_TTL_SLOW, updateRecipes, (base) => computeCollectionInterval('recipes', base), {
  retry: JOB_RETRY_OPTIONS.updateRecipes,
});
scheduleJob('updatePrices', CACHE_TTL_FAST, updatePrices, (base) => computeCollectionInterval('prices', base), {
  retry: JOB_RETRY_OPTIONS.updatePrices,
});
scheduleJob('buildRecipeTrees', RECIPE_TREE_INTERVAL, buildRecipeTrees, (base) => computeRecipeTreeInterval(base), {
  retry: JOB_RETRY_OPTIONS.buildRecipeTrees,
});
scheduleJob('cleanupSnapshots', SNAPSHOT_CLEANUP_INTERVAL, cleanupSnapshots, undefined, {
  retry: JOB_RETRY_OPTIONS.cleanupSnapshots,
});

const healthClient = new MongoClient(MONGO_URL);
let healthClientPromise = null;

async function getHealthClient() {
  if (!healthClientPromise) {
    healthClientPromise = healthClient.connect().then(() => healthClient).catch(err => {
      log(`[health] failed to connect to MongoDB: ${err.message}`);
      healthClientPromise = null;
      throw err;
    });
  }
  return healthClientPromise;
}

const healthServer = http.createServer(async (req, res) => {
  const { method, url } = req;
  const parsedUrl = new URL(url, 'http://localhost');

  if (method === 'GET' && parsedUrl.pathname === '/health/sync') {
    try {
      const client = await getHealthClient();
      const payload = await buildSyncHealthPayload(client);
      const body = JSON.stringify({ ok: true, data: payload });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(body);
    } catch (err) {
      log(`[health] error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'unable to compute sync status' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

healthServer.listen(HEALTH_PORT, HEALTH_HOST, () => {
  log(`[health] listening on http://${HEALTH_HOST}:${HEALTH_PORT}/health/sync`);
});

async function shutdown() {
  log('scheduler shutting down');
  scheduledTimeouts.forEach((handle) => clearTimeout(handle));
  scheduledTimeouts.clear();
  const closeMongo = healthClientPromise
    ? healthClientPromise
        .then(() => healthClient.close())
        .catch(err => log(`[health] close error: ${err.message}`))
    : Promise.resolve();
  await Promise.allSettled([
    closeMongo,
    new Promise(resolve => healthServer.close(resolve)),
  ]);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
