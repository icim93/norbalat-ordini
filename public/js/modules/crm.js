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

  function isProspect(cliente) {
    return typeof window.isCrmProspectCliente === 'function' && window.isCrmProspectCliente(cliente);
  }

  function getProspects() {
    return [...(window.state.clienti || [])]
      .filter(isProspect)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' }));
  }

  function getCrmModalCliente() {
    return window.state.crmClienteId ? window.getCliente(window.state.crmClienteId) : null;
  }

  function resetCrmForm(cliente) {
    const fields = {
      'crm-esito': '',
      'crm-stato-cliente': '',
      'crm-richiesta': '',
      'crm-offerta': '',
      'crm-motivo': '',
      'crm-note': '',
      'crm-localita': cliente?.localita || '',
      'crm-contatto-nome': cliente?.contattoNome || cliente?.nome || '',
      'crm-telefono': cliente?.telefono || '',
      'crm-lead-nome': cliente?.nome || '',
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
    const cliente = getCrmModalCliente();
    const last = Array.isArray(window.state.crmEventi) && window.state.crmEventi.length ? window.state.crmEventi[0] : null;
    const meta = [];
    if (cliente?.createdAt) meta.push(`Aperto il ${window.formatDate(cliente.createdAt)}`);
    if (cliente?.crmConvertitoAt) meta.push(`Convertito il ${window.formatDate(cliente.crmConvertitoAt)}`);
    if (last?.user_name) meta.push(`Ultimo aggiornamento ${last.user_name}${last.created_at ? ` il ${window.formatDateTime(last.created_at)}` : ''}`);
    box.textContent = meta.join(' · ');
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
        <td>${window.escapeHtml(e.richiesta || '')}${e.offerta ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">Offerta: ${window.escapeHtml(e.offerta)}</div>` : ''}${e.note ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">${window.escapeHtml(e.note)}</div>` : ''}</td>
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
    if (typeof window.refreshNavBadges === 'function') window.refreshNavBadges();
  }

  function syncCrmModalHeader() {
    const cliente = getCrmModalCliente();
    const title = document.getElementById('crm-cliente-title');
    const convertBtn = document.getElementById('crm-convert-btn');
    if (title) {
      if (window.state.crmLeadMode) title.textContent = 'Nuovo Prospect CRM';
      else title.textContent = `${isProspect(cliente) ? 'CRM Prospect' : 'CRM Cliente'} - ${cliente?.nome || ''}`.trim();
    }
    if (convertBtn) convertBtn.style.display = (!window.state.crmLeadMode && isProspect(cliente)) ? '' : 'none';
  }

  async function openCrmCliente(clienteId) {
    window.state.crmLeadMode = false;
    window.state.crmClienteId = clienteId;
    window.state.crmEventi = [];
    const c = window.getCliente(clienteId);
    syncCrmModalHeader();
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
    syncCrmModalHeader();
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
      offerta: document.getElementById('crm-offerta').value.trim(),
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
      if (!body.nome) return window.showToast('Inserisci il nome del prospect', 'warning');
      if (!body.telefono) return window.showToast('Inserisci il numero di telefono', 'warning');
    } else if (!window.state.crmClienteId) {
      return;
    }
    if (!body.richiesta && !body.offerta && !body.note && !body.motivo && !body.esito && !body.stato_cliente) {
      return window.showToast('Inserisci almeno un dettaglio CRM', 'warning');
    }
    if (inviaMessaggio && !body.incaricato_user_id) {
      return window.showToast('Seleziona un incaricato per inviare la notifica', 'warning');
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
      syncCrmModalHeader();
      const cliente = getCrmModalCliente();
      resetCrmForm(cliente);
      if (typeof window.renderCrmPage === 'function') window.renderCrmPage();
      window.showToast(inviaMessaggio ? 'CRM salvato e notifica inviata' : 'Evento CRM salvato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  function convertCrmProspectToCliente() {
    const cliente = getCrmModalCliente();
    if (!cliente || !isProspect(cliente)) return;
    window.state.crmConvertingId = cliente.id;
    window.state.editingId = null;
    if (typeof window.renderClientiGiroSelects === 'function') window.renderClientiGiroSelects(cliente.giro || '');
    document.getElementById('modal-cliente-title').textContent = `Anagrafica Cliente da CRM - ${cliente.nome}`;
    document.getElementById('cl-nome').value = cliente.nome || '';
    document.getElementById('cl-alias').value = cliente.alias || '';
    document.getElementById('cl-localita').value = cliente.localita || '';
    document.getElementById('cl-giro').value = cliente.giro || '';
    document.getElementById('cl-note').value = cliente.note || '';
    document.getElementById('cl-piva').value = cliente.piva || '';
    document.getElementById('cl-contatto-nome').value = cliente.contattoNome || '';
    document.getElementById('cl-telefono').value = cliente.telefono || '';
    document.getElementById('cl-cf').value = cliente.codiceFiscale || '';
    document.getElementById('cl-codice-univoco').value = cliente.codiceUnivoco || '';
    document.getElementById('cl-pec').value = cliente.pec || '';
    document.getElementById('cl-classificazione').value = cliente.classificazione || '';
    document.getElementById('cl-condpag').value = cliente.condPagamento || '';
    document.getElementById('cl-fido').value = cliente.fido || 0;
    document.getElementById('cl-efornitore').checked = cliente.eFornitore || false;
    if (typeof window.populateAgenteSelect === 'function') window.populateAgenteSelect('cl-agente', cliente.agenteId);
    window.closeModal('modal-crm-cliente');
    window.openModal('modal-cliente');
  }

  function renderCrmStatusStrip(list) {
    const strip = document.getElementById('crm-status-strip');
    if (!strip) return;
    const today = typeof window.today === 'function' ? window.today() : '';
    const followup = list.filter(c => {
      const crm = window.state.crmSummary?.[c.id];
      return crm?.followup_date && String(crm.followup_date).slice(0, 10) <= today;
    }).length;
    const caldi = list.filter(c => {
      const crm = window.state.crmSummary?.[c.id];
      return String(crm?.stato_cliente || '').toLowerCase().includes('caldo');
    }).length;
    strip.innerHTML = [
      `<span class="status-pill"><span>Prospect</span><strong>${list.length}</strong></span>`,
      followup ? `<span class="status-pill alert"><span>Follow-up da fare</span><strong>${followup}</strong></span>` : '',
      caldi ? `<span class="status-pill warn"><span>Lead caldi</span><strong>${caldi}</strong></span>` : '',
    ].filter(Boolean).join('');
  }

  function renderCrmPage() {
    const tbody = document.getElementById('crm-prospect-table');
    if (!tbody) return;
    const q = String(document.getElementById('search-crm')?.value || '').trim().toLowerCase();
    let list = getProspects();
    if (q) {
      list = list.filter(c => {
        const crm = window.state.crmSummary?.[c.id] || {};
        return [
          c.nome, c.localita, c.contattoNome, c.telefono,
          crm.esito, crm.stato_cliente, crm.tipo,
        ].some(v => String(v || '').toLowerCase().includes(q));
      });
    }
    renderCrmStatusStrip(list);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">-</div><p>Nessun prospect CRM</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = list.map(c => {
      const crm = window.state.crmSummary?.[c.id];
      const crmText = [crm?.richiesta, crm?.offerta].filter(Boolean).join(' · ');
      const due = crm?.followup_date && String(crm.followup_date).slice(0, 10) <= window.today();
      return `
        <tr class="${due ? 'table-row-critical' : ''}">
          <td>
            <div class="table-main-cell">
              <div class="anag-avatar">${window.escapeHtml((c.nome || '?').charAt(0).toUpperCase())}</div>
              <div class="table-main-meta">
                <b style="font-size:13px;">${window.escapeHtml(c.nome || '')}</b>
                <div class="table-subline">Aperto il ${c.createdAt ? window.formatDate(c.createdAt) : '-'}</div>
                <div class="inline-badges">
                  <span class="badge badge-blue">Prospect</span>
                  ${crm?.stato_cliente ? `<span class="badge badge-soft">${window.escapeHtml(crm.stato_cliente)}</span>` : ''}
                </div>
              </div>
            </div>
          </td>
          <td>${window.escapeHtml(c.contattoNome || '-')}${c.telefono ? `<div class="table-subline">${window.escapeHtml(c.telefono)}</div>` : ''}${c.localita ? `<div class="table-subline">${window.escapeHtml(c.localita)}</div>` : ''}</td>
          <td>${crm?.created_at ? window.formatDateTime(crm.created_at) : '<span style="color:var(--text3)">-</span>'}</td>
          <td>${crmText ? window.escapeHtml(crmText) : '<span style="color:var(--text3)">Nessun dettaglio</span>'}</td>
          <td>${crm?.followup_date ? `<span class="badge ${due ? 'badge-red' : 'badge-orange'}">${window.escapeHtml(fmtDate(crm.followup_date))}</span>` : '<span style="color:var(--text3)">-</span>'}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-outline btn-sm" onclick="openCrmCliente(${c.id})">Apri</button>
              <button class="btn btn-green btn-sm" onclick="openCrmCliente(${c.id});setTimeout(() => convertCrmProspectToCliente(), 60)">Converti</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.renderCrmEventiTable = renderCrmEventiTable;
  window.loadCrmSummary = loadCrmSummary;
  window.openCrmCliente = openCrmCliente;
  window.openCrmLead = openCrmLead;
  window.saveCrmEvento = saveCrmEvento;
  window.renderCrmPage = renderCrmPage;
  window.convertCrmProspectToCliente = convertCrmProspectToCliente;
})();
