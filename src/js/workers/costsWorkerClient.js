import { runCostsComputation } from './costsWorkerShared.js';

const pendingJobs = [];
let activeJob = null;
let workerInstance = null;
let workerFailed = false;

const workerScriptUrl = (() => {
  try {
    const baseUrl = new URL('.', import.meta.url);
    return new URL('workers/costsWorker.js', baseUrl);
  } catch (err) {
    return new URL('./costsWorker.js', import.meta.url);
  }
})();

function ensureWorker() {
  if (workerInstance) {
    return workerInstance;
  }
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers no soportados en este entorno');
  }
  workerInstance = new Worker(workerScriptUrl, { type: 'module' });
  return workerInstance;
}

function normalizeError(err) {
  if (err instanceof Error) {
    return err;
  }
  if (err && typeof err === 'object') {
    if (err.error instanceof Error) {
      return err.error;
    }
    if (typeof err.message === 'string') {
      return new Error(err.message);
    }
    if (typeof err.type === 'string' && err.type !== '') {
      return new Error(`Worker error: ${err.type}`);
    }
  }
  return new Error(String(err ?? 'Worker error'));
}

function finishJob(job, resolver, value) {
  try {
    resolver(value);
  } finally {
    activeJob = null;
    processQueue();
  }
}

function runFallback(job, cause) {
  const normalizedCause = cause ? normalizeError(cause) : null;
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  workerFailed = true;

  try {
    const result = runCostsComputation(job.payload || {});
    if (normalizedCause) {
      console.warn('costsWorker no disponible, usando cálculo local', normalizedCause);
    }
    finishJob(job, job.resolve, result);
  } catch (fallbackError) {
    if (normalizedCause) {
      const combined = new Error(`${normalizedCause.message}; fallback error: ${fallbackError?.message || fallbackError}`);
      combined.cause = { worker: normalizedCause, fallback: fallbackError };
      finishJob(job, job.reject, combined);
    } else {
      finishJob(job, job.reject, normalizeError(fallbackError));
    }
  }
}

function processQueue() {
  if (activeJob || pendingJobs.length === 0) {
    return;
  }

  const job = pendingJobs.shift();

  if (workerFailed) {
    runFallback(job);
    return;
  }

  let worker = null;
  try {
    worker = ensureWorker();
  } catch (err) {
    runFallback(job, err);
    return;
  }

  const cleanup = () => {
    if (worker) {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    }
  };

  const handleMessage = (event) => {
    cleanup();
    finishJob(job, job.resolve, event?.data ?? null);
  };

  const handleError = (event) => {
    cleanup();
    runFallback(job, event);
  };

  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleError);

  activeJob = { reject: job.reject };

  try {
    worker.postMessage(job.payload);
  } catch (err) {
    cleanup();
    runFallback(job, err);
  }
}

function enqueue(payload) {
  return new Promise((resolve, reject) => {
    pendingJobs.push({ payload, resolve, reject });
    processQueue();
  });
}

export function runCostsWorkerTask({ ingredientTree, globalQty }) {
  return enqueue({ ingredientTree, globalQty });
}

export function resetCostsWorker(message = 'costs worker reset') {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }

  workerFailed = false;

  if (activeJob && typeof activeJob.reject === 'function') {
    activeJob.reject(new Error(message));
  }
  activeJob = null;

  while (pendingJobs.length > 0) {
    const job = pendingJobs.shift();
    job.reject(new Error(message));
  }
}
