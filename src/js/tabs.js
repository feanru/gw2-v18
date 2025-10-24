// Generic tab functionality
// Handles elements with .tab-button and .tab-content

function initTabs() {
  const buttons = document.querySelectorAll('.tab-button[data-tab]');
  const contents = document.querySelectorAll('.tab-content');

  let activeTabId = null;

  const applyState = (tabId) => {
    buttons.forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isActive);
    });
    contents.forEach(content => {
      const isActive = content.id === tabId;
      content.classList.toggle('active', isActive);
      content.style.display = isActive ? '' : 'none';
    });
  };

  function activate(tabId, options = {}) {
    if (!tabId) return;

    const { emit = true, force = false, userInitiated = false, emitOnUnchanged = false } = options;
    const changed = activeTabId !== tabId;

    if (!changed && !force) {
      return;
    }

    activeTabId = tabId;
    applyState(tabId);

    if (emit && (changed || emitOnUnchanged)) {
      document.dispatchEvent(new CustomEvent('tabchange', { detail: { tabId, userInitiated } }));
    }
  }

  // Initialize: hide non-active contents
  let initial = null;
  contents.forEach(content => {
    if (content.classList.contains('active')) {
      initial = content.id;
    } else {
      content.style.display = 'none';
    }
  });

  if (!initial && buttons.length) {
    initial = buttons[0].getAttribute('data-tab');
  }

  if (initial) {
    activate(initial, { emit: false, force: true });
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      activate(tabId, { userInitiated: true });
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTabs);
} else {
  initTabs();
}
