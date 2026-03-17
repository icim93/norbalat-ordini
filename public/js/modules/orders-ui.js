function renderDashboard() {
  const t = today();
  const ordiniOggi = state.ordini.filter(o => o.data === t);
  const attesa = state.ordini.filter(o => o.stato === 'attesa').length;
  const consegnati = state.ordini.filter(o => o.stato === 'consegnato').length;
  const preparare = state.ordini.filter(o => o.stato === 'preparazione').length;

  document.getElementById('stat-oggi').textContent = ordiniOggi.length;
  document.getElementById('stat-attesa').textContent = attesa;
  document.getElementById('stat-consegnati').textContent = consegnati;
  document.getElementById('stat-preparare').textContent = preparare;

  const d = new Date();
  document.getElementById('dash-date').textContent = d.toLocaleDateString('it-IT', {weekday:'long', year:'numeric', month:'long', day:'numeric'});

  const tbody = document.getElementById('dash-orders-table');
  const recent = [...state.ordini].sort((a,b) => b.id-a.id).slice(0,8);
  tbody.innerHTML = recent.map(o => `
    <tr>
      <td><span style="font-family:'DM Mono',monospace;font-weight:600;">#${o.id}</span></td>
      <td><b>${getCliente(o.clienteId).nome}</b></td>
      <td style="color:var(--text2);">${formatDate(o.data)}</td>
      <td>
        <div style="font-size:13px;">${(() => { const u = state.utenti.find(x => x.id === o.insertedBy); return u ? (u.nome + ' ' + (u.cognome||'')).trim() : '-'; })()}</div>
        ${o.agenteId ? `<div style="font-size:11px;color:var(--text2);">Agente: ${getAgente(o.agenteId).nome}</div>` : ''}
      </td>
      <td>${statoBadge(o.stato)}</td>
      <td>
        <button class="btn btn-outline btn-sm" title="Modifica ordine" aria-label="Modifica ordine" onclick="openEditOrder(${o.id})">Mod</button>
        <button class="btn btn-outline btn-sm" title="Apri dettaglio ordine" aria-label="Apri dettaglio ordine" onclick="openDettaglio(${o.id})">Dett</button>
        <button class="btn btn-outline btn-sm" title="Vai alla preparazione" aria-label="Vai alla preparazione" onclick="openPreparazioneOrdine(${o.id})">Prep</button>
      </td>
    </tr>
  `).join('');
  if (typeof renderGiacenzeAlerts === 'function') renderGiacenzeAlerts();
}

