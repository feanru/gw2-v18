document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'reload') {
        alert('La página se actualizará para aplicar la nueva versión.');
      }
    });
    navigator.serviceWorker
      .register('/service-worker.min.js')
      .then(() => {
        window.cleanApiCache = () =>
          navigator.serviceWorker.controller?.postMessage({ type: 'clean' });
      })
      .catch((err) => console.error('SW registration failed', err));
  }
});
