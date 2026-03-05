function renderClientiTable() {
  const q = (document.getElementById('search-clienti')?.value || '').toLowerCase();
  const filterGiro = document.getElementById('filter-giro')?.value || '';
  let list = state.clienti;
  if (q) list = list.filter(c => c.nome.toLowerCase().includes(q) || c.localita.toLowerCase().includes(q));
  if (filterGiro) list = list.filter(c => c.giro === filterGiro);

  const tbody = document.getElementById('clienti-table');
  tbody.innerHTML = list.map(c => {
    const nOrdini = state.ordini.filter(o => o.clienteId === c.id).length;
    const giroColors = {'bari nord':'badge-blue','murgia':'badge-green','taranto':'badge-orange','lecce':'badge-red','valle itria':'badge-gray','calabria':'badge-gray','foggia':'badge-gray','diretto':'badge-green','':`badge-gray`};
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
    const onboardingLabel = onboardingStatoLabels[c.onboardingStato] || 'In attesa';
    const onboardingBadge = onboardingStatoBadge[c.onboardingStato] || 'badge-gray';
    const fidoTxt = (Number(c.fido || 0)).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const canManageOnboarding = canApproveOnboarding();
    const crm = state.crmSummary?.[c.id];
    const crmFollowup = crm?.followup_date ? formatDate(String(crm.followup_date).slice(0, 10)) : '';
    const crmSoon = crm?.followup_date && String(crm.followup_date).slice(0, 10) <= today();
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="anag-avatar">${c.nome.charAt(0)}</div>
          <div>
            <b style="font-size:13px;">${c.nome}</b>
            ${c.note ? `<div style="font-size:11px;color:var(--blue);margin-top:1px;">📌 ${c.note.substring(0,50)}${c.note.length>50?'…':''}</div>` : ''}
            ${c.classificazione ? `<div style="font-size:10px;color:var(--text3);margin-top:1px;">${c.classificazione === 'Caseificio' ? '🧀' : c.classificazione === 'Alimentari' ? '🏪' : '🔄'} ${c.classificazione}${c.eFornitore?' · 🔁 Fornitore':''}</div>` : (c.eFornitore ? '<div style="font-size:10px;color:var(--text3);margin-top:1px;">🔁 Fornitore</div>' : '')}
            ${crm ? `<div style="font-size:10px;color:${crmSoon ? 'var(--danger)' : 'var(--text3)'};margin-top:2px;">CRM: ${crm.esito || crm.stato_cliente || crm.tipo || 'aggiornato'} ${crmFollowup ? `· FU ${crmFollowup}` : ''}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="color:var(--text2);">${c.localita}</td>
      <td>${c.giro ? `<span class="badge ${giroColors[c.giro]||'badge-gray'}">${c.giro}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
      <td><span style="font-family:'DM Mono',monospace;font-weight:700;">${nOrdini}</span></td>
      <td><span style="font-family:'DM Mono',monospace;">€ ${fidoTxt}</span></td>
      <td><span class="badge ${onboardingBadge}">${onboardingLabel}</span></td>
      <td>
        ${canManageOnboarding ? `<button class="btn btn-outline btn-sm" onclick="setClienteOnboardingStatus(${c.id},'in_verifica')">🔎</button>` : ''}
        ${canManageOnboarding ? `<button class="btn btn-green btn-sm" onclick="approveClienteOnboarding(${c.id})">✅</button>` : ''}
        ${canManageOnboarding ? `<button class="btn btn-danger btn-sm" onclick="setClienteOnboardingStatus(${c.id},'rifiutato')">⛔</button>` : ''}
        ${canManageOnboarding ? `<button class="btn btn-danger btn-sm" onclick="setClienteOnboardingStatus(${c.id},'sospeso')">⏸️</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="openCrmCliente(${c.id})">📇</button>
        <button class="btn btn-outline btn-sm" onclick="openEditCliente(${c.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCliente(${c.id})">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

function openNewCliente() {
  state.editingId = null;
  document.getElementById('modal-cliente-title').textContent = 'Nuovo Cliente';
  document.getElementById('cl-nome').value = '';
  document.getElementById('cl-localita').value = '';
  document.getElementById('cl-giro').value = '';
  document.getElementById('cl-note').value = '';
  document.getElementById('cl-piva').value = '';
  document.getElementById('cl-cf').value = '';
  document.getElementById('cl-codice-univoco').value = '';
  document.getElementById('cl-pec').value = '';
  document.getElementById('cl-classificazione').value = '';
  document.getElementById('cl-condpag').value = '';
  document.getElementById('cl-fido').value = '';
  document.getElementById('cl-efornitore').checked = false;
  populateAgenteSelect('cl-agente', null);
  openModal('modal-cliente');
}

function openEditCliente(id) {
  const c = state.clienti.find(x => x.id === id);
  state.editingId = id;
  document.getElementById('modal-cliente-title').textContent = 'Modifica Cliente';
  document.getElementById('cl-nome').value = c.nome;
  document.getElementById('cl-localita').value = c.localita;
  document.getElementById('cl-giro').value = c.giro;
  document.getElementById('cl-note').value = c.note || '';
  document.getElementById('cl-piva').value = c.piva || '';
  document.getElementById('cl-cf').value = c.codiceFiscale || '';
  document.getElementById('cl-codice-univoco').value = c.codiceUnivoco || '';
  document.getElementById('cl-pec').value = c.pec || '';
  document.getElementById('cl-classificazione').value = c.classificazione || '';
  document.getElementById('cl-condpag').value = c.condPagamento || '';
  document.getElementById('cl-fido').value = c.fido || 0;
  document.getElementById('cl-efornitore').checked = c.eFornitore || false;
  populateAgenteSelect('cl-agente', c.agenteId);
  openModal('modal-cliente');
}

function populateAgenteSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  const agenti = state.utenti.filter(u => u.ruolo === 'autista');
  sel.innerHTML = '<option value="">— Nessuno —</option>' +
    agenti.map(a => `<option value="${a.id}" ${a.id==selectedId?'selected':''}>${(a.nome+' '+(a.cognome||'')).trim()}</option>`).join('');
}

async function lookupClienteByPiva() {
  const pivaEl = document.getElementById('cl-piva');
  const piva = (pivaEl?.value || '').replace(/\s+/g, '').toUpperCase();
  if (!piva) {
    showToast('Inserisci la Partita IVA', 'warning');
    return;
  }
  const btn = document.querySelector('#modal-cliente .btn.btn-outline[onclick=\"lookupClienteByPiva()\"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Ricerca...'; }
  try {
    const r = await api('POST', '/api/clienti/lookup-piva', { piva });
    if (!r?.found) {
      showToast('Nessun dato trovato per questa P.IVA', 'warning');
      return;
    }
    const data = r.data || {};
    const fill = (id, v) => {
      if (!v) return;
      const el = document.getElementById(id);
      if (!el) return;
      if (!el.value || confirm(`Sostituire il campo ${id} con il valore trovato?`)) el.value = v;
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
    if (btn) { btn.disabled = false; btn.textContent = 'Compila da P.IVA'; }
  }
}

async function saveCliente() {
  const nome  = document.getElementById('cl-nome').value.trim();
  if (!nome) { showToast('Inserisci il nome del cliente', 'warning'); return; }
  const body = {
    nome,
    localita:       document.getElementById('cl-localita').value.trim(),
    giro:           document.getElementById('cl-giro').value,
    agente_id:      parseInt(document.getElementById('cl-agente').value)||null,
    note:           document.getElementById('cl-note').value.trim(),
    piva:           document.getElementById('cl-piva').value.trim(),
    codice_fiscale: document.getElementById('cl-cf').value.trim(),
    codice_univoco: document.getElementById('cl-codice-univoco').value.trim(),
    pec:            document.getElementById('cl-pec').value.trim(),
    classificazione: document.getElementById('cl-classificazione').value,
    cond_pagamento: document.getElementById('cl-condpag').value.trim(),
    e_fornitore:    document.getElementById('cl-efornitore').checked,
  };
  try {
    if (state.editingId) {
      await api('PUT', `/api/clienti/${state.editingId}`, body);
      const i2 = state.clienti.findIndex(c => c.id === state.editingId);
      if (i2 !== -1) {
        state.clienti[i2] = normalizeCliente({
          ...state.clienti[i2],
          ...body,
          id: state.editingId,
          agente_id: body.agente_id,
        });
      }
    } else {
      const saved = await api('POST', '/api/clienti', body);
      state.clienti.push(normalizeCliente({...body, ...saved, id: saved.id, agente_id: body.agente_id}));
      state.clienti.sort((a,b) => a.nome.localeCompare(b.nome));
    }
    closeModal('modal-cliente');
    showToast(state.editingId ? 'Cliente aggiornato ✅' : 'Cliente salvato ✅', 'success');
    state.editingId = null;
    renderClientiTable();
  } catch(e) { showToast(e.message, 'warning'); }
}

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
      note: `stato impostato a ${stato}`
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
      note: 'approvazione onboarding'
    });
    applyOnboardingResponse(id, r);
    showToast('Cliente approvato e sbloccato ?', 'success');
    renderClientiTable();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}
async function deleteCliente(id) {
  id = parseInt(id);
  if (!await customConfirm('Eliminare questo cliente?')) return;
  try {
    await api('DELETE', `/api/clienti/${id}`);
    state.clienti = state.clienti.filter(x => x.id !== id);
    showToast('Cliente eliminato');
    renderClientiTable();
  } catch(e) { showToast(e.message, 'warning'); }
}

// ═══════════════════════════════════════════════
// PRODOTTI
// ═══════════════════════════════════════════════






























