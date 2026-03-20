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

  function resetCrmForm(cliente) {
    const fields = {
      'crm-esito': '',
      'crm-stato-cliente': '',
      'crm-richiesta': '',
      'crm-motivo': '',
      'crm-note': '',
      'crm-localita': cliente?.localita || '',
      'crm-contatto-nome': cliente?.contattoNome || cliente?.nome || '',
      'crm-telefono': cliente?.telefono || '',
    };
    Object.entries(fields).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });
    const tipo = document.getElementById('crm-tipo');
    if (tipo) tipo.value = 'richiesta';
    const fup = document.getElementById('crm-followup-date');
    if (fup) fup.value = '';
    const pr = document.getElementById('crm-priorita');
    if (pr) pr.value = 'media';
    const incaricato = document.getElementById('crm-incaricato-user');
    if (incaricato) incaricato.value = '';
  }

  function renderCrmCompilerMeta() {
    const box = document.getElementById('crm-compiler-meta');
    if (!box) return;
    const last = Array.isArray(window.state.crmEventi) && window.state.crmEventi.length ? window.state.crmEventi[0] : null;
    if (!last?.user_name) {
      box.textContent = '';
      return;
    }
    box.textContent = `Compilato da ${last.user_name}${last.created_at ? ` il ${window.formatDateTime(last.created_at)}` : ''}`;
  }

  function populateCrmIncaricati(selectedId) {
    const select = document.getElementById('crm-incaricato-user');
    if (!select) return;
    const users = [...(window.state.utenti || [])]
      .sort((a, b) => String(`${a.nome} ${a.cognome || ''}`).localeCompare(String(`${b.nome} ${b.cognome || ''}`), 'it', { sensitivity: 'base' }));
    select.innerHTML = '<option value="">- Nessuno -</option>' + users
      .map(u => `<option value="${u.id}" ${Number(selectedId) === Number(u.id) ? 'selected' : ''}>${window.escapeHtml(`${u.nome} ${u.cognome || ''}`.trim())} · ${window.escapeHtml(u.ruolo || '')}</option>`)
      .join('');
  }

  function renderCrmEventiTable() {
    const body = document.getElementById('crm-eventi-body');
    if (!body) return;
    body.innerHTML = window.state.crmEventi.length ? window.state.crmEventi.map(e => `
      <tr>
        <td>${window.formatDateTime(e.created_at || e.createdAt)}</td>
        <td>${window.escapeHtml(e.tipo || '')}</td>
        <td>${window.escapeHtml(e.esito || '')}</td>
        <td>${window.escapeHtml(e.stato_cliente || '-')} ${e.followup_date ? `<div style="font-size:11px;color:var(--text3);">FU ${fmtDate(e.followup_date)}</div>` : ''} <div style="margin-top:2px;">${crmPriorityBadge(e.priorita)}</div></td>
        <td>${window.escapeHtml(e.contatto_nome || '')}${e.telefono ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${window.escapeHtml(e.telefono)}</div>` : ''}</td>
        <td>${window.escapeHtml(e.richiesta || '')}${e.note ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${window.escapeHtml(e.note)}</div>` : ''}</td>
        <td>${window.escapeHtml(e.incaricato_user_name || '')}</td>
        <td>${window.escapeHtml(e.user_name || '')}</td>
      </tr>
    `).join('') : '<tr><td colspan="8" style="color:var(--text3);">Nessun evento CRM</td></tr>';
    renderCrmCompilerMeta();
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
    window.state.crmLeadMode = false;
    window.state.crmClienteId = clienteId;
    window.state.crmEventi = [];
    const c = window.getCliente(clienteId);
    document.getElementById('crm-cliente-title').textContent = `CRM Cliente - ${c.nome}`;
    resetCrmForm(c);
    populateCrmIncaricati();
    try {
      const rows = await window.api('GET', `/api/clienti/${clienteId}/crm-eventi`);
      window.state.crmEventi = rows || [];
      const last = window.state.crmEventi[0];
      populateCrmIncaricati(last?.incaricato_user_id || null);
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
    renderCrmEventiTable();
    window.openModal('modal-crm-cliente');
  }

  function openCrmLead() {
    window.state.crmLeadMode = true;
    window.state.crmClienteId = null;
    window.state.crmEventi = [];
    document.getElementById('crm-cliente-title').textContent = 'Nuovo Onboarding';
    resetCrmForm(null);
    populateCrmIncaricati();
    renderCrmEventiTable();
    window.openModal('modal-crm-cliente');
  }

  function buildCrmPayload(inviaMessaggio) {
    return {
      nome: document.getElementById('crm-lead-nome').value.trim(),
      localita: document.getElementById('crm-localita').value.trim(),
      tipo: document.getElementById('crm-tipo').value,
      esito: document.getElementById('crm-esito').value.trim(),
      stato_cliente: document.getElementById('crm-stato-cliente').value.trim(),
      richiesta: document.getElementById('crm-richiesta').value.trim(),
      motivo: document.getElementById('crm-motivo').value.trim(),
      note: document.getElementById('crm-note').value.trim(),
      contatto_nome: document.getElementById('crm-contatto-nome').value.trim(),
      telefono: document.getElementById('crm-telefono').value.trim(),
      incaricato_user_id: parseInt(document.getElementById('crm-incaricato-user').value || '0', 10) || null,
      invia_messaggio: !!inviaMessaggio,
      followup_date: document.getElementById('crm-followup-date').value || null,
      priorita: document.getElementById('crm-priorita').value || 'media',
    };
  }

  async function saveCrmEvento(inviaMessaggio = false) {
    const body = buildCrmPayload(inviaMessaggio);
    if (window.state.crmLeadMode) {
      if (!body.nome) {
        window.showToast('Inserisci il nome del cliente', 'warning');
        return;
      }
      if (!body.telefono) {
        window.showToast('Inserisci il numero di telefono', 'warning');
        return;
      }
    } else if (!window.state.crmClienteId) {
      return;
    }
    if (!body.richiesta && !body.note && !body.motivo && !body.esito && !body.stato_cliente) {
      window.showToast('Inserisci almeno un dettaglio CRM', 'warning');
      return;
    }
    if (inviaMessaggio && !body.incaricato_user_id) {
      window.showToast('Seleziona un incaricato per inviare la notifica', 'warning');
      return;
    }
    try {
      if (window.state.crmLeadMode) {
        const saved = await window.api('POST', '/api/clienti/onboarding-lead', body);
        const cliente = typeof window.normalizeCliente === 'function' ? window.normalizeCliente(saved.cliente) : saved.cliente;
        window.state.clienti.push(cliente);
        window.state.clienti.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' }));
        window.state.crmLeadMode = false;
        window.state.crmClienteId = cliente.id;
        window.state.crmEventi = saved.crm ? [saved.crm] : [];
      } else {
        const saved = await window.api('POST', `/api/clienti/${window.state.crmClienteId}/crm-eventi`, body);
        window.state.crmEventi.unshift(saved);
        const idx = (window.state.clienti || []).findIndex(c => Number(c.id) === Number(window.state.crmClienteId));
        if (idx !== -1) {
          window.state.clienti[idx].contattoNome = body.contatto_nome || window.state.clienti[idx].contattoNome || '';
          window.state.clienti[idx].telefono = body.telefono || window.state.clienti[idx].telefono || '';
        }
      }
      await loadCrmSummary();
      if (typeof window.renderClientiTable === 'function') window.renderClientiTable();
      renderCrmEventiTable();
      const cliente = window.state.crmClienteId ? window.getCliente(window.state.crmClienteId) : null;
      resetCrmForm(cliente);
      window.showToast(inviaMessaggio ? 'CRM salvato e notifica inviata' : 'Evento CRM salvato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  window.renderCrmEventiTable = renderCrmEventiTable;
  window.loadCrmSummary = loadCrmSummary;
  window.openCrmCliente = openCrmCliente;
  window.openCrmLead = openCrmLead;
  window.saveCrmEvento = saveCrmEvento;
})();