function renderDashboard() {
  const ruolo = state.currentUser?.ruolo || 'admin';
  const t = today();
  const userId = state.currentUser?.id;
  const ordiniOggi = state.ordini.filter(o => o.data === t);
  const assegnatiAutista = ordiniOggi.filter(o => o.autistaDiGiro === userId && o.stato !== 'annullato');
  const attesa = state.ordini.filter(o => o.stato === 'attesa').length;
  const consegnati = state.ordini.filter(o => o.stato === 'consegnato').length;
  const preparare = state.ordini.filter(o => o.stato === 'preparazione').length;
  const alertSottoSoglia = state.giacenzeAlerts?.sotto_soglia?.length || 0;
  const alertScadenze = state.giacenzeAlerts?.in_scadenza?.length || 0;
  const caricoTentata = state.carichiTentataVendita.find(c => c.userId === userId);
  const clienteFollowup = Object.values(state.crmSummary || {}).filter(c => c?.followup_date && String(c.followup_date).slice(0, 10) <= t).length;

  const statLabels = {
    admin: ['Ordini oggi', 'In attesa', 'Consegnati', 'Da preparare'],
    amministrazione: ['Ordini oggi', 'Clienti da seguire', 'Consegnati', 'Da verificare'],
    magazzino: ['Ordini oggi', 'Da preparare', 'Sotto soglia', 'In scadenza'],
    autista: ['Consegne oggi', 'Consegnati', 'Tentata carico', 'Da consegnare'],
    direzione: ['Ordini oggi', 'In attesa', 'Sotto soglia', 'In scadenza'],
  }[ruolo] || ['Ordini oggi', 'In attesa', 'Consegnati', 'Da preparare'];

  const statValues = {
    admin: [ordiniOggi.length, attesa, consegnati, preparare],
    amministrazione: [ordiniOggi.length, clienteFollowup, consegnati, attesa],
    magazzino: [ordiniOggi.length, preparare, alertSottoSoglia, alertScadenze],
    autista: [assegnatiAutista.length, assegnatiAutista.filter(o => o.stato === 'consegnato').length, (caricoTentata?.linee || []).length, assegnatiAutista.filter(o => o.stato !== 'consegnato').length],
    direzione: [ordiniOggi.length, attesa, alertSottoSoglia, alertScadenze],
  }[ruolo] || [ordiniOggi.length, attesa, consegnati, preparare];

  const statValueEls = [
    document.getElementById('stat-oggi'),
    document.getElementById('stat-attesa'),
    document.getElementById('stat-consegnati'),
    document.getElementById('stat-preparare'),
  ];
  ['1', '2', '3', '4'].forEach((idx, i) => {
    const labelEl = document.getElementById(`stat-label-${idx}`);
    if (labelEl) labelEl.textContent = statLabels[i];
    if (statValueEls[i]) statValueEls[i].textContent = statValues[i];
  });

  const d = new Date();
  document.getElementById('dash-date').textContent = d.toLocaleDateString('it-IT', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const focus = document.getElementById('dashboard-focus-panels');
  if (focus) {
    const panels = [];
    if (['admin', 'magazzino', 'direzione'].includes(ruolo)) {
      panels.push(`
        <div class="card">
          <div class="card-header"><div class="card-title">Magazzino</div></div>
          <div style="padding:0 16px 16px;font-size:13px;color:var(--text2);">
            <div style="margin-bottom:8px;">${alertSottoSoglia} prodotti sotto soglia e ${alertScadenze} lotti in scadenza.</div>
            <button class="btn btn-outline btn-sm" onclick="goTo('giacenze')">Apri giacenze</button>
          </div>
        </div>`);
    }
    if (['admin', 'amministrazione'].includes(ruolo)) {
      panels.push(`
        <div class="card">
          <div class="card-header"><div class="card-title">Clienti e follow-up</div></div>
          <div style="padding:0 16px 16px;font-size:13px;color:var(--text2);">
            <div style="margin-bottom:8px;">Follow-up CRM da gestire: <b>${clienteFollowup}</b></div>
            <button class="btn btn-outline btn-sm" onclick="goTo('clienti')">Apri clienti</button>
          </div>
        </div>`);
    }
    if (ruolo === 'autista') {
      panels.push(`
        <div class="card">
          <div class="card-header"><div class="card-title">Giro di oggi</div></div>
          <div style="padding:0 16px 16px;font-size:13px;color:var(--text2);">
            <div style="margin-bottom:8px;">Ordini assegnati: <b>${assegnatiAutista.length}</b></div>
            <button class="btn btn-outline btn-sm" onclick="goTo('autista')">Apri vista autista</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Tentata vendita</div></div>
          <div style="padding:0 16px 16px;font-size:13px;color:var(--text2);">
            <div style="margin-bottom:8px;">Prodotti nel carico predefinito: <b>${(caricoTentata?.linee || []).length}</b></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-green btn-sm" onclick="openNewOrder()">+ Nuovo ordine</button>
              <button class="btn btn-outline btn-sm" onclick="goTo('tentata')">Apri tentata vendita</button>
            </div>
          </div>
        </div>`);
    }
    focus.innerHTML = panels.join('');
  }

  const recentTitle = document.getElementById('dashboard-recent-title');
  const recentAction = document.getElementById('dashboard-recent-action');
  const tbody = document.getElementById('dash-orders-table');
  let recent = [...state.ordini].sort((a, b) => b.id - a.id).slice(0, 8);
  if (ruolo === 'autista') recent = assegnatiAutista.slice(0, 8);
  if (ruolo === 'magazzino') recent = ordiniOggi.filter(o => o.stato !== 'consegnato' && o.stato !== 'annullato').slice(0, 8);
  if (recentTitle) recentTitle.textContent = ruolo === 'autista' ? 'Le mie consegne di oggi' : (ruolo === 'magazzino' ? 'Ordini operativi di oggi' : 'Ultimi ordini');
  if (recentAction) {
    if (ruolo === 'autista') {
      recentAction.textContent = '+ Nuovo Ordine';
      recentAction.onclick = () => openNewOrder();
    } else if (ruolo === 'magazzino') {
      recentAction.textContent = 'Apri preparazione';
      recentAction.onclick = () => goTo('magazzino');
    } else {
      recentAction.textContent = '+ Nuovo Ordine';
      recentAction.onclick = () => openNewOrder();
    }
  }

  tbody.innerHTML = recent.map(o => `
    <tr>
      <td><span style="font-family:'DM Mono',monospace;font-weight:600;">#${o.id}</span></td>
      <td><b>${escapeHtml(getCliente(o.clienteId).nome)}</b></td>
      <td style="color:var(--text2);">${formatDate(o.data)}</td>
      <td>
        <div style="font-size:13px;">${(() => { const u = state.utenti.find(x => x.id === o.insertedBy); return u ? escapeHtml((u.nome + ' ' + (u.cognome||'')).trim()) : '-'; })()}</div>
        ${o.agenteId ? `<div style="font-size:11px;color:var(--text2);">Agente: ${escapeHtml(getAgente(o.agenteId).nome)}</div>` : ''}
      </td>
      <td>${statoBadge(o.stato)}</td>
      <td>
        <button class="btn btn-outline btn-sm" title="Apri dettaglio ordine" aria-label="Apri dettaglio ordine" onclick="openDettaglio(${o.id})">Dett</button>
        ${['admin', 'magazzino'].includes(ruolo) ? `<button class="btn btn-outline btn-sm" title="Vai alla preparazione" aria-label="Vai alla preparazione" onclick="openPreparazioneOrdine(${o.id})">Prep</button>` : ''}
        ${['admin', 'amministrazione'].includes(ruolo) ? `<button class="btn btn-outline btn-sm" title="Modifica ordine" aria-label="Modifica ordine" onclick="openEditOrder(${o.id})">Mod</button>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">-</div><p>Nessun dato da mostrare</p></div></td></tr>`;
  if (typeof renderGiacenzeAlerts === 'function') renderGiacenzeAlerts();
}

// ================================================
// ORDINI TABLE
// ================================================

let ordiniSort = { key: 'id', dir: 'desc' };

function setOrdiniSort(key) {
  if (!key) return;
  if (ordiniSort.key === key) ordiniSort.dir = ordiniSort.dir === 'asc' ? 'desc' : 'asc';
  else ordiniSort = { key, dir: key === 'id' ? 'desc' : 'asc' };
  renderOrdiniTable();
}

function getOrdineSortValue(o, key) {
  if (key === 'id') return Number(o.id || 0);
  if (key === 'cliente') return (getCliente(o.clienteId)?.nome || '').toLowerCase();
  if (key === 'data') return String(o.data || '');
  if (key === 'inserito') {
    const u = state.utenti.find(x => x.id === o.insertedBy);
    return ((u?.nome || '') + ' ' + (u?.cognome || '')).trim().toLowerCase();
  }
  if (key === 'stato') return String(o.stato || '').toLowerCase();
  if (key === 'note') return String(o.note || '').toLowerCase();
  return Number(o.id || 0);
}

function applyOrdiniSort(list) {
  const dir = ordiniSort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = getOrdineSortValue(a, ordiniSort.key);
    const bv = getOrdineSortValue(b, ordiniSort.key);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), 'it', { sensitivity: 'base' }) * dir;
  });
}

