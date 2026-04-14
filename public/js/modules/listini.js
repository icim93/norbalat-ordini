(function () {
  let editingGroupUid = null;
  let openGroupUid = null;

  function canManageListini() {
    const r = window.state.currentUser?.ruolo;
    return r === 'admin' || r === 'direzione';
  }

  function applyListinoRuleClient(price, l) {
    const mode = l.mode || 'final_price';
    if (mode === 'final_price') {
      const fp = Number.isFinite(Number(l.finalPrice)) ? Number(l.finalPrice) : Number(l.prezzo);
      return Number.isFinite(fp) ? fp : price;
    }
    if (mode === 'base_markup') {
      const base = Number.isFinite(Number(l.basePrice)) ? Number(l.basePrice) : price;
      const mk = Number.isFinite(Number(l.markupPct)) ? Number(l.markupPct) : 0;
      if (!Number.isFinite(base)) return price;
      return base * (1 + mk / 100);
    }
    if (mode === 'discount_pct') {
      const s = Number.isFinite(Number(l.discountPct)) ? Number(l.discountPct) : null;
      if (s === null || !Number.isFinite(price)) return price;
      return price * (1 - s / 100);
    }
    return price;
  }

  function getListinoPrezzo(prodottoId, clienteId, dataRif) {
    const d = dataRif || window.today();
    const cliente = clienteId ? window.getCliente(clienteId) : null;
    const giro = cliente?.giro || '';
    const validi = window.state.listini.filter(l => {
      if (l.prodottoId !== prodottoId) return false;
      if (l.validoDal && l.validoDal > d) return false;
      if (l.validoAl && l.validoAl < d) return false;
      if (l.scope === 'all') return true;
      if (l.scope === 'giro') return !!giro && l.giro === giro;
      if (l.scope === 'cliente') return !!clienteId && l.clienteId === clienteId;
      if (l.scope === 'giro_cliente') return !!clienteId && !!giro && l.clienteId === clienteId && l.giro === giro;
      return false;
    });
    const validiNonEsclusi = validi.filter(l => !(Array.isArray(l.excludedClientIds) && l.excludedClientIds.includes(Number(clienteId))));
    if (!validiNonEsclusi.length) return null;
    validiNonEsclusi.sort((a, b) => (a.validoDal < b.validoDal ? 1 : (a.validoDal > b.validoDal ? -1 : b.id - a.id)));
    const best = {};
    validiNonEsclusi.forEach(l => {
      if (!best[l.scope]) best[l.scope] = l;
    });
    const chain = ['all', 'giro', 'cliente', 'giro_cliente'];
    let price = null;
    chain.forEach(k => {
      if (best[k]) price = applyListinoRuleClient(price, best[k]);
    });
    return Number.isFinite(Number(price)) ? Math.round(Number(price) * 100) / 100 : null;
  }

  function getListinoBaseProdotto(prodottoId) {
    return getListinoPrezzo(prodottoId, null, window.today());
  }

  function getListinoStato(l) {
    const t = window.today();
    if (l.validoDal && l.validoDal > t) return 'futuro';
    if (l.validoAl && l.validoAl < t) return 'scaduto';
    return 'attivo';
  }

  function listinoStatoBadge(l) {
    const s = getListinoStato(l);
    if (s === 'attivo') return '<span class="badge badge-green">Attivo</span>';
    if (s === 'futuro') return '<span class="badge badge-blue">Futuro</span>';
    return '<span class="badge badge-red">Scaduto</span>';
  }

  function listinoScopeLabel(l) {
    if (l.scope === 'all') return 'Tutti i clienti';
    if (l.scope === 'giro') return `Giro: ${l.giro || '-'}`;
    if (l.scope === 'cliente') return `Cliente: ${l.clienteId ? (window.state.clienti.find(c => c.id === l.clienteId)?.nome || '-') : '-'}`;
    if (l.scope === 'giro_cliente') {
      const cn = l.clienteId ? (window.state.clienti.find(c => c.id === l.clienteId)?.nome || '-') : '-';
      return `Giro ${l.giro || '-'} + ${cn}`;
    }
    return '-';
  }

  function listinoExcludedLabel(l) {
    const ids = Array.isArray(l.excludedClientIds) ? l.excludedClientIds : [];
    if (!ids.length) return '';
    const nomi = ids.slice(0, 3).map(id => window.state.clienti.find(c => c.id === id)?.nome || `#${id}`);
    const extra = ids.length > 3 ? ` +${ids.length - 3}` : '';
    return `Esclusi: ${nomi.join(', ')}${extra}`;
  }

  function listinoRuleLabel(l) {
    if (l.mode === 'base_markup') return `Base ${window.eur(l.basePrice)} + ${Number(l.markupPct || 0).toFixed(2)}%`;
    if (l.mode === 'discount_pct') return `Sconto ${Number(l.discountPct || 0).toFixed(2)}%`;
    return `Prezzo diretto ${window.eur(l.finalPrice ?? l.prezzo)}`;
  }

  function listinoPreviewPrezzo(l) {
    if (l.mode === 'final_price') return window.eur(l.finalPrice ?? l.prezzo);
    if (l.mode === 'base_markup') {
      const b = Number(l.basePrice);
      const m = Number(l.markupPct || 0);
      if (!Number.isFinite(b)) return '-';
      return window.eur(b * (1 + m / 100));
    }
    return 'Derivato';
  }

  function getFilteredGroups() {
    const q = (document.getElementById('search-listini')?.value || '').toLowerCase();
    const scopeFilter = document.getElementById('filter-scope-listini')?.value || '';
    const statoFilter = document.getElementById('filter-stato-listini')?.value || '';
    let rows = [...(window.state.listiniGruppi || [])];
    if (scopeFilter) rows = rows.filter(l => l.scope === scopeFilter);
    if (statoFilter) rows = rows.filter(l => getListinoStato(l) === statoFilter);
    if (q) {
      rows = rows.filter(l => {
        const text = [
          l.nomeListino || '',
          listinoScopeLabel(l),
          listinoExcludedLabel(l),
          l.note || '',
        ].join(' ').toLowerCase();
        return text.includes(q);
      });
    }
    rows.sort((a, b) => String(a.nomeListino || '').localeCompare(String(b.nomeListino || ''), 'it', { sensitivity: 'base' }));
    return rows;
  }

  async function refreshListiniData() {
    const [groups, rows] = await Promise.all([
      window.api('GET', '/api/listini/gruppi').catch(() => []),
      window.api('GET', '/api/listini').catch(() => []),
    ]);
    window.state.listiniGruppi = (groups || []).map(window.normalizeListinoGruppo);
    window.state.listini = (rows || []).map(window.normalizeListino);
  }

  function fillListinoSelectors() {
    const clienti = [...window.state.clienti]
      .filter(c => typeof window.isClienteAnagrafico === 'function' ? window.isClienteAnagrafico(c) : true)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
    const selCliente = document.getElementById('ls-cliente');
    if (selCliente) {
      selCliente.innerHTML = '<option value="">Seleziona cliente</option>' +
        clienti.map(c => `<option value="${c.id}">${window.escapeHtml(c.nome)}</option>`).join('');
    }
    const selCliMulti = document.getElementById('ls-clienti-multi');
    if (selCliMulti) {
      selCliMulti.innerHTML = clienti.map(c => `<option value="${c.id}">${window.escapeHtml(c.nome)}</option>`).join('');
    }
    const selCliExc = document.getElementById('ls-clienti-excluded');
    if (selCliExc) {
      selCliExc.innerHTML = clienti.map(c => `<option value="${c.id}">${window.escapeHtml(c.nome)}</option>`).join('');
    }
    const selGiro = document.getElementById('ls-giro');
    if (selGiro) {
      const giri = [...new Set(clienti.map(c => c.giro).filter(Boolean))].sort();
      selGiro.innerHTML = '<option value="">Seleziona giro</option>' + giri.map(g => `<option value="${window.escapeHtml(g)}">${window.escapeHtml(g)}</option>`).join('');
    }
  }

  function getListinoCategorie() {
    return [...new Set(
      [...window.state.prodotti]
        .map(p => String(p.categoria || '').trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }

  function onListinoScopeChange() {
    const scope = document.getElementById('ls-scope')?.value || 'all';
    const clienteWrap = document.getElementById('ls-cliente-wrap');
    const clientiMultiWrap = document.getElementById('ls-clienti-multi-wrap');
    const giroWrap = document.getElementById('ls-giro-wrap');
    const needClient = (scope === 'cliente' || scope === 'giro_cliente');
    if (clienteWrap) clienteWrap.style.display = needClient ? '' : 'none';
    if (clientiMultiWrap) clientiMultiWrap.style.display = needClient ? '' : 'none';
    if (giroWrap) giroWrap.style.display = (scope === 'giro' || scope === 'giro_cliente') ? '' : 'none';
    refreshListinoComposerPreview();
  }

  function refreshListinoComposerPreview() {
    const host = document.getElementById('ls-composer-preview');
    if (!host) return;
    const nome = (document.getElementById('ls-nome')?.value || '').trim();
    const scope = document.getElementById('ls-scope')?.value || 'all';
    const giro = document.getElementById('ls-giro')?.value || '';
    const clienteId = document.getElementById('ls-cliente')?.value ? Number(document.getElementById('ls-cliente').value) : null;
    const clienti = [...document.querySelectorAll('#ls-clienti-multi option:checked')].map(o => Number(o.value)).filter(Number.isFinite);
    const excluded = [...document.querySelectorAll('#ls-clienti-excluded option:checked')].length;
    const clienteNome = clienteId ? (window.getCliente(clienteId)?.nome || '') : '';
    const target = scope === 'all'
      ? 'Tutti i clienti'
      : scope === 'giro'
        ? `Giro ${giro || 'non selezionato'}`
        : scope === 'cliente'
          ? `${[clienteNome, ...clienti.map(id => window.getCliente(id)?.nome || '')].filter(Boolean).length} clienti selezionati`
          : `Giro ${giro || 'non selezionato'} + ${[clienteNome, ...clienti.map(id => window.getCliente(id)?.nome || '')].filter(Boolean).length} clienti`;
    host.innerHTML = `
      <h4>${window.escapeHtml(nome || 'Nuovo listino')}</h4>
      <div style="font-size:12px;color:var(--text2);">Target: <strong>${window.escapeHtml(target)}</strong>${excluded ? ` · esclusi ${excluded}` : ''}</div>
      <div style="font-size:12px;color:var(--text3);margin-top:4px;">I prodotti si aggiungono dopo, aprendo il listino dalla pagina.</div>
    `;
  }

  function openListiniModal(prefill = {}) {
    if (!canManageListini()) return;
    editingGroupUid = null;
    document.getElementById('modal-listino-title').textContent = 'Nuovo listino';
    fillListinoSelectors();
    const clienteId = Number(prefill.clienteId) || '';
    const scope = prefill.scope || (clienteId ? 'cliente' : 'all');
    document.getElementById('ls-nome').value = '';
    document.getElementById('ls-scope').value = scope;
    document.getElementById('ls-cliente').value = clienteId;
    document.getElementById('ls-giro').value = prefill.giro || '';
    document.getElementById('ls-dal').value = prefill.validoDal || window.today();
    document.getElementById('ls-al').value = prefill.validoAl || '';
    document.getElementById('ls-note').value = prefill.note || '';
    document.querySelectorAll('#ls-clienti-multi option, #ls-clienti-excluded option').forEach(o => { o.selected = false; });
    if (clienteId) {
      document.querySelectorAll('#ls-clienti-multi option').forEach(o => {
        o.selected = Number(o.value) === Number(clienteId);
      });
    }
    document.querySelectorAll('#ls-clienti-excluded option').forEach(o => {
      o.selected = Array.isArray(prefill.excludedClientIds) && prefill.excludedClientIds.includes(Number(o.value));
    });
    const clienteNome = clienteId ? (window.getCliente(clienteId)?.nome || '') : '';
    document.getElementById('ls-nome').value = prefill.nomeListino || (clienteNome ? `Listino ${clienteNome}` : '');
    onListinoScopeChange();
    refreshListinoComposerPreview();
    window.openModal('modal-listini');
  }

  function openNewListino() {
    openListiniModal();
  }

  function editListinoEntry(groupUid) {
    if (!canManageListini()) return;
    const g = (window.state.listiniGruppi || []).find(x => x.uid === groupUid);
    if (!g) return;
    editingGroupUid = groupUid;
    document.getElementById('modal-listino-title').textContent = 'Modifica listino';
    fillListinoSelectors();
    document.getElementById('ls-nome').value = g.nomeListino || '';
    document.getElementById('ls-scope').value = g.scope || 'all';
    document.getElementById('ls-cliente').value = g.clienteId || '';
    document.getElementById('ls-giro').value = g.giro || '';
    document.getElementById('ls-dal').value = g.validoDal || window.today();
    document.getElementById('ls-al').value = g.validoAl || '';
    document.getElementById('ls-note').value = g.note || '';
    const selectedIds = g.clienteId ? [Number(g.clienteId)] : [];
    document.querySelectorAll('#ls-clienti-multi option').forEach(o => {
      o.selected = selectedIds.includes(Number(o.value));
    });
    const excluded = new Set(Array.isArray(g.excludedClientIds) ? g.excludedClientIds.map(Number) : []);
    document.querySelectorAll('#ls-clienti-excluded option').forEach(o => {
      o.selected = excluded.has(Number(o.value));
    });
    onListinoScopeChange();
    refreshListinoComposerPreview();
    window.openModal('modal-listini');
  }

  async function saveListinoEntry() {
    if (!canManageListini()) return;
    const nomeListino = (document.getElementById('ls-nome')?.value || '').trim();
    const scope = document.getElementById('ls-scope')?.value || 'all';
    const clienteId = document.getElementById('ls-cliente')?.value ? parseInt(document.getElementById('ls-cliente').value, 10) : null;
    const clientiMulti = [...document.querySelectorAll('#ls-clienti-multi option:checked')].map(o => parseInt(o.value, 10)).filter(Number.isFinite);
    const clienteIds = [...new Set([clienteId, ...clientiMulti].filter(Number.isFinite))];
    const excludedClientIds = [...document.querySelectorAll('#ls-clienti-excluded option:checked')].map(o => parseInt(o.value, 10)).filter(Number.isFinite);
    const giro = (document.getElementById('ls-giro')?.value || '').trim();
    const validoDal = document.getElementById('ls-dal')?.value || '';
    const validoAl = document.getElementById('ls-al')?.value || null;
    const note = (document.getElementById('ls-note')?.value || '').trim();
    if (!nomeListino) return window.showToast('Inserisci il nome listino', 'warning');
    if (!validoDal) return window.showToast('Inserisci la data di inizio validità', 'warning');
    if ((scope === 'giro' || scope === 'giro_cliente') && !giro) return window.showToast('Seleziona il giro', 'warning');
    if ((scope === 'cliente' || scope === 'giro_cliente') && !clienteIds.length) return window.showToast('Seleziona almeno un cliente', 'warning');
    const body = {
      nome_listino: nomeListino,
      scope,
      cliente_id: clienteId,
      cliente_ids: clienteIds,
      excluded_client_ids: excludedClientIds,
      giro,
      valido_dal: validoDal,
      valido_al: validoAl,
      note,
    };
    try {
      if (editingGroupUid) await window.api('PUT', `/api/listini/gruppi/${encodeURIComponent(editingGroupUid)}`, body);
      else await window.api('POST', '/api/listini/gruppi', body);
      await refreshListiniData();
      window.closeModal('modal-listini');
      renderListiniPage();
      window.showToast('Listino salvato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function deleteListinoEntry(groupUid) {
    if (!canManageListini()) return;
    if (!await window.customConfirm('Eliminare questo listino e tutte le sue righe prodotto?')) return;
    try {
      await window.api('DELETE', `/api/listini/gruppi/${encodeURIComponent(groupUid)}`);
      await refreshListiniData();
      if (openGroupUid === groupUid) openGroupUid = null;
      renderListiniPage();
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function toggleListinoGroup(groupUid) {
    openGroupUid = openGroupUid === groupUid ? null : groupUid;
    if (openGroupUid) await loadGroupRows(groupUid);
    renderListiniPage();
  }

  async function loadGroupRows(groupUid) {
    const rows = await window.api('GET', `/api/listini/gruppi/${encodeURIComponent(groupUid)}/righe`).catch(() => []);
    window.state.listini = [
      ...window.state.listini.filter(r => r.gruppoUid !== groupUid),
      ...(rows || []).map(window.normalizeListino),
    ];
  }

  function syncListinoRuleInputs(container, attrName) {
    if (!container) return;
    const mode = container.querySelector(`[${attrName}="mode"]`)?.value || 'final_price';
    const toggle = (key, enabled) => {
      const el = container.querySelector(`[${attrName}="${key}"]`);
      if (!el) return;
      el.disabled = !enabled;
    };
    toggle('base_price', mode === 'base_markup');
    toggle('markup_pct', mode === 'base_markup');
    toggle('discount_pct', mode === 'discount_pct');
    toggle('final_price', mode === 'final_price');
  }

  function updateListinoRuleInputs(rowEl) {
    syncListinoRuleInputs(rowEl, 'data-listino-row');
  }

  function updateListinoBulkInputs(boxEl) {
    syncListinoRuleInputs(boxEl, 'data-listino-bulk');
  }

  function buildRuleEditorRow(row = {}) {
    return `
      <tr>
        <td>
          <select data-listino-row="prodotto">
            <option value="">Seleziona prodotto</option>
            ${[...window.state.prodotti]
              .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' }))
              .map(p => `<option value="${p.id}" ${Number(row.prodottoId) === Number(p.id) ? 'selected' : ''}>[${window.escapeHtml(p.codice || '')}] ${window.escapeHtml(p.nome || '')} · ${window.escapeHtml(p.categoria || '-')}</option>`)
              .join('')}
          </select>
        </td>
        <td>
          <select data-listino-row="mode" onchange="updateListinoRuleInputs(this.closest('tr'))">
            <option value="final_price" ${(row.mode || 'final_price') === 'final_price' ? 'selected' : ''}>Prezzo diretto</option>
            <option value="base_markup" ${row.mode === 'base_markup' ? 'selected' : ''}>Base + ricarico</option>
            <option value="discount_pct" ${row.mode === 'discount_pct' ? 'selected' : ''}>Sconto %</option>
          </select>
        </td>
        <td><input type="number" step="0.01" min="0" value="${row.mode === 'base_markup' ? (row.basePrice ?? '') : ''}" data-listino-row="base_price" ${row.mode === 'base_markup' ? '' : 'disabled'}></td>
        <td><input type="number" step="0.01" value="${row.mode === 'base_markup' ? (row.markupPct ?? 0) : ''}" data-listino-row="markup_pct" ${row.mode === 'base_markup' ? '' : 'disabled'}></td>
        <td><input type="number" step="0.01" min="0" max="100" value="${row.mode === 'discount_pct' ? (row.discountPct ?? 0) : ''}" data-listino-row="discount_pct" ${row.mode === 'discount_pct' ? '' : 'disabled'}></td>
        <td><input type="number" step="0.01" min="0" value="${row.mode === 'final_price' ? (row.finalPrice ?? row.prezzo ?? '') : ''}" data-listino-row="final_price" ${row.mode === 'final_price' ? '' : 'disabled'}></td>
        <td>${row.id ? window.escapeHtml(listinoPreviewPrezzo(row)) : '-'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-green btn-sm" onclick="saveListinoRowInline('${row.gruppoUid || openGroupUid}', ${row.id || 0}, this.closest('tr'))">Salva</button>
          ${row.id ? `<button class="btn btn-danger btn-sm" onclick="deleteListinoRowInline(${row.id}, '${row.gruppoUid || openGroupUid}')">Elimina</button>` : ''}
        </td>
      </tr>
    `;
  }

  function buildBulkCategoryComposer(groupUid) {
    const categories = getListinoCategorie();
    return `
      <div style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:12px;background:linear-gradient(180deg,#fff 0%,#f8fbfe 100%);" data-listino-bulk-box="1">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <strong>Aggiunta rapida per categoria</strong>
          <span style="font-size:12px;color:var(--text3);">Aggiunge tutti i prodotti della categoria non ancora presenti nel listino.</span>
        </div>
        <div class="form-row" style="margin-bottom:0;">
          <div class="field">
            <label>Categoria</label>
            <select data-listino-bulk="categoria">
              <option value="">Seleziona categoria</option>
              ${categories.map(cat => `<option value="${window.escapeHtml(cat)}">${window.escapeHtml(cat)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Regola</label>
            <select data-listino-bulk="mode" onchange="updateListinoBulkInputs(this.closest('[data-listino-bulk-box]'))">
              <option value="final_price">Prezzo diretto</option>
              <option value="base_markup">Base + ricarico</option>
              <option value="discount_pct">Sconto %</option>
            </select>
          </div>
          <div class="field">
            <label>Base</label>
            <input type="number" step="0.01" min="0" data-listino-bulk="base_price" disabled>
          </div>
          <div class="field">
            <label>Ricarico %</label>
            <input type="number" step="0.01" data-listino-bulk="markup_pct" disabled>
          </div>
          <div class="field">
            <label>Sconto %</label>
            <input type="number" step="0.01" min="0" max="100" data-listino-bulk="discount_pct" disabled>
          </div>
          <div class="field">
            <label>Prezzo</label>
            <input type="number" step="0.01" min="0" data-listino-bulk="final_price">
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="btn btn-green" onclick="addListinoCategoryBulk('${groupUid}', this.closest('[data-listino-bulk-box]'))">Aggiungi categoria</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderGroupRowsTable(groupUid) {
    if (openGroupUid !== groupUid) return '';
    const rows = window.state.listini.filter(r => r.gruppoUid === groupUid);
    return `
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <strong>Prodotti del listino</strong>
          ${canManageListini() ? `<button class="btn btn-outline btn-sm" onclick="addListinoRowInline('${groupUid}')">+ Aggiungi riga</button>` : ''}
        </div>
        ${canManageListini() ? buildBulkCategoryComposer(groupUid) : ''}
        <div class="table-scroll-wrap">
          <table>
            <thead>
              <tr>
                <th>Prodotto</th>
                <th>Regola</th>
                <th>Base</th>
                <th>Ricarico %</th>
                <th>Sconto %</th>
                <th>Prezzo</th>
                <th>Preview</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody id="listino-rows-body-${window.escapeHtml(groupUid)}">
              ${rows.map(row => buildRuleEditorRow(row)).join('')}
              ${!rows.length ? `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:18px;">Nessun prodotto nel listino</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderListiniPage() {
    const newBtn = document.getElementById('listini-new-btn');
    if (newBtn) newBtn.style.display = canManageListini() ? '' : 'none';
    const groups = getFilteredGroups();
    const host = document.getElementById('listini-page-table');
    const kpi = document.getElementById('listini-kpi-grid');
    const summary = document.getElementById('listini-page-summary');
    if (kpi) {
      const allRows = window.state.listini || [];
      kpi.innerHTML = `
        <div class="stat-card blue"><div class="stat-label">Listini</div><div class="stat-value" style="font-size:28px;">${groups.length}</div></div>
        <div class="stat-card green"><div class="stat-label">Righe prodotto</div><div class="stat-value" style="font-size:28px;">${allRows.length}</div></div>
        <div class="stat-card orange"><div class="stat-label">Attivi</div><div class="stat-value" style="font-size:28px;">${groups.filter(g => getListinoStato(g) === 'attivo').length}</div></div>
        <div class="stat-card red"><div class="stat-label">Vuoti</div><div class="stat-value" style="font-size:28px;">${groups.filter(g => !Number(g.righeCount || 0)).length}</div></div>
      `;
    }
    if (summary) {
      summary.innerHTML = `<div><strong>${groups.length}</strong> listini in vista</div><div>Apri il listino per gestire i prodotti in tabella</div>`;
    }
    if (!host) return;
    if (!groups.length) {
      host.innerHTML = '<div class="listini-empty">Nessun listino configurato con i filtri correnti</div>';
      return;
    }
    host.innerHTML = groups.map(g => `
      <div class="listini-group-card">
        <div class="listini-group-head">
          <div class="listini-group-title">
            <strong>${window.escapeHtml(g.nomeListino)}</strong>
            <div class="listini-group-meta">
              <span>${window.escapeHtml(listinoScopeLabel(g))}</span>
              <span>${window.escapeHtml(listinoExcludedLabel(g) || 'Nessuna esclusione cliente')}</span>
              <span>${window.escapeHtml(g.validoDal || '-')} → ${window.escapeHtml(g.validoAl || '∞')}</span>
              <span>${listinoStatoBadge(g)}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="listini-price-pill">${Number(g.righeCount || 0)} prodotti</span>
            <button class="btn btn-outline btn-sm" onclick="toggleListinoGroup('${window.escapeHtml(g.uid)}')">${openGroupUid === g.uid ? 'Chiudi' : 'Apri'}</button>
            ${canManageListini() ? `<button class="btn btn-outline btn-sm" onclick="editListinoEntry('${window.escapeHtml(g.uid)}')">Modifica</button>` : ''}
            ${canManageListini() ? `<button class="btn btn-danger btn-sm" onclick="deleteListinoEntry('${window.escapeHtml(g.uid)}')">Elimina</button>` : ''}
          </div>
        </div>
        ${g.note ? `<div style="padding:0 0 10px;font-size:12px;color:var(--text2);">${window.escapeHtml(g.note)}</div>` : ''}
        ${renderGroupRowsTable(g.uid)}
      </div>
    `).join('');
  }

  function addListinoRowInline(groupUid) {
    const tbody = document.getElementById(`listino-rows-body-${groupUid}`);
    if (!tbody) return;
    const empty = tbody.querySelector('td[colspan="8"]');
    if (empty) empty.parentElement.remove();
    tbody.insertAdjacentHTML('beforeend', buildRuleEditorRow({ gruppoUid: groupUid, mode: 'final_price' }));
    const lastRow = tbody.querySelector('tr:last-child');
    if (lastRow) updateListinoRuleInputs(lastRow);
  }

  async function saveListinoRowInline(groupUid, rowId, tr) {
    if (!canManageListini()) return;
    const val = key => tr.querySelector(`[data-listino-row="${key}"]`)?.value || '';
    const body = {
      prodotto_id: Number(val('prodotto')),
      mode: String(val('mode') || 'final_price'),
      base_price: val('base_price') === '' ? null : Number(String(val('base_price')).replace(',', '.')),
      markup_pct: val('markup_pct') === '' ? 0 : Number(String(val('markup_pct')).replace(',', '.')),
      discount_pct: val('discount_pct') === '' ? 0 : Number(String(val('discount_pct')).replace(',', '.')),
      final_price: val('final_price') === '' ? null : Number(String(val('final_price')).replace(',', '.')),
      prezzo: val('final_price') === '' ? null : Number(String(val('final_price')).replace(',', '.')),
    };
    if (!body.prodotto_id) return window.showToast('Seleziona un prodotto', 'warning');
    try {
      if (rowId) await window.api('PUT', `/api/listini/righe/${rowId}`, body);
      else await window.api('POST', `/api/listini/gruppi/${encodeURIComponent(groupUid)}/righe`, body);
      await refreshListiniData();
      openGroupUid = groupUid;
      await loadGroupRows(groupUid);
      renderListiniPage();
      window.showToast('Riga listino salvata', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function deleteListinoRowInline(rowId, groupUid) {
    if (!canManageListini()) return;
    if (!await window.customConfirm('Eliminare questa riga prodotto dal listino?')) return;
    try {
      await window.api('DELETE', `/api/listini/righe/${rowId}`);
      await refreshListiniData();
      openGroupUid = groupUid;
      await loadGroupRows(groupUid);
      renderListiniPage();
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function addListinoCategoryBulk(groupUid, box) {
    if (!canManageListini()) return;
    const val = key => box?.querySelector(`[data-listino-bulk="${key}"]`)?.value || '';
    const categoria = String(val('categoria') || '').trim();
    const mode = String(val('mode') || 'final_price');
    const body = {
      categoria,
      mode,
      base_price: val('base_price') === '' ? null : Number(String(val('base_price')).replace(',', '.')),
      markup_pct: val('markup_pct') === '' ? 0 : Number(String(val('markup_pct')).replace(',', '.')),
      discount_pct: val('discount_pct') === '' ? 0 : Number(String(val('discount_pct')).replace(',', '.')),
      final_price: val('final_price') === '' ? null : Number(String(val('final_price')).replace(',', '.')),
      prezzo: val('final_price') === '' ? null : Number(String(val('final_price')).replace(',', '.')),
    };
    if (!categoria) return window.showToast('Seleziona una categoria', 'warning');
    try {
      const result = await window.api('POST', `/api/listini/gruppi/${encodeURIComponent(groupUid)}/righe-massive`, body);
      await refreshListiniData();
      openGroupUid = groupUid;
      await loadGroupRows(groupUid);
      renderListiniPage();
      const created = Number(result?.created || 0);
      const skipped = Number(result?.skipped || 0);
      if (!created && skipped) window.showToast(`Categoria già presente nel listino (${skipped} prodotti saltati)`, 'warning');
      else window.showToast(`Categoria aggiunta: ${created} prodotti${skipped ? `, ${skipped} già presenti` : ''}`, 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  function initListinoComposerBindings() {
    ['ls-nome', 'ls-cliente', 'ls-clienti-multi', 'ls-clienti-excluded', 'ls-giro', 'ls-dal', 'ls-al', 'ls-note']
      .forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.dataset.listinoPreviewBound === '1') return;
        const evt = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
        el.addEventListener(evt, refreshListinoComposerPreview);
        if (evt !== 'change') el.addEventListener('change', refreshListinoComposerPreview);
        el.dataset.listinoPreviewBound = '1';
      });
  }

  initListinoComposerBindings();

  window.canManageListini = canManageListini;
  window.applyListinoRuleClient = applyListinoRuleClient;
  window.getListinoPrezzo = getListinoPrezzo;
  window.getListinoBaseProdotto = getListinoBaseProdotto;
  window.getListinoStato = getListinoStato;
  window.listinoStatoBadge = listinoStatoBadge;
  window.listinoScopeLabel = listinoScopeLabel;
  window.listinoExcludedLabel = listinoExcludedLabel;
  window.listinoRuleLabel = listinoRuleLabel;
  window.listinoPreviewPrezzo = listinoPreviewPrezzo;
  window.openNewListino = openNewListino;
  window.openListiniModal = openListiniModal;
  window.onListinoScopeChange = onListinoScopeChange;
  window.editListinoEntry = editListinoEntry;
  window.saveListinoEntry = saveListinoEntry;
  window.deleteListinoEntry = deleteListinoEntry;
  window.renderListiniPage = renderListiniPage;
  window.toggleListinoGroup = toggleListinoGroup;
  window.addListinoRowInline = addListinoRowInline;
  window.saveListinoRowInline = saveListinoRowInline;
  window.deleteListinoRowInline = deleteListinoRowInline;
  window.updateListinoRuleInputs = updateListinoRuleInputs;
  window.updateListinoBulkInputs = updateListinoBulkInputs;
  window.addListinoCategoryBulk = addListinoCategoryBulk;
})();
