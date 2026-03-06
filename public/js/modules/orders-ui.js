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
        <div style="font-size:13px;">${(() => { const u = state.utenti.find(x => x.id === o.insertedBy); return u ? (u.nome + ' ' + (u.cognome||'')).trim() : '—'; })()}</div>
        ${o.agenteId ? `<div style="font-size:11px;color:var(--text2);">👤 ${getAgente(o.agenteId).nome}</div>` : ''}
      </td>
      <td>${statoBadge(o.stato)}</td>
      <td>
        <button class="btn btn-outline btn-sm" title="Modifica ordine" aria-label="Modifica ordine" onclick="openEditOrder(${o.id})">✏️</button>
        <button class="btn btn-outline btn-sm" title="Apri dettaglio ordine" aria-label="Apri dettaglio ordine" onclick="openDettaglio(${o.id})">👁️</button>
      </td>
    </tr>
  `).join('');
}

// ═══════════════════════════════════════════════
// ORDINI TABLE
// ═══════════════════════════════════════════════

function renderOrdiniTable() {
  const q = (document.getElementById('search-ordini')?.value || '').toLowerCase();
  const filterStato = document.getElementById('filter-stato')?.value || '';
  let list = [...state.ordini].sort((a,b) => b.id-a.id);
  if (q) list = list.filter(o => getCliente(o.clienteId).nome.toLowerCase().includes(q) || getAgente(o.agenteId).nomeCompleto.toLowerCase().includes(q));
  if (filterStato) list = list.filter(o => o.stato === filterStato);

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
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📋</div><p>Nessun ordine trovato</p></div></td></tr>`;
    return;
  }
  const allIds = list.map(o => o.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedOrders.has(id));
  const thCheck = document.getElementById('th-select-all');
  if (thCheck) thCheck.checked = allSelected;

  tbody.innerHTML = list.map(o => {
    const checked = selectedOrders.has(o.id) ? 'checked' : '';
    return `
    <tr class="${selectedOrders.has(o.id) ? 'row-selected' : ''}">
      <td style="width:36px;padding:8px 6px;">
        <input type="checkbox" ${checked} onchange="toggleSelectOrder(${o.id},this.checked)"
          style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer;">
      </td>
      <td><span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--accent);">#${o.id}</span></td>
      <td><b>${getCliente(o.clienteId).nome}</b></td>
      <td>${formatDate(o.data)}</td>
      <td>
        <div style="font-size:13px;">${(() => { const u = state.utenti.find(x => x.id === o.insertedBy); return u ? (u.nome + ' ' + (u.cognome||'')).trim() : '—'; })()}</div>
        ${o.agenteId ? `<div style="font-size:11px;color:var(--text2);">👤 ${getAgente(o.agenteId).nome}</div>` : ''}
      </td>
      <td class="col-lines" style="font-size:12px;color:var(--text2);max-width:200px;">${lineeResume(o.linee)}</td>
      <td>${statoBadge(o.stato)}</td>
      <td class="col-note" style="font-size:13px;color:var(--text2);">${o.note || '—'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" title="Modifica ordine" aria-label="Modifica ordine" onclick="openEditOrder(${o.id})">✏️</button>
        <button class="btn btn-outline btn-sm" title="Apri dettaglio ordine" aria-label="Apri dettaglio ordine" onclick="openDettaglio(${o.id})">👁️</button>
        <button class="btn btn-danger btn-sm" title="Elimina ordine" aria-label="Elimina ordine" onclick="deleteOrder(${o.id})">🗑️</button>
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
  showToast(`${ok} ordine${ok>1?'i':''} eliminat${ok>1?'i':'o'} ✅`, 'success');
  renderOrdiniTable();
}

// ═══════════════════════════════════════════════
// CLIENTI
// ═══════════════════════════════════════════════

