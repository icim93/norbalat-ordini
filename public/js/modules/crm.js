(function () {
  function renderCrmEventiTable() {
    const body = document.getElementById('crm-eventi-body');
    if (!body) return;
    body.innerHTML = window.state.crmEventi.length ? window.state.crmEventi.map(e => `
      <tr>
        <td>${window.formatDateTime(e.created_at || e.createdAt)}</td>
        <td>${e.tipo || ''}</td>
        <td>${e.esito || ''}</td>
        <td>${e.richiesta || ''}${e.note ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${e.note}</div>` : ''}</td>
        <td>${e.motivo || ''}</td>
        <td>${e.user_name || ''}</td>
      </tr>
    `).join('') : '<tr><td colspan="6" style="color:var(--text3);">Nessun evento CRM</td></tr>';
  }

  async function openCrmCliente(clienteId) {
    window.state.crmClienteId = clienteId;
    window.state.crmEventi = [];
    const c = window.getCliente(clienteId);
    document.getElementById('crm-cliente-title').textContent = `CRM Cliente — ${c.nome}`;
    ['crm-esito', 'crm-richiesta', 'crm-motivo', 'crm-note'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
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
      richiesta: document.getElementById('crm-richiesta').value.trim(),
      motivo: document.getElementById('crm-motivo').value.trim(),
      note: document.getElementById('crm-note').value.trim(),
    };
    if (!body.richiesta && !body.note && !body.motivo) {
      window.showToast('Inserisci almeno un dettaglio CRM', 'warning');
      return;
    }
    try {
      const saved = await window.api('POST', `/api/clienti/${window.state.crmClienteId}/crm-eventi`, body);
      window.state.crmEventi.unshift(saved);
      renderCrmEventiTable();
      ['crm-esito', 'crm-richiesta', 'crm-motivo', 'crm-note'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      window.showToast('Evento CRM salvato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  window.renderCrmEventiTable = renderCrmEventiTable;
  window.openCrmCliente = openCrmCliente;
  window.saveCrmEvento = saveCrmEvento;
})();
