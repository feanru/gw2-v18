// Generic tab functionality
// Handles elements with .tab-button and .tab-content

function initTabs() {
  const buttons = document.querySelectorAll('.tab-button[data-tab]');
  const contents = document.querySelectorAll('.tab-content');

  let currentTabId = null;

  const applyActiveState = (tabId) => {
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

  function activate(tabId, { force = false } = {}) {
    if (!force && tabId === currentTabId) {
      return;
    }
    currentTabId = tabId;
    applyActiveState(tabId);
    document.dispatchEvent(new CustomEvent('tabchange', { detail: { tabId } }));
  }

  // Initialize: hide non-active contents
  let initial = null;
  contents.forEach(content => {
    if (content.classList.contains('active')) {
      initial = content.id;
      currentTabId = content.id;
    } else {
      content.style.display = 'none';
    }
  });
  if (initial) {
    applyActiveState(initial);
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      activate(tabId);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTabs);
} else {
  initTabs();
}
