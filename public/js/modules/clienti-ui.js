function resetClientiFilters() {
  const search = document.getElementById('search-clienti');
  const giro = document.getElementById('filter-giro');
  if (search) search.value = '';
  if (giro) giro.value = '';
  renderClientiTable();
}

function getAvailableClientiGiri(extraValues = []) {
  const configured = (state.giriCalendario || []).map(g => String(g.giro || '').trim()).filter(Boolean);
  const usedByClienti = (state.clienti || []).filter(c => typeof isClienteAnagrafico === 'function' ? isClienteAnagrafico(c) : true).map(c => String(c.giro || '').trim()).filter(Boolean);
  const extras = extraValues.map(v => String(v || '').trim()).filter(Boolean);
  return [...new Set([...configured, ...usedByClienti, ...extras])].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

function renderClientiGiroSelects(selectedClienteGiro = '') {
  const selectedFilter = document.getElementById('filter-giro')?.value || '';
  const giri = getAvailableClientiGiri([selectedClienteGiro, selectedFilter]);

  const filterSel = document.getElementById('filter-giro');
  if (filterSel) {
    filterSel.innerHTML = '<option value="">Tutti i giri</option>' +
      giri.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    filterSel.value = giri.includes(selectedFilter) ? selectedFilter : '';
  }

  const clienteSel = document.getElementById('cl-giro');
  if (clienteSel) {
    clienteSel.innerHTML = '<option value="">— Non assegnato —</option>' +
      giri.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    clienteSel.value = giri.includes(selectedClienteGiro) ? selectedClienteGiro : '';
  }
}

function renderClientiStatusStrip(list) {
  const strip = document.getElementById('clienti-status-strip');
  if (!strip) return;
  const pending = list.filter(c => ['bozza', 'in_attesa', 'in_verifica'].includes(c.onboardingStato)).length;
  const sospesi = list.filter(c => c.onboardingStato === 'sospeso').length;
  const dueFollowups = list.filter(c => {
    const crm = state.crmSummary?.[c.id];
    return crm?.followup_date && String(crm.followup_date).slice(0, 10) <= today();
  }).length;
  strip.innerHTML = [
    `<span class="status-pill"><span>Visualizzati</span><strong>${list.length}</strong></span>`,
    pending ? `<span class="status-pill warn"><span>Onboarding aperti</span><strong>${pending}</strong></span>` : '',
    dueFollowups ? `<span class="status-pill alert"><span>Follow-up scaduti</span><strong>${dueFollowups}</strong></span>` : '',
    sospesi ? `<span class="status-pill info"><span>Sospesi</span><strong>${sospesi}</strong></span>` : '',
  ].filter(Boolean).join('');
}

function renderClientiTable() {
  renderClientiGiroSelects();
  const q = (document.getElementById('search-clienti')?.value || '').toLowerCase();
  const filterGiro = document.getElementById('filter-giro')?.value || '';
  let list = state.clienti.filter(c => typeof isClienteAnagrafico === 'function' ? isClienteAnagrafico(c) : !(typeof isTentataVenditaCliente === 'function' && isTentataVenditaCliente(c)));
  if (q) list = list.filter(c =>
    c.nome.toLowerCase().includes(q) ||
    (c.alias || '').toLowerCase().includes(q) ||
    c.localita.toLowerCase().includes(q)
  );
  if (filterGiro) list = list.filter(c => c.giro === filterGiro);
  renderClientiStatusStrip(list);
  if (typeof refreshNavBadges === 'function') refreshNavBadges();

  const tbody = document.getElementById('clienti-table');
  const giroColors = {
    'bari nord': 'badge-blue',
    murgia: 'badge-green',
    taranto: 'badge-orange',
    lecce: 'badge-red',
    'valle itria': 'badge-gray',
    calabria: 'badge-gray',
    foggia: 'badge-gray',
    diretto: 'badge-green',
    '': 'badge-gray',
  };
  const onboardingStatoLabels = {
    bozza: 'Bozza',
    in_attesa: 'In attesa',
    in_verifica: 'In verifica',
    approvato: 'Approvato',
    rifiutato: 'Rifiutato',
    sospeso: 'Sospeso',
  };
  const onboardingStatoBadge = {
    bozza: 'badge-gray',
    in_attesa: 'badge-orange',
    in_verifica: 'badge-blue',
    approvato: 'badge-green',
    rifiutato: 'badge-red',
    sospeso: 'badge-red',
  };
  const canManageOnboarding = canApproveOnboarding();
  const ruolo = state.currentUser?.ruolo;
  const canEditCliente = ['admin', 'amministrazione', 'direzione'].includes(ruolo);
  const canDeleteCliente = ruolo === 'admin';

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">-</div><p>Nessun cliente trovato</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(c => {
    const nOrdini = state.ordini.filter(o => o.clienteId === c.id).length;
    const onboardingLabel = onboardingStatoLabels[c.onboardingStato] || 'In attesa';
    const onboardingBadge = onboardingStatoBadge[c.onboardingStato] || 'badge-gray';
    const fidoTxt = (Number(c.fido || 0)).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const crm = state.crmSummary?.[c.id];
    const crmFollowup = crm?.followup_date ? formatDate(String(crm.followup_date).slice(0, 10)) : '';
    const crmDue = crm?.followup_date && String(crm.followup_date).slice(0, 10) <= today();
    const rowClass = [
      crmDue ? 'table-row-critical' : '',
      c.onboardingStato === 'sospeso' ? 'table-row-warning' : '',
    ].filter(Boolean).join(' ');
    const noteShort = c.note ? escapeHtml(c.note.substring(0, 50)) + (c.note.length > 50 ? '...' : '') : '';
    const tipo = c.classificazione ? escapeHtml(c.classificazione) : '';
    const checklist = c.onboardingChecklist && typeof c.onboardingChecklist === 'object' ? c.onboardingChecklist : {};
    const checklistCount = Object.values(checklist).filter(Boolean).length;
    const progressMap = { bozza: 12, in_attesa: 35, in_verifica: 68, approvato: 100, rifiutato: 100, sospeso: 82 };
    const progress = Math.max(progressMap[c.onboardingStato] || 20, Math.min(100, checklistCount * 25));
    return `
    <tr class="${rowClass}">
      <td>
        <div class="table-main-cell">
          <div class="anag-avatar">${escapeHtml((c.nome || '?').charAt(0).toUpperCase())}</div>
          <div class="table-main-meta">
            <b style="font-size:13px;">${escapeHtml(c.nome)}</b>
            ${c.alias ? `<div class="table-subline">Alias autista: <b>${escapeHtml(c.alias)}</b></div>` : ''}
            ${noteShort ? `<div class="table-subline">Nota: ${noteShort}</div>` : ''}
            <div class="inline-badges">
              ${tipo ? `<span class="badge badge-soft">${tipo}</span>` : ''}
              ${c.eFornitore ? '<span class="badge badge-gray">Fornitore</span>' : ''}
              ${crmDue ? '<span class="badge badge-red">Follow-up urgente</span>' : ''}
            </div>
          </div>
        </div>
      </td>
      <td style="color:var(--text2);">${escapeHtml(c.localita || '-')}</td>
      <td>${c.giro ? `<span class="badge ${giroColors[c.giro] || 'badge-gray'}">${escapeHtml(c.giro)}</span>` : '<span style="color:var(--text3)">-</span>'}</td>
      <td><span style="font-family:'DM Mono',monospace;font-weight:700;">${nOrdini}</span></td>
      <td><span style="font-family:'DM Mono',monospace;">EUR ${fidoTxt}</span></td>
      <td>
        <span class="badge ${onboardingBadge}">${onboardingLabel}</span>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
          <div style="flex:1;max-width:180px;height:7px;border-radius:999px;background:var(--surface2);overflow:hidden;">
            <div style="height:100%;width:${progress}%;background:${c.onboardingStato === 'approvato' ? 'var(--success)' : (c.onboardingStato === 'rifiutato' ? 'var(--danger)' : 'var(--accent)')};border-radius:999px;"></div>
          </div>
          <span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${progress}%</span>
        </div>
        ${c.onboardingContattoTipo ? `<div class="table-subline">Contatto: ${escapeHtml(c.onboardingContattoTipo)}</div>` : ''}
        <div class="table-subline">Fase: ${escapeHtml(onboardingLabel)}${checklistCount ? ` · checklist ${checklistCount}/3` : ''}</div>
        ${crm ? `<div class="table-subline">CRM: ${escapeHtml(crm.esito || crm.stato_cliente || crm.tipo || 'aggiornato')}${crmFollowup ? ` · FU ${crmFollowup}` : ''}</div>` : ''}
      </td>
      <td>
        <div class="table-actions">
          ${canManageOnboarding ? `<button class="btn btn-outline btn-sm" title="Imposta in verifica" aria-label="Imposta in verifica" onclick="setClienteOnboardingStatus(${c.id},'in_verifica')">Verifica</button>` : ''}
          ${canManageOnboarding ? `<button class="btn btn-green btn-sm" title="Approva onboarding" aria-label="Approva onboarding" onclick="approveClienteOnboarding(${c.id})">Approva</button>` : ''}
          ${canManageOnboarding ? `<button class="btn btn-danger btn-sm" title="Rifiuta onboarding" aria-label="Rifiuta onboarding" onclick="setClienteOnboardingStatus(${c.id},'rifiutato')">Rifiuta</button>` : ''}
          ${canManageOnboarding ? `<button class="btn btn-orange btn-sm" title="Sospendi onboarding" aria-label="Sospendi onboarding" onclick="setClienteOnboardingStatus(${c.id},'sospeso')">Sospendi</button>` : ''}
          <button class="btn btn-outline btn-sm" title="Apri CRM cliente" aria-label="Apri CRM cliente" onclick="openCrmCliente(${c.id})">CRM</button>
          ${canEditCliente ? `<button class="btn btn-outline btn-sm" title="Modifica cliente" aria-label="Modifica cliente" onclick="openEditCliente(${c.id})">Mod</button>` : ''}
          ${canDeleteCliente ? `<button class="btn btn-danger btn-sm" title="Elimina cliente" aria-label="Elimina cliente" onclick="deleteCliente(${c.id})">Del</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openNewCliente() {
  state.editingId = null;
  state.crmConvertingId = null;
  renderClientiGiroSelects('');
  document.getElementById('modal-cliente-title').textContent = 'Nuovo Cliente';
  document.getElementById('cl-nome').value = '';
  document.getElementById('cl-alias').value = '';
  document.getElementById('cl-localita').value = '';
  document.getElementById('cl-giro').value = '';
  document.getElementById('cl-note').value = '';
  document.getElementById('cl-piva').value = '';
  document.getElementById('cl-contatto-nome').value = '';
  document.getElementById('cl-telefono').value = '';
  document.getElementById('cl-cf').value = '';
  document.getElementById('cl-codice-univoco').value = '';
  document.getElementById('cl-pec').value = '';
  document.getElementById('cl-classificazione').value = '';
  document.getElementById('cl-condpag').value = '';
  document.getElementById('cl-fido').value = '';
  document.getElementById('cl-efornitore').checked = false;
  populateAgenteSelect('cl-agente', null);
  document.getElementById('cl-autista-libero').value = '';
  openModal('modal-cliente');
}

function openNewOnboarding() {
  if (typeof openCrmLead === 'function') {
    openCrmLead();
  }
}

function openEditCliente(id) {
  const c = state.clienti.find(x => x.id === id);
  state.crmConvertingId = null;
  renderClientiGiroSelects(c?.giro || '');
  state.editingId = id;
  document.getElementById('modal-cliente-title').textContent = 'Modifica Cliente';
  document.getElementById('cl-nome').value = c.nome;
  document.getElementById('cl-alias').value = c.alias || '';
  document.getElementById('cl-localita').value = c.localita;
  document.getElementById('cl-giro').value = c.giro;
  document.getElementById('cl-note').value = c.note || '';
  document.getElementById('cl-piva').value = c.piva || '';
  document.getElementById('cl-contatto-nome').value = c.contattoNome || '';
  document.getElementById('cl-telefono').value = c.telefono || '';
  document.getElementById('cl-cf').value = c.codiceFiscale || '';
  document.getElementById('cl-codice-univoco').value = c.codiceUnivoco || '';
  document.getElementById('cl-pec').value = c.pec || '';
  document.getElementById('cl-classificazione').value = c.classificazione || '';
  document.getElementById('cl-condpag').value = c.condPagamento || '';
  document.getElementById('cl-fido').value = c.fido || 0;
  document.getElementById('cl-efornitore').checked = c.eFornitore || false;
  populateAgenteSelect('cl-agente', c.agenteId);
  document.getElementById('cl-autista-libero').value = c.autistaLibero || '';
  openModal('modal-cliente');
}

function populateAgenteSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  const agenti = state.utenti.filter(u => u.ruolo === 'autista');
  sel.innerHTML = '<option value="">- Nessuno -</option>' +
    agenti.map(a => `<option value="${a.id}" ${a.id == selectedId ? 'selected' : ''}>${(a.nome + ' ' + (a.cognome || '')).trim()}</option>`).join('');
}

async function lookupClienteByPiva() {
  const pivaEl = document.getElementById('cl-piva');
  const piva = (pivaEl?.value || '').replace(/\s+/g, '').toUpperCase();
  if (!piva) {
    showToast('Inserisci la Partita IVA', 'warning');
    return;
  }
  const btn = document.querySelector('#modal-cliente .btn.btn-outline[onclick="lookupClienteByPiva()"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Ricerca...';
  }
  try {
    const r = await api('POST', '/api/clienti/lookup-piva', { piva });
    if (!r?.found) {
      showToast('Nessun dato trovato per questa P.IVA', 'warning');
      return;
    }
    const data = r.data || {};
    const fill = (id, value) => {
      if (!value) return;
      const el = document.getElementById(id);
      if (!el) return;
      if (!el.value || confirm(`Sostituire il campo ${id} con il valore trovato?`)) el.value = value;
    };
    fill('cl-nome', data.nome);
    fill('cl-localita', data.localita);
    fill('cl-piva', data.piva);
    fill('cl-cf', data.codice_fiscale);
    fill('cl-codice-univoco', data.codice_univoco);
    fill('cl-pec', data.pec);
    showToast('Dati da P.IVA caricati', 'success');
  } catch (e) {
    showToast(e.message, 'warning');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Compila da P.IVA';
    }
  }
}

