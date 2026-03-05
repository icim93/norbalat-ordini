function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

// ── Custom confirm (window.confirm è bloccato negli iframe) ──
let _confirmResolve = null;

function customConfirm(message, okLabel = 'Elimina', title = 'Conferma') {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-ok-btn').textContent = okLabel;
    document.getElementById('modal-confirm').classList.add('open');
  });
}

function resolveConfirm(result) {
  document.getElementById('modal-confirm').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

// Modal si chiude SOLO con la X, non cliccando fuori
// (rimosso il listener sull'overlay per evitare chiusure accidentali)

// ═══════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════

function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; toast.style.transition = '0.3s'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

// Set today's date as default
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('ord-data');
  if (dateInput) dateInput.value = today();
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) closeDrawer();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

// ═══════════════════════════════════════════════
// IMPORT EXCEL CLIENTI (SheetJS)
// ═══════════════════════════════════════════════
