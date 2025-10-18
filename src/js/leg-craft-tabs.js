// js/leg-craft-tabs.js
// Handles tab switching for legendary crafting

function switchTab(tabId) {
  document.querySelectorAll('.container-first, .container-third').forEach(tab => {
    tab.style.display = 'none';
  });
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

  const target = document.getElementById(tabId);
  const button = document.querySelector(`.tab-button[data-tab="${tabId}"]`);
  if (target) target.style.display = 'block';
  if (button) button.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  const defaultBtn = document.querySelector('.tab-button.active');
  if (defaultBtn) {
    switchTab(defaultBtn.getAttribute('data-tab'));
  }
});
