(function () {
  let editingListinoGroupUid = null;
  let listinoEditorRows = [];
  let listinoEditorSeq = 1;

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

  function getFilteredListiniRows() {
    const q = (document.getElementById('search-listini')?.value || '').toLowerCase();
    const scopeFilter = document.getElementById('filter-scope-listini')?.value || '';
    const statoFilter = document.getElementById('filter-stato-listini')?.value || '';
    let rows = [...window.state.listini];
    if (scopeFilter) rows = rows.filter(l => l.scope === scopeFilter);
    if (statoFilter) rows = rows.filter(l => getListinoStato(l) === statoFilter);
    if (q) {
      rows = rows.filter(l => {
        const p = window.getProdotto(l.prodottoId);
        const text = [
          l.nomeListino || '',
          p?.codice || '',
          p?.nome || '',
          p?.categoria || '',
          listinoScopeLabel(l),
          listinoExcludedLabel(l),
        ].join(' ').toLowerCase();
        return text.includes(q);
      });
    }
    rows.sort((a, b) => {
      const na = String(a.nomeListino || '').localeCompare(String(b.nomeListino || ''), 'it', { sensitivity: 'base' });
      if (na !== 0) return na;
      const pa = window.getProdotto(a.prodottoId)?.nome || '';
      const pb = window.getProdotto(b.prodottoId)?.nome || '';
      if (pa !== pb) return pa.localeCompare(pb, 'it', { sensitivity: 'base' });
      return b.id - a.id;
    });
    return rows;
  }

  function groupRows(rows) {
    const groups = new Map();
    rows.forEach(l => {
      const key = l.gruppoUid || `legacy-${l.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    });
    return [...groups.entries()].map(([key, items]) => ({
      key,
      items,
      head: items[0],
      name: items[0]?.nomeListino || `Listino ${key}`,
    }));
  }

  function renderListiniKpi(filteredRows) {
    const host = document.getElementById('listini-kpi-grid');
    if (!host) return;
    const groups = groupRows(filteredRows);
    const attivi = filteredRows.filter(l => getListinoStato(l) === 'attivo').length;
    const esclusi = new Set(filteredRows.flatMap(l => Array.isArray(l.excludedClientIds) ? l.excludedClientIds : [])).size;
    host.innerHTML = `
      <div class="stat-card blue">
        <div class="stat-label">Listini visibili</div>
        <div class="stat-value" style="font-size:28px;">${groups.length}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Righe prodotto</div>
        <div class="stat-value" style="font-size:28px;">${filteredRows.length}</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-label">Regole attive</div>
        <div class="stat-value" style="font-size:28px;">${attivi}</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Eccezioni clienti</div>
        <div class="stat-value" style="font-size:28px;">${esclusi}</div>
      </div>
    `;
  }

  function renderListiniSummary(filteredRows) {
    const summary = document.getElementById('listini-page-summary');
    if (!summary) return;
    const groups = groupRows(filteredRows);
    const prodotti = new Set(filteredRows.map(l => l.prodottoId)).size;
    summary.innerHTML = `
      <div><strong>${groups.length}</strong> listini in vista su <strong>${groupRows(window.state.listini).length}</strong> totali</div>
      <div><strong>${filteredRows.length}</strong> righe prodotto · <strong>${prodotti}</strong> prodotti coperti</div>
    `;
  }

  function renderListiniGroups(filteredRows) {
    const host = document.getElementById('listini-page-table');
    if (!host) return;
    const groups = groupRows(filteredRows);
    if (!groups.length) {
      host.innerHTML = '<div class="listini-empty">Nessun listino configurato con i filtri correnti</div>';
      return;
    }
    host.innerHTML = groups.map(group => {
      const head = group.head;
      const scopeLabel = listinoScopeLabel(head);
      const excludedLabel = listinoExcludedLabel(head) || 'Nessuna esclusione cliente';
      const validita = `${window.escapeHtml(head.validoDal || '-')} → ${window.escapeHtml(head.validoAl || '∞')}`;
      const rowsHtml = group.items.map(l => {
        const p = window.getProdotto(l.prodottoId);
        const prodottoLabel = p ? `[${window.escapeHtml(p.codice || '')}] ${window.escapeHtml(p.nome || '')}` : `Prodotto #${l.prodottoId}`;
        return `
          <div class="listini-rule-row">
            <div class="listini-rule-main">
              <strong>${prodottoLabel}</strong>
              <div class="listini-rule-sub">${window.escapeHtml(p?.categoria || 'Categoria n.d.')}${p?.um ? ` · ${window.escapeHtml(p.um)}` : ''}</div>
            </div>
            <div class="listini-rule-block">
              <div class="listini-rule-label">Regola</div>
              <div class="listini-rule-value">${window.escapeHtml(listinoRuleLabel(l))}</div>
            </div>
            <div class="listini-rule-block">
              <div class="listini-rule-label">Preview</div>
              <div class="listini-rule-value mono">${window.escapeHtml(listinoPreviewPrezzo(l))}</div>
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="listini-group-card">
          <div class="listini-group-head">
            <div class="listini-group-title">
              <strong>${window.escapeHtml(group.name)}</strong>
              <div class="listini-group-meta">
                <span>${window.escapeHtml(scopeLabel)}</span>
                <span>${window.escapeHtml(excludedLabel)}</span>
                <span>${validita}</span>
                <span>${listinoStatoBadge(head)}</span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span class="listini-price-pill">${group.items.length} prodotti</span>
              ${canManageListini() ? `<button class="btn btn-outline btn-sm" onclick="editListinoEntry('${window.escapeHtml(group.key)}')">Modifica</button>` : ''}
              ${canManageListini() ? `<button class="btn btn-danger btn-sm" onclick="deleteListinoEntry('${window.escapeHtml(group.key)}')">Elimina</button>` : ''}
            </div>
          </div>
          ${head.note ? `<div style="padding:0 0 10px;font-size:12px;color:var(--text2);">${window.escapeHtml(head.note)}</div>` : ''}
          <div class="listini-rules">${rowsHtml}</div>
        </div>
      `;
    }).join('');
  }

  function getProdottiOptionsHtml(selectedId = null) {
    return [...window.state.prodotti]
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' }))
      .map(p => `<option value="${p.id}" ${Number(selectedId) === Number(p.id) ? 'selected' : ''}>[${window.escapeHtml(p.codice || '')}] ${window.escapeHtml(p.nome || '')}</option>`)
      .join('');
  }

  function createEditorRow(data = {}) {
    return {
      key: `r${listinoEditorSeq++}`,
      prodottoId: data.prodottoId || data.prodotto_id || null,
      mode: data.mode || 'final_price',
      basePrice: Number.isFinite(Number(data.basePrice ?? data.base_price)) ? Number(data.basePrice ?? data.base_price) : null,
      markupPct: Number.isFinite(Number(data.markupPct ?? data.markup_pct)) ? Number(data.markupPct ?? data.markup_pct) : 0,
      discountPct: Number.isFinite(Number(data.discountPct ?? data.discount_pct)) ? Number(data.discountPct ?? data.discount_pct) : 0,
      finalPrice: Number.isFinite(Number(data.finalPrice ?? data.final_price ?? data.prezzo)) ? Number(data.finalPrice ?? data.final_price ?? data.prezzo) : null,
    };
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

  function onListinoModeChange() {
    refreshListinoComposerPreview();
  }

  function renderListinoEditorRows() {
    const host = document.getElementById('ls-prodotti-rows');
    if (!host) return;
    if (!listinoEditorRows.length) listinoEditorRows = [createEditorRow()];
    host.innerHTML = listinoEditorRows.map((row, idx) => `
      <div style="border:1px solid var(--border);border-radius:12px;padding:12px;background:#fff;">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
          <div class="field form-full" style="margin:0;grid-column:1 / -1;">
            <label>Prodotto *</label>
            <select onchange="updateListinoEditorRow('${row.key}','prodottoId', this.value)">
              <option value="">Seleziona prodotto</option>
              ${getProdottiOptionsHtml(row.prodottoId)}
            </select>
          </div>
          <div class="field" style="margin:0;">
            <label>Regola prezzo</label>
            <select onchange="updateListinoEditorRow('${row.key}','mode', this.value)">
              <option value="final_price" ${row.mode === 'final_price' ? 'selected' : ''}>Prezzo diretto</option>
              <option value="base_markup" ${row.mode === 'base_markup' ? 'selected' : ''}>Base + ricarico %</option>
              <option value="discount_pct" ${row.mode === 'discount_pct' ? 'selected' : ''}>Sconto %</option>
            </select>
          </div>
          <div class="field" style="margin:0;display:${row.mode === 'final_price' ? '' : 'none'};">
            <label>Prezzo finale</label>
            <input type="number" step="0.01" min="0" value="${row.finalPrice ?? ''}" oninput="updateListinoEditorRow('${row.key}','finalPrice', this.value)">
          </div>
          <div class="field" style="margin:0;display:${row.mode === 'base_markup' ? '' : 'none'};">
            <label>Prezzo base</label>
            <input type="number" step="0.01" min="0" value="${row.basePrice ?? ''}" oninput="updateListinoEditorRow('${row.key}','basePrice', this.value)">
          </div>
          <div class="field" style="margin:0;display:${row.mode === 'base_markup' ? '' : 'none'};">
            <label>Ricarico %</label>
            <input type="number" step="0.01" value="${row.markupPct ?? 0}" oninput="updateListinoEditorRow('${row.key}','markupPct', this.value)">
          </div>
          <div class="field" style="margin:0;display:${row.mode === 'discount_pct' ? '' : 'none'};">
            <label>Sconto %</label>
            <input type="number" step="0.01" min="0" max="100" value="${row.discountPct ?? 0}" oninput="updateListinoEditorRow('${row.key}','discountPct', this.value)">
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;">
          <div style="font-size:12px;color:var(--text2);">
            ${(() => {
              const p = row.prodottoId ? window.getProdotto(row.prodottoId) : null;
              return p ? `${window.escapeHtml(p.nome || '')} · ${window.escapeHtml(listinoPreviewPrezzo({
                mode: row.mode,
                finalPrice: row.finalPrice,
                prezzo: row.finalPrice,
                basePrice: row.basePrice,
                markupPct: row.markupPct,
                discountPct: row.discountPct,
              }))}` : 'Seleziona un prodotto';
            })()}
          </div>
          <button type="button" class="btn btn-outline btn-sm" style="border-color:var(--danger);color:var(--danger);${listinoEditorRows.length === 1 ? 'opacity:0.5;' : ''}" onclick="removeListinoEditorRow('${row.key}')" ${listinoEditorRows.length === 1 ? 'disabled' : ''}>Rimuovi</button>
        </div>
      </div>
    `).join('');
  }

  function addListinoEditorRow(prodottoId = null) {
    listinoEditorRows.push(createEditorRow({ prodottoId }));
    renderListinoEditorRows();
    refreshListinoComposerPreview();
  }

  function removeListinoEditorRow(key) {
    listinoEditorRows = listinoEditorRows.filter(row => row.key !== key);
    if (!listinoEditorRows.length) listinoEditorRows = [createEditorRow()];
    renderListinoEditorRows();
    refreshListinoComposerPreview();
  }

  function updateListinoEditorRow(key, field, value) {
    const row = listinoEditorRows.find(r => r.key === key);
    if (!row) return;
    if (field === 'prodottoId') row.prodottoId = value ? Number(value) : null;
    else if (field === 'mode') row.mode = String(value || 'final_price');
    else {
      const raw = String(value || '').replace(',', '.');
      row[field] = raw === '' ? null : Number(raw);
    }
    renderListinoEditorRows();
    refreshListinoComposerPreview();
  }

  function refreshListinoComposerPreview() {
    const host = document.getElementById('ls-composer-preview');
    if (!host) return;
    const scope = document.getElementById('ls-scope')?.value || 'all';
    const giro = document.getElementById('ls-giro')?.value || '';
    const clienteId = document.getElementById('ls-cliente')?.value ? Number(document.getElementById('ls-cliente').value) : null;
    const clienti = [...document.querySelectorAll('#ls-clienti-multi option:checked')].map(o => Number(o.value)).filter(Number.isFinite);
    const excluded = [...document.querySelectorAll('#ls-clienti-excluded option:checked')].length;
    const nome = (document.getElementById('ls-nome')?.value || '').trim();
    const target = scope === 'all'
      ? 'Tutti i clienti'
      : scope === 'giro'
        ? `Giro ${giro || 'non selezionato'}`
        : scope === 'cliente'
          ? `${[clienteId, ...clienti].filter(Boolean).length} clienti selezionati`
          : `Giro ${giro || 'non selezionato'} + ${[clienteId, ...clienti].filter(Boolean).length} clienti`;
    const items = listinoEditorRows
      .map(r => {
        const p = r.prodottoId ? window.getProdotto(r.prodottoId) : null;
        if (!p) return null;
        return `<div class="listino-composer-preview-item">
          <span>[${window.escapeHtml(p.codice || '')}] ${window.escapeHtml(p.nome || '')}</span>
          <strong>${window.escapeHtml(listinoPreviewPrezzo({
            mode: r.mode,
            finalPrice: r.finalPrice,
            prezzo: r.finalPrice,
            basePrice: r.basePrice,
            markupPct: r.markupPct,
            discountPct: r.discountPct,
          }))}</strong>
        </div>`;
      })
      .filter(Boolean);
    host.innerHTML = `
      <h4>${window.escapeHtml(nome || 'Nuovo listino')}</h4>
      <div style="font-size:12px;color:var(--text2);">Target: <strong>${window.escapeHtml(target)}</strong>${excluded ? ` · esclusi ${excluded}` : ''}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:4px;">Prodotti inseriti: <strong>${items.length}</strong></div>
      <div class="listino-composer-preview-list">${items.length ? items.join('') : '<div style="font-size:12px;color:var(--text3);">Aggiungi almeno un prodotto.</div>'}</div>
    `;
  }

  function openListiniModal(prodottoId = null) {
    if (!canManageListini()) return;
    editingListinoGroupUid = null;
    document.getElementById('modal-listino-title').textContent = 'Nuovo listino';
    fillListinoSelectors();
    document.getElementById('ls-nome').value = '';
    document.getElementById('ls-scope').value = 'all';
    document.getElementById('ls-cliente').value = '';
    document.getElementById('ls-giro').value = '';
    document.getElementById('ls-dal').value = window.today();
    document.getElementById('ls-al').value = '';
    document.getElementById('ls-note').value = '';
    document.querySelectorAll('#ls-clienti-multi option, #ls-clienti-excluded option').forEach(o => { o.selected = false; });
    listinoEditorRows = [createEditorRow({ prodottoId })];
    onListinoScopeChange();
    renderListinoEditorRows();
    refreshListinoComposerPreview();
    window.openModal('modal-listini');
  }

  function openNewListino() {
    openListiniModal();
  }

  function editListinoEntry(groupUid) {
    if (!canManageListini()) return;
    const rows = window.state.listini.filter(x => x.gruppoUid === groupUid);
    if (!rows.length) return;
    const head = rows[0];
    fillListinoSelectors();
    editingListinoGroupUid = groupUid;
    document.getElementById('modal-listino-title').textContent = 'Modifica listino';
    document.getElementById('ls-nome').value = head.nomeListino || '';
    document.getElementById('ls-scope').value = head.scope || 'all';
    document.getElementById('ls-cliente').value = head.clienteId || '';
    document.getElementById('ls-giro').value = head.giro || '';
    document.getElementById('ls-dal').value = head.validoDal || window.today();
    document.getElementById('ls-al').value = head.validoAl || '';
    document.getElementById('ls-note').value = head.note || '';
    const sameClientIds = [...new Set(rows.map(r => Number(r.clienteId)).filter(Number.isFinite))];
    document.querySelectorAll('#ls-clienti-multi option').forEach(o => {
      o.selected = sameClientIds.includes(Number(o.value));
    });
    const excluded = new Set(Array.isArray(head.excludedClientIds) ? head.excludedClientIds.map(Number) : []);
    document.querySelectorAll('#ls-clienti-excluded option').forEach(o => {
      o.selected = excluded.has(Number(o.value));
    });
    const byProd = new Map();
    rows.forEach(r => {
      if (!byProd.has(r.prodottoId)) byProd.set(r.prodottoId, r);
    });
    listinoEditorRows = [...byProd.values()].map(r => createEditorRow(r));
    onListinoScopeChange();
    renderListinoEditorRows();
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
    const items = listinoEditorRows.map(r => ({
      prodotto_id: r.prodottoId,
      mode: r.mode,
      final_price: r.finalPrice,
      prezzo: r.finalPrice,
      base_price: r.basePrice,
      markup_pct: r.markupPct ?? 0,
      discount_pct: r.discountPct ?? 0,
    }));
    if (!nomeListino) return window.showToast('Inserisci il nome listino', 'warning');
    if (!validoDal) return window.showToast('Inserisci la data di inizio validità', 'warning');
    if ((scope === 'giro' || scope === 'giro_cliente') && !giro) return window.showToast('Seleziona il giro', 'warning');
    if ((scope === 'cliente' || scope === 'giro_cliente') && !clienteIds.length) return window.showToast('Seleziona almeno un cliente', 'warning');
    if (!items.length || items.some(i => !i.prodotto_id)) return window.showToast('Completa i prodotti del listino', 'warning');
    for (const item of items) {
      if (item.mode === 'final_price' && (!Number.isFinite(Number(item.final_price)) || Number(item.final_price) < 0)) {
        return window.showToast('Prezzo finale non valido in una riga prodotto', 'warning');
      }
      if (item.mode === 'base_markup' && (!Number.isFinite(Number(item.base_price)) || Number(item.base_price) < 0)) {
        return window.showToast('Prezzo base non valido in una riga prodotto', 'warning');
      }
      if (item.mode === 'discount_pct' && (!Number.isFinite(Number(item.discount_pct)) || Number(item.discount_pct) < 0 || Number(item.discount_pct) > 100)) {
        return window.showToast('Sconto % non valido in una riga prodotto', 'warning');
      }
    }
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
      items,
    };
    try {
      const saved = editingListinoGroupUid
        ? await window.api('PUT', `/api/listini/gruppi/${encodeURIComponent(editingListinoGroupUid)}`, body)
        : await window.api('POST', '/api/listini', body);
      const updatedRows = (saved?.rows || []).map(window.normalizeListino);
      if (editingListinoGroupUid) {
        window.state.listini = window.state.listini.filter(l => l.gruppoUid !== editingListinoGroupUid);
      }
      window.state.listini.push(...updatedRows);
      editingListinoGroupUid = null;
      window.closeModal('modal-listini');
      if (typeof window.renderProdottiTable === 'function') window.renderProdottiTable();
      renderListiniPage();
      window.showToast('Listino salvato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function deleteListinoEntry(groupUid) {
    if (!canManageListini()) return;
    if (!await window.customConfirm('Eliminare questo listino con tutte le sue righe prodotto?')) return;
    try {
      await window.api('DELETE', `/api/listini/gruppi/${encodeURIComponent(groupUid)}`);
      window.state.listini = window.state.listini.filter(l => l.gruppoUid !== groupUid);
      if (editingListinoGroupUid === groupUid) editingListinoGroupUid = null;
      if (typeof window.renderProdottiTable === 'function') window.renderProdottiTable();
      renderListiniPage();
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  function renderListiniPage() {
    const newBtn = document.getElementById('listini-new-btn');
    if (newBtn) newBtn.style.display = canManageListini() ? '' : 'none';
    const rows = getFilteredListiniRows();
    renderListiniKpi(rows);
    renderListiniSummary(rows);
    renderListiniGroups(rows);
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
  window.openNewListino = openNewListino;
  window.getListinoStato = getListinoStato;
  window.listinoStatoBadge = listinoStatoBadge;
  window.fillListinoSelectors = fillListinoSelectors;
  window.onListinoScopeChange = onListinoScopeChange;
  window.onListinoModeChange = onListinoModeChange;
  window.listinoScopeLabel = listinoScopeLabel;
  window.listinoExcludedLabel = listinoExcludedLabel;
  window.listinoRuleLabel = listinoRuleLabel;
  window.listinoPreviewPrezzo = listinoPreviewPrezzo;
  window.openListiniModal = openListiniModal;
  window.editListinoEntry = editListinoEntry;
  window.saveListinoEntry = saveListinoEntry;
  window.deleteListinoEntry = deleteListinoEntry;
  window.renderListiniPage = renderListiniPage;
  window.addListinoEditorRow = addListinoEditorRow;
  window.removeListinoEditorRow = removeListinoEditorRow;
  window.updateListinoEditorRow = updateListinoEditorRow;
})();