function ordiniSortIcon(key) {
  if (ordiniSort.key !== key) return '↕';
  return ordiniSort.dir === 'asc' ? '↑' : '↓';
}

function renderOrdiniSortHeaders() {
  const map = {
    id: document.getElementById('ord-sort-id'),
    cliente: document.getElementById('ord-sort-cliente'),
    data: document.getElementById('ord-sort-data'),
    inserito: document.getElementById('ord-sort-inserito'),
    stato: document.getElementById('ord-sort-stato'),
    note: document.getElementById('ord-sort-note'),
  };
  Object.entries(map).forEach(([key, el]) => {
    if (!el) return;
    const label = el.dataset.label || el.textContent || '';
    el.innerHTML = `${label} <span style="font-size:11px;color:var(--text3);">${ordiniSortIcon(key)}</span>`;
  });
}

function resetOrdiniFilters() {
  const search = document.getElementById('search-ordini');
  const stato = document.getElementById('filter-stato');
  if (search) search.value = '';
  if (stato) stato.value = '';
  renderOrdiniTable();
}

function renderOrdiniStatusStrip(list) {
  const strip = document.getElementById('ordini-status-strip');
  if (!strip) return;
  const dataNonCerta = list.filter(o => o.dataNonCerta).length;
  const stef = list.filter(o => o.stef || o.altroVettore).length;
  const inAttesa = list.filter(o => o.stato === 'attesa').length;
  const inPrep = list.filter(o => o.stato === 'preparazione').length;
  strip.innerHTML = [
    `<span class="status-pill"><span>Visualizzati</span><strong>${list.length}</strong></span>`,
    `<span class="status-pill warn"><span>In attesa</span><strong>${inAttesa}</strong></span>`,
    `<span class="status-pill info"><span>In preparazione</span><strong>${inPrep}</strong></span>`,
    dataNonCerta ? `<span class="status-pill alert"><span>Date incerte</span><strong>${dataNonCerta}</strong></span>` : '',
    stef ? `<span class="status-pill"><span>Vettori esterni</span><strong>${stef}</strong></span>` : '',
  ].filter(Boolean).join('');
}

