import './fetchGuard.js';
import apiHealth from './apiHealth.js';

export { apiHealth };

export default async function fetchWithRetry(url, options = {}) {
  const {
    timeout = 8000,
    retries = 3,
    backoff = 300,
    signal,
    ...fetchOptions
  } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);
      apiHealth.recordSuccess();
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      apiHealth.recordFailure();
      if (signal?.aborted || attempt === retries) throw err;
      const delay = backoff * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}
