(function () {
  function eur(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function getCliente(id) {
    return window.state.clienti.find(c => c.id === id) || { nome: '?', localita: '', giro: '' };
  }

  function getAgente(id) {
    const u = window.state.utenti.find(x => x.id === id);
    if (!u) return { nome: '?', cognome: '', nomeCompleto: '?' };
    return { ...u, nomeCompleto: (u.nome + ' ' + (u.cognome || '')).trim() };
  }

  function getProdotto(id) {
    return window.state.prodotti.find(p => p.id === id) || { nome: '?', um: '' };
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getNextBusinessDate(fromDate = today()) {
    const base = String(fromDate || today()).slice(0, 10);
    const d = new Date(`${base}T00:00:00`);
    if (Number.isNaN(d.getTime())) return today();
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statoBadge(stato) {
    const map = {
      attesa: ['badge-orange', 'In attesa'],
      preparazione: ['badge-blue', 'In preparazione'],
      consegnato: ['badge-green', 'Consegnato'],
      annullato: ['badge-red', 'Annullato'],
    };
    const [cls, label] = map[stato] || ['badge-gray', stato];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function lineeResume(linee) {
    return linee.map(l => {
      const p = l.prodId ? getProdotto(l.prodId) : null;
      const um = l.unitaMisura || p?.um || 'pz';
      const nome = (l.prodottoNomeLibero || p?.nome || 'Prodotto libero').split(' ').slice(0, 3).join(' ');
      return `${l.qty} ${um} ${nome}`;
    }).join(', ');
  }

  function formatDate(d) {
    if (!d) return '';
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}`;
  }

  function formatDateTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return `${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      return String(ts);
    }
  }

  window.eur = eur;
  window.getCliente = getCliente;
  window.getAgente = getAgente;
  window.getProdotto = getProdotto;
  window.today = today;
  window.getNextBusinessDate = getNextBusinessDate;
  window.escapeHtml = escapeHtml;
  window.statoBadge = statoBadge;
  window.lineeResume = lineeResume;
  window.formatDate = formatDate;
  window.formatDateTime = formatDateTime;
})();