function renderOrdiniTable() {
  const q = (document.getElementById('search-ordini')?.value || '').toLowerCase();
  const filterStato = document.getElementById('filter-stato')?.value || '';
  let list = [...state.ordini];
  if (q) list = list.filter(o => getCliente(o.clienteId).nome.toLowerCase().includes(q) || getAgente(o.agenteId).nomeCompleto.toLowerCase().includes(q));
  if (filterStato) list = list.filter(o => o.stato === filterStato);
  list = applyOrdiniSort(list);
  renderOrdiniSortHeaders();
  renderOrdiniStatusStrip(list);
  if (typeof refreshNavBadges === 'function') refreshNavBadges();

  // Toolbar bulk
  const toolbar = document.getElementById('bulk-toolbar');
  if (toolbar) {
    if (selectedOrders.size > 0) {
      toolbar.style.display = 'flex';
      const lbl = toolbar.querySelector('#bulk-count');
      if (lbl) lbl.textContent = `${selectedOrders.size} selezionat${selectedOrders.size===1?'o':'i'}`;
    } else {
      toolbar.style.display = 'none';
    }
  }

  const tbody = document.getElementById('ordini-table');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">-</div><p>Nessun ordine trovato</p></div></td></tr>`;
    return;
  }
  const allIds = list.map(o => o.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedOrders.has(id));
  const thCheck = document.getElementById('th-select-all');
  if (thCheck) thCheck.checked = allSelected;

  tbody.innerHTML = list.map(o => {
    const checked = selectedOrders.has(o.id) ? 'checked' : '';
    const cliente = getCliente(o.clienteId);
    const agente = getAgente(o.agenteId);
    const inserted = (() => {
      const u = state.utenti.find(x => x.id === o.insertedBy);
      return u ? (u.nome + ' ' + (u.cognome || '')).trim() : '-';
    })();
    const rowClass = [
      selectedOrders.has(o.id) ? 'row-selected' : '',
      o.dataNonCerta ? 'table-row-critical' : '',
      (o.stef || o.altroVettore) ? 'table-row-warning' : '',
      o.stato === 'annullato' ? 'table-row-dimmed' : '',
    ].filter(Boolean).join(' ');
    return `
    <tr class="${rowClass}">
      <td style="width:36px;padding:8px 6px;">
        <input type="checkbox" ${checked} onchange="toggleSelectOrder(${o.id},this.checked)"
          style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;">
      </td>
      <td><span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--accent);">#${o.id}</span></td>
      <td>
        <div class="table-main-cell">
          <div class="table-main-meta">
            <b>${escapeHtml(cliente.nome)}</b>
            <div class="inline-badges">
              ${o.dataNonCerta ? '<span class="badge badge-red">Data incerta</span>' : ''}
              ${o.stef ? '<span class="badge badge-blue">STEF</span>' : ''}
              ${o.altroVettore ? '<span class="badge badge-orange">Altro vettore</span>' : ''}
            </div>
          </div>
        </div>
      </td>
      <td>${formatDate(o.data)}</td>
      <td>
        <div style="font-size:13px;">${escapeHtml(inserted)}</div>
        ${o.agenteId ? `<div class="table-subline">Agente: ${escapeHtml(agente.nomeCompleto)}</div>` : ''}
      </td>
      <td class="col-lines" style="font-size:12px;color:var(--text2);max-width:200px;">${lineeResume(o.linee)}</td>
      <td>${statoBadge(o.stato)}</td>
      <td class="col-note" style="font-size:13px;color:var(--text2);">${o.note || '-'}</td>
      <td>
        <div class="table-actions">
        <button class="btn btn-outline btn-sm" title="Modifica ordine" aria-label="Modifica ordine" onclick="openEditOrder(${o.id})">Mod</button>
        <button class="btn btn-outline btn-sm" title="Apri dettaglio ordine" aria-label="Apri dettaglio ordine" onclick="openDettaglio(${o.id})">Dett</button>
        <button class="btn btn-outline btn-sm" title="Vai alla preparazione" aria-label="Vai alla preparazione" onclick="openPreparazioneOrdine(${o.id})">Prep</button>
        <button class="btn btn-danger btn-sm" title="Elimina ordine" aria-label="Elimina ordine" onclick="deleteOrder(${o.id})">Del</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleSelectOrder(id, checked) {
  if (checked) selectedOrders.add(id);
  else selectedOrders.delete(id);
  renderOrdiniTable();
}

function selectAllOrders(checked) {
  const q = (document.getElementById('search-ordini')?.value || '').toLowerCase();
  const filterStato = document.getElementById('filter-stato')?.value || '';
  let list = [...state.ordini];
  if (q) list = list.filter(o => getCliente(o.clienteId).nome.toLowerCase().includes(q));
  if (filterStato) list = list.filter(o => o.stato === filterStato);
  if (checked) list.forEach(o => selectedOrders.add(o.id));
  else selectedOrders.clear();
  renderOrdiniTable();
}

async function deleteSelectedOrders() {
  if (!selectedOrders.size) return;
  const n = selectedOrders.size;
  if (!await customConfirm(`Eliminare ${n} ordine${n>1?'i':''}?`, 'Elimina tutti', 'Eliminazione multipla')) return;
  const ids = [...selectedOrders];
  let ok = 0;
  for (const id of ids) {
    try {
      await api('DELETE', `/api/ordini/${id}`);
      state.ordini = state.ordini.filter(x => x.id !== id);
      selectedOrders.delete(id);
      ok++;
    } catch(e) { /* ignora singolo errore */ }
  }
  showToast(`${ok} ordine${ok>1?'i':''} eliminat${ok>1?'i':'o'} confermato`, 'success');
  renderOrdiniTable();
}

function openPreparazioneOrdine(orderId) {
  const o = state.ordini.find(x => x.id === Number(orderId));
  if (!o) return;
  const dt = document.getElementById('filter-magazzino-data');
  const giro = document.getElementById('filter-magazzino-giro');
  const stato = document.getElementById('filter-magazzino-stato');
  if (dt) dt.value = o.data;
  if (giro && typeof getOrdineGiroEffettivo === 'function') giro.value = getOrdineGiroEffettivo(o) || '';
  if (stato) stato.value = '';
  if (typeof goTo === 'function') goTo('magazzino');
  if (typeof highlightMagazzinoOrder === 'function') {
    setTimeout(() => highlightMagazzinoOrder(o.id), 150);
  }
}

// ================================================
// CLIENTI
// ================================================


