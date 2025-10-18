export function initLazyImages() {
  const images = document.querySelectorAll('img[data-src]');
  if (typeof IntersectionObserver === 'undefined') {
    images.forEach(img => {
      if (img.dataset && img.dataset.src) {
        img.src = img.dataset.src;
      }
    });
    return;
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        io.unobserve(img);
      }
    });
  });
  images.forEach(img => io.observe(img));
}

export function observeSection(el, callback) {
  if (!el) return;
  if (typeof IntersectionObserver === 'undefined') {
    if (typeof callback === 'function') {
      callback();
    }
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        callback();
        io.unobserve(entry.target);
      }
    });
  });
  io.observe(el);
}
