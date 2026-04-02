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

let _responsiveTablesFrame = null;

function refreshResponsiveTables(root = document) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  scope.querySelectorAll('.table-scroll-wrap table').forEach(table => {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th, index) => {
      const explicit = th.getAttribute('data-label');
      if (explicit !== null) return explicit.trim();
      const text = (th.textContent || '').replace(/\s+/g, ' ').trim();
      return text || (index === 0 ? '' : `Colonna ${index + 1}`);
    });

    const wrap = table.closest('.table-scroll-wrap');
    if (wrap) wrap.classList.toggle('mobile-stack-ready', headers.some(Boolean));

    table.querySelectorAll('tbody tr').forEach(row => {
      Array.from(row.children).forEach((cell, index) => {
        if (!(cell instanceof HTMLElement)) return;
        const label = cell.getAttribute('data-label') || headers[index] || '';
        const isCheckboxCell = index === 0 && !!cell.querySelector('input[type="checkbox"]');
        cell.setAttribute('data-label', label);
        cell.classList.toggle('responsive-cell-checkbox', isCheckboxCell);
        cell.classList.toggle('responsive-cell-primary', (!isCheckboxCell && index === 0) || index === 1);
        cell.classList.toggle(
          'responsive-cell-actions',
          index === row.children.length - 1 || !!cell.querySelector('.table-actions') || !!cell.querySelector('.btn')
        );
      });
    });
  });
}

function scheduleResponsiveTablesRefresh(root = document) {
  if (_responsiveTablesFrame) cancelAnimationFrame(_responsiveTablesFrame);
  _responsiveTablesFrame = requestAnimationFrame(() => {
    _responsiveTablesFrame = null;
    refreshResponsiveTables(root);
  });
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

// Set today's date as default
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('ord-data');
  if (dateInput) dateInput.value = typeof getNextBusinessDate === 'function' ? getNextBusinessDate() : today();
  scheduleResponsiveTablesRefresh();

  if (window.MutationObserver && document.body) {
    const observer = new MutationObserver(mutations => {
      const needsRefresh = mutations.some(mutation => mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length));
      if (needsRefresh) scheduleResponsiveTablesRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) closeDrawer();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

window.refreshResponsiveTables = refreshResponsiveTables;
window.scheduleResponsiveTablesRefresh = scheduleResponsiveTablesRefresh;

// ═══════════════════════════════════════════════
// IMPORT EXCEL CLIENTI (SheetJS)
// ═══════════════════════════════════════════════
