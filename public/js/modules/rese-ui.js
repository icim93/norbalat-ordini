(function () {
  let editingResaId = null;
  const BUYER_META = {
    viga: { label: 'VIGA', spread: 1.40 },
    ital_butter: { label: 'Ital Butter', spread: 1.25 },
  };

  function canManageRese() {
    const r = window.state.currentUser?.ruolo;
    return r === 'admin' || r === 'direzione';
  }

  function computePrezzoVendutoClient(clalValue, buyerCode, resaPct) {
    const clal = Number(clalValue);
    const resa = Number(resaPct);
    const spread = BUYER_META[String(buyerCode || '')]?.spread;
    if (!Number.isFinite(clal) || !Number.isFinite(resa) || !Number.isFinite(spread) || clal < 0 || resa <= 0) return null;
    return Math.round((((clal + spread) / 82) * resa) * 100) / 100;
  }

  function getFornitoriRese() {
    return [...window.state.clienti]
      .filter(c => c.eFornitore)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  function fillReseFilters() {
    const sel = document.getElementById('filter-fornitore-rese');
    if (!sel) return;
    const current = sel.value || '';
    sel.innerHTML = '<option value="">Tutti i fornitori</option>' +
      getFornitoriRese().map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
  }

  function fillResaFornitoreSelect(selectedId = '') {
    const sel = document.getElementById('resa-fornitore');
    if (!sel) return;
    const fornitori = getFornitoriRese();
    sel.innerHTML = '<option value="">Seleziona fornitore</option>' +
      fornitori.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
    sel.value = selectedId ? String(selectedId) : '';
  }

  function updateResaPrezzoVendutoPreview() {
    const clal = document.getElementById('resa-clal')?.value;
    const buyer = document.getElementById('resa-buyer')?.value;
    const resa = document.getElementById('resa-pct')?.value;
    const out = document.getElementById('resa-prezzo-venduto');
    if (!out) return;
    const prezzo = computePrezzoVendutoClient(clal, buyer, resa);
    out.value = Number.isFinite(prezzo) ? prezzo.toFixed(2) : '';
  }

  function openNewResa() {
    if (!canManageRese()) return;
    editingResaId = null;
    document.getElementById('modal-resa-title').textContent = 'Nuova Resa';
    const latest = [...window.state.rese].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta || b.id - a.id;
    })[0];
    fillResaFornitoreSelect('');
    document.getElementById('resa-clal').value = Number.isFinite(latest?.clalValue) ? latest.clalValue : '';
    document.getElementById('resa-buyer').value = latest?.buyerCode || 'viga';
    document.getElementById('resa-quantita').value = '';
    document.getElementById('resa-prezzo-pagato').value = '';
    document.getElementById('resa-lotto').value = '';
    document.getElementById('resa-pct').value = '100';
    updateResaPrezzoVendutoPreview();
    window.openModal('modal-resa');
  }

  function openEditResa(id) {
    if (!canManageRese()) return;
    const row = window.state.rese.find(r => r.id === id);
    if (!row) return;
    editingResaId = id;
    document.getElementById('modal-resa-title').textContent = `Modifica Resa #${id}`;
    fillResaFornitoreSelect(row.fornitoreId);
    document.getElementById('resa-clal').value = Number.isFinite(row.clalValue) ? row.clalValue : '';
    document.getElementById('resa-buyer').value = row.buyerCode || 'viga';
    document.getElementById('resa-quantita').value = Number.isFinite(row.quantita) ? row.quantita : '';
    document.getElementById('resa-prezzo-pagato').value = Number.isFinite(row.prezzoPagato) ? row.prezzoPagato : '';
    document.getElementById('resa-lotto').value = row.lotto || '';
    document.getElementById('resa-pct').value = Number.isFinite(row.resaPct) ? row.resaPct : '';
    updateResaPrezzoVendutoPreview();
    window.openModal('modal-resa');
  }

  async function saveResa() {
    if (!canManageRese()) return;
    const fornitoreId = parseInt(document.getElementById('resa-fornitore').value || '0', 10);
    const clalValue = parseFloat(document.getElementById('resa-clal').value || '');
    const buyerCode = document.getElementById('resa-buyer').value || 'viga';
    const quantita = parseFloat(document.getElementById('resa-quantita').value || '');
    const prezzoPagato = parseFloat(document.getElementById('resa-prezzo-pagato').value || '');
    const resaPct = parseFloat(document.getElementById('resa-pct').value || '');
    const lotto = (document.getElementById('resa-lotto').value || '').trim();
    if (!fornitoreId || !Number.isFinite(clalValue) || clalValue < 0 || !BUYER_META[buyerCode] || !Number.isFinite(quantita) || quantita <= 0 || !Number.isFinite(prezzoPagato) || prezzoPagato < 0 || !Number.isFinite(resaPct) || resaPct <= 0 || resaPct > 100) {
      return window.showToast('Compila correttamente i campi obbligatori', 'warning');
    }
    const body = {
      fornitore_id: fornitoreId,
      clal_value: clalValue,
      buyer_code: buyerCode,
      quantita,
      prezzo_pagato: prezzoPagato,
      lotto,
      resa_pct: resaPct,
    };
    try {
      let saved;
      if (editingResaId) {
        saved = await window.api('PUT', `/api/rese/${editingResaId}`, body);
        const idx = window.state.rese.findIndex(r => r.id === editingResaId);
        if (idx !== -1) window.state.rese[idx] = window.normalizeResa(saved);
      } else {
        saved = await window.api('POST', '/api/rese', body);
        window.state.rese.unshift(window.normalizeResa(saved));
      }
      editingResaId = null;
      fillReseFilters();
      renderResePage();
      window.closeModal('modal-resa');
      window.showToast('Resa salvata', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function deleteResa(id) {
    if (!canManageRese()) return;
    if (!await window.customConfirm('Eliminare questo record resa?')) return;
    try {
      await window.api('DELETE', `/api/rese/${id}`);
      window.state.rese = window.state.rese.filter(r => r.id !== id);
      if (editingResaId === id) editingResaId = null;
      renderResePage();
      window.showToast('Resa eliminata', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  function renderResePage() {
    const newBtn = document.getElementById('rese-new-btn');
    if (newBtn) newBtn.style.display = canManageRese() ? '' : 'none';
    fillReseFilters();
    const tbody = document.getElementById('rese-table');
    if (!tbody) return;
    const q = (document.getElementById('search-rese')?.value || '').trim().toLowerCase();
    const fornitoreFilter = document.getElementById('filter-fornitore-rese')?.value || '';
    let rows = [...window.state.rese];
    if (fornitoreFilter) rows = rows.filter(r => String(r.fornitoreId) === String(fornitoreFilter));
    if (q) {
      rows = rows.filter(r => {
        const text = [r.fornitoreNome || '', r.lotto || ''].join(' ').toLowerCase();
        return text.includes(q);
      });
    }
    rows.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta || b.id - a.id;
    });
    tbody.innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td style="white-space:nowrap;">${window.formatDateTime(r.createdAt)}</td>
        <td><b>${r.fornitoreNome || '-'}</b></td>
        <td>${BUYER_META[r.buyerCode]?.label || '-'}</td>
        <td style="font-family:'DM Mono',monospace;">${Number.isFinite(r.clalValue) ? r.clalValue.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
        <td style="font-family:'DM Mono',monospace;">${Number(r.quantita || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
        <td style="font-family:'DM Mono',monospace;">${window.eur(r.prezzoPagato)}</td>
        <td style="font-family:'DM Mono',monospace;">${Number(r.resaPct || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
        <td style="font-family:'DM Mono',monospace;font-weight:700;">${window.eur(r.prezzoVenduto)}</td>
        <td>${r.lotto || '<span style="color:var(--text3);">-</span>'}</td>
        <td>
          ${canManageRese() ? `<button class="btn btn-outline btn-sm" onclick="openEditResa(${r.id})">Modifica</button>` : ''}
          ${canManageRese() ? `<button class="btn btn-danger btn-sm" onclick="deleteResa(${r.id})">Elimina</button>` : ''}
        </td>
      </tr>
    `).join('') : '<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">♻️</div><p>Nessuna resa registrata</p></div></td></tr>';
  }

  window.openNewResa = openNewResa;
  window.openEditResa = openEditResa;
  window.updateResaPrezzoVendutoPreview = updateResaPrezzoVendutoPreview;
  window.saveResa = saveResa;
  window.deleteResa = deleteResa;
  window.renderResePage = renderResePage;
})();
