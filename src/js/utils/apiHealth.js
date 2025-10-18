const failureTimestamps = [];
const WINDOW_MS = 60000; // 1 minute
const DOWN_THRESHOLD = 5;

function cleanup() {
  const cutoff = Date.now() - WINDOW_MS;
  while (failureTimestamps.length && failureTimestamps[0] < cutoff) {
    failureTimestamps.shift();
  }
}

function recordFailure() {
  failureTimestamps.push(Date.now());
  cleanup();
  updateIndicator();
}

function recordSuccess() {
  cleanup();
  updateIndicator();
}

function getState() {
  cleanup();
  const fails = failureTimestamps.length;
  if (fails > DOWN_THRESHOLD) return 'down';
  if (fails > 0) return 'slow';
  return 'ok';
}

function getBackoff() {
  const state = getState();
  if (state === 'down') return 5000;
  if (state === 'slow') return 1000;
  return 0;
}

let indicatorEl;
function updateIndicator() {
  if (typeof document === 'undefined') return;
  const state = getState();
  if (!indicatorEl) {
    indicatorEl = document.createElement('div');
    indicatorEl.id = 'api-status-indicator';
    indicatorEl.style.position = 'fixed';
    indicatorEl.style.bottom = '10px';
    indicatorEl.style.right = '10px';
    indicatorEl.style.padding = '4px 8px';
    indicatorEl.style.background = 'rgba(0,0,0,0.7)';
    indicatorEl.style.color = '#fff';
    indicatorEl.style.borderRadius = '4px';
    indicatorEl.style.zIndex = '10000';
    indicatorEl.style.display = 'none';
    document.body.appendChild(indicatorEl);
  }
  if (state === 'ok') {
    indicatorEl.style.display = 'none';
  } else {
    indicatorEl.textContent = state === 'slow' ? 'API lenta' : 'API caída';
    indicatorEl.style.display = 'block';
  }
}

export default {
  recordFailure,
  recordSuccess,
  getState,
  getBackoff
};
