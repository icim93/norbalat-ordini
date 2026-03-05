(function () {
  function crmPriorityBadge(v) {
    const p = String(v || 'media').toLowerCase();
    if (p === 'alta') return '<span class="badge badge-red">Alta</span>';
    if (p === 'bassa') return '<span class="badge badge-gray">Bassa</span>';
    return '<span class="badge badge-orange">Media</span>';
  }

  function fmtDate(d) {
    if (!d) return '';
    return window.formatDate(String(d).slice(0, 10));
  }

  function renderCrmEventiTable() {
    const body = document.getElementById('crm-eventi-body');
    if (!body) return;
    body.innerHTML = window.state.crmEventi.length ? window.state.crmEventi.map(e => `
      <tr>
        <td>${window.formatDateTime(e.created_at || e.createdAt)}</td>
        <td>${e.tipo || ''}</td>
        <td>${e.esito || ''}</td>
        <td>${e.stato_cliente || '-'} ${e.followup_date ? `<div style="font-size:11px;color:var(--text3);">FU ${fmtDate(e.followup_date)}</div>` : ''} <div style="margin-top:2px;">${crmPriorityBadge(e.priorita)}</div></td>
        <td>${e.richiesta || ''}${e.note ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${e.note}</div>` : ''}</td>
        <td>${e.motivo || ''}</td>
        <td>${e.user_name || ''}</td>
      </tr>
    `).join('') : '<tr><td colspan="7" style="color:var(--text3);">Nessun evento CRM</td></tr>';
  }

  async function loadCrmSummary() {
    try {
      const rows = await window.api('GET', '/api/clienti/crm-summary');
      const map = {};
      (rows || []).forEach(r => { map[r.cliente_id] = r; });
      window.state.crmSummary = map;
    } catch (_) {
      window.state.crmSummary = window.state.crmSummary || {};
    }
  }

  async function openCrmCliente(clienteId) {
    window.state.crmClienteId = clienteId;
    window.state.crmEventi = [];
    const c = window.getCliente(clienteId);
    document.getElementById('crm-cliente-title').textContent = `CRM Cliente — ${c.nome}`;
    ['crm-esito', 'crm-stato-cliente', 'crm-richiesta', 'crm-motivo', 'crm-note'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const fup = document.getElementById('crm-followup-date');
    if (fup) fup.value = '';
    const pr = document.getElementById('crm-priorita');
    if (pr) pr.value = 'media';
    try {
      const rows = await window.api('GET', `/api/clienti/${clienteId}/crm-eventi`);
      window.state.crmEventi = rows || [];
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
    renderCrmEventiTable();
    window.openModal('modal-crm-cliente');
  }

  async function saveCrmEvento() {
    if (!window.state.crmClienteId) return;
    const body = {
      tipo: document.getElementById('crm-tipo').value,
      esito: document.getElementById('crm-esito').value.trim(),
      stato_cliente: document.getElementById('crm-stato-cliente').value.trim(),
      richiesta: document.getElementById('crm-richiesta').value.trim(),
      motivo: document.getElementById('crm-motivo').value.trim(),
      note: document.getElementById('crm-note').value.trim(),
      followup_date: document.getElementById('crm-followup-date').value || null,
      priorita: document.getElementById('crm-priorita').value || 'media',
    };
    if (!body.richiesta && !body.note && !body.motivo && !body.esito && !body.stato_cliente) {
      window.showToast('Inserisci almeno un dettaglio CRM', 'warning');
      return;
    }
    try {
      const saved = await window.api('POST', `/api/clienti/${window.state.crmClienteId}/crm-eventi`, body);
      window.state.crmEventi.unshift(saved);
      await loadCrmSummary();
      renderCrmEventiTable();
      ['crm-esito', 'crm-stato-cliente', 'crm-richiesta', 'crm-motivo', 'crm-note'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const fup = document.getElementById('crm-followup-date');
      if (fup) fup.value = '';
      const pr = document.getElementById('crm-priorita');
      if (pr) pr.value = 'media';
      if (typeof window.renderClientiTable === 'function') window.renderClientiTable();
      window.showToast('Evento CRM salvato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  window.renderCrmEventiTable = renderCrmEventiTable;
  window.loadCrmSummary = loadCrmSummary;
  window.openCrmCliente = openCrmCliente;
  window.saveCrmEvento = saveCrmEvento;
})();