async function saveCliente() {
  const nome = document.getElementById('cl-nome').value.trim();
  if (!nome) {
    showToast('Inserisci il nome del cliente', 'warning');
    return;
  }
  const piva = document.getElementById('cl-piva').value.trim();
  if (!piva) {
    showToast('Inserisci la Partita IVA', 'warning');
    return;
  }
  const body = {
    nome,
    alias: document.getElementById('cl-alias').value.trim(),
    localita: document.getElementById('cl-localita').value.trim(),
    giro: document.getElementById('cl-giro').value,
    agente_id: parseInt(document.getElementById('cl-agente').value) || null,
    autista_libero: document.getElementById('cl-autista-libero').value.trim(),
    note: document.getElementById('cl-note').value.trim(),
    piva,
    contatto_nome: document.getElementById('cl-contatto-nome').value.trim(),
    telefono: document.getElementById('cl-telefono').value.trim(),
    codice_fiscale: document.getElementById('cl-cf').value.trim(),
    codice_univoco: document.getElementById('cl-codice-univoco').value.trim(),
    pec: document.getElementById('cl-pec').value.trim(),
    classificazione: document.getElementById('cl-classificazione').value,
    cond_pagamento: document.getElementById('cl-condpag').value.trim(),
    e_fornitore: document.getElementById('cl-efornitore').checked,
  };
  try {
    if (state.editingId) {
      await api('PUT', `/api/clienti/${state.editingId}`, body);
      const idx = state.clienti.findIndex(c => c.id === state.editingId);
      if (idx !== -1) {
        state.clienti[idx] = normalizeCliente({
          ...state.clienti[idx],
          ...body,
          id: state.editingId,
          agente_id: body.agente_id,
        });
      }
    } else if (state.crmConvertingId) {
      const saved = await api('POST', `/api/clienti/${state.crmConvertingId}/converti-da-crm`, body);
      const idx = state.clienti.findIndex(c => c.id === state.crmConvertingId);
      if (idx !== -1) state.clienti[idx] = normalizeCliente(saved);
      state.clienti.sort((a, b) => a.nome.localeCompare(b.nome));
      if (typeof loadCrmSummary === 'function') await loadCrmSummary();
      showToast('Prospect convertito in cliente', 'success');
    } else {
      const saved = await api('POST', '/api/clienti', body);
      state.clienti.push(normalizeCliente({ ...body, ...saved, id: saved.id, agente_id: body.agente_id }));
      state.clienti.sort((a, b) => a.nome.localeCompare(b.nome));
    }
    closeModal('modal-cliente');
    if (!state.crmConvertingId) showToast(state.editingId ? 'Cliente aggiornato' : 'Cliente salvato', 'success');
    state.editingId = null;
    state.crmConvertingId = null;
    renderClientiTable();
    if (typeof window.renderCrmPage === 'function') window.renderCrmPage();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}

window.openNewOnboarding = openNewOnboarding;

function applyOnboardingResponse(id, r) {
  const idx = state.clienti.findIndex(x => x.id === id);
  if (idx === -1) return;
  state.clienti[idx].fido = Number(r.fido || 0);
  state.clienti[idx].sbloccato = !!r.sbloccato;
  state.clienti[idx].onboardingStato = r.onboarding_stato || 'in_attesa';
  state.clienti[idx].onboardingChecklist = r.onboarding_checklist || {};
  state.clienti[idx].onboardingApprovatoDa = r.onboarding_approvato_da || '';
  state.clienti[idx].onboardingApprovatoAt = r.onboarding_approvato_at || null;
}

async function setClienteOnboardingStatus(id, stato) {
  if (!canApproveOnboarding()) return;
  const c = state.clienti.find(x => x.id === id);
  if (!c) return;
  try {
    const r = await api('PATCH', `/api/clienti/${id}/onboarding`, {
      stato,
      fido: c.fido || 0,
      checklist: c.onboardingChecklist || {},
      note: `stato impostato a ${stato}`,
    });
    applyOnboardingResponse(id, r);
    showToast(`Onboarding aggiornato: ${stato}`, 'success');
    renderClientiTable();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}

async function approveClienteOnboarding(id) {
  if (!canApproveOnboarding()) return;
  const c = state.clienti.find(x => x.id === id);
  if (!c) return;
  const fidoRaw = prompt(`Inserisci il fido per ${c.nome}`, String(c.fido || 0));
  if (fidoRaw === null) return;
  const fido = Number(String(fidoRaw).replace(',', '.'));
  if (!Number.isFinite(fido) || fido < 0) {
    showToast('Fido non valido', 'warning');
    return;
  }
  const checklist = {
    piva_valida: confirm('Checklist: Partita IVA valida?'),
    condizioni_pagamento_definite: confirm('Checklist: Condizioni pagamento definite?'),
    documenti_completi: confirm('Checklist: Documenti onboarding completi?'),
  };
  try {
    const r = await api('PATCH', `/api/clienti/${id}/onboarding`, {
      stato: 'approvato',
      fido,
      checklist,
      note: 'approvazione onboarding',
    });
    applyOnboardingResponse(id, r);
    showToast('Cliente approvato e sbloccato', 'success');
    renderClientiTable();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}

async function deleteCliente(id) {
  id = parseInt(id, 10);
  if (!await customConfirm('Eliminare questo cliente?')) return;
  try {
    await api('DELETE', `/api/clienti/${id}`);
    state.clienti = state.clienti.filter(x => x.id !== id);
    showToast('Cliente eliminato');
    renderClientiTable();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}
