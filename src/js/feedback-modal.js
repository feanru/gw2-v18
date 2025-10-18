// Modal de feedback/contacto

function createFeedbackModal() {
  if (!document.getElementById('open-feedback-modal')) {
    const btn = document.createElement('a');
    btn.href = '#';
    btn.id = 'open-feedback-modal';
    btn.className = 'feedback-float';
    btn.textContent = 'Feedback';
    document.body.appendChild(btn);
  }

  if (!document.getElementById('feedback-modal')) {
    const modal = document.createElement('div');
    modal.id = 'feedback-modal';
    modal.className = 'search-modal hidden';
    modal.innerHTML = `
      <div class="search-modal-backdrop"></div>
      <div class="search-modal-content">
        <button class="close-modal" id="close-feedback-modal">×</button>
        <div class="text-center"><h2>¿Mejoras?¿Bugs?</h2></div>
        <div class="mb-18-0-8-0">
          <p>¿Tienes dudas, sugerencias o comentarios?</p><br>
          <p>Escríbeme por discord <a href="https://discord.gg/rtAEcMys" target="_blank" class="item-link">SERVER RUANERZ</a>
          <br>en el canal general.</p><br>
          <p>Por privado puedes escribirme a Ruanerz#0220 en discord.</p><br>
          <p>También puedes escribirme en mi canal de <a href="https://www.youtube.com/@Ruanerz?sub_confirmation=1" target="_blank" class="item-link">Youtube</a>.</p>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
}

function initFeedbackModal() {
  createFeedbackModal();
  const openBtn = document.getElementById('open-feedback-modal');
  const modal = document.getElementById('feedback-modal');
  const closeBtn = document.getElementById('close-feedback-modal');
  if (!openBtn || !modal || !closeBtn) return;

  const open = function(e) {
    e.preventDefault();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };

  const close = function() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  };

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modal.querySelector('.search-modal-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', function(e) {
    if (!modal.classList.contains('hidden') && e.key === 'Escape') {
      close();
    }
  });
}

document.addEventListener('DOMContentLoaded', initFeedbackModal);
