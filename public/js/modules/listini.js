(function () {
  let editingListinoId = null;

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

  function openNewListino() {
    openListiniModal();
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

  function fillListinoSelectors(selectedProdottoId = null) {
    const prodotti = [...window.state.prodotti].sort((a, b) => a.nome.localeCompare(b.nome));
    const clienti = [...window.state.clienti]
      .filter(c => typeof window.isClienteAnagrafico === 'function' ? window.isClienteAnagrafico(c) : true)
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const selProdotto = document.getElementById('ls-prodotto');
    if (selProdotto) {
      selProdotto.innerHTML = '<option value="">Seleziona prodotto</option>' +
        prodotti.map(p => `<option value="${p.id}">[${p.codice}] ${p.nome}</option>`).join('');
      if (selectedProdottoId) selProdotto.value = String(selectedProdottoId);
    }
    const selProdMulti = document.getElementById('ls-prodotti-multi');
    if (selProdMulti) {
      selProdMulti.innerHTML = prodotti.map(p => `<option value="${p.id}">[${p.codice}] ${p.nome}</option>`).join('');
    }
    const selCliente = document.getElementById('ls-cliente');
    if (selCliente) {
      selCliente.innerHTML = '<option value="">Seleziona cliente</option>' +
        clienti.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    }
    const selCliMulti = document.getElementById('ls-clienti-multi');
    if (selCliMulti) {
      selCliMulti.innerHTML = clienti.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    }
    const selCliExc = document.getElementById('ls-clienti-excluded');
    if (selCliExc) {
      selCliExc.innerHTML = clienti.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    }
    const selGiro = document.getElementById('ls-giro');
    if (selGiro) {
      const giri = [...new Set(clienti.map(c => c.giro).filter(Boolean))].sort();
      selGiro.innerHTML = '<option value="">Seleziona giro</option>' + giri.map(g => `<option value="${g}">${g}</option>`).join('');
    }
  }

  function onListinoScopeChange() {
    const scope = document.getElementById('ls-scope')?.value || 'all';
    const clienteWrap = document.getElementById('ls-cliente-wrap');
    const clientiMultiWrap = document.getElementById('ls-clienti-multi-wrap');
    const giroWrap = document.getElementById('ls-giro-wrap');
    const needClient = (scope === 'cliente' || scope === 'giro_cliente');
    if (clienteWrap) clienteWrap.style.display = needClient ? '' : 'none';
    if (clientiMultiWrap) clientiMultiWrap.style.display = (!editingListinoId && needClient) ? '' : 'none';
    if (giroWrap) giroWrap.style.display = (scope === 'giro' || scope === 'giro_cliente') ? '' : 'none';
    refreshListinoComposerPreview();
  }

  function onListinoModeChange() {
    const mode = document.getElementById('ls-mode')?.value || 'base_markup';
    const sh = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? '' : 'none';
    };
    sh('ls-base-wrap', mode === 'base_markup');
    sh('ls-markup-wrap', mode === 'base_markup');
    sh('ls-discount-wrap', mode === 'discount_pct');
    sh('ls-final-wrap', mode === 'final_price');
    refreshListinoComposerPreview();
  }

  function listinoScopeLabel(l) {
    if (l.scope === 'all') return 'Tutti';
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
    return ` | Esclusi: ${nomi.join(', ')}${extra}`;
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

  function getListinoComposerState() {
    const prodottoId = document.getElementById('ls-prodotto')?.value ? parseInt(document.getElementById('ls-prodotto').value, 10) : null;
    const prodottiExtra = [...document.querySelectorAll('#ls-prodotti-multi option:checked')].map(o => parseInt(o.value, 10)).filter(Number.isFinite);
    const prodottoIds = [...new Set([prodottoId, ...prodottiExtra].filter(Number.isFinite))];
    const scope = document.getElementById('ls-scope')?.value || 'all';
    const mode = document.getElementById('ls-mode')?.value || 'base_markup';
    const clienteId = document.getElementById('ls-cliente')?.value ? parseInt(document.getElementById('ls-cliente').value, 10) : null;
    const excludedClientIds = [...document.querySelectorAll('#ls-clienti-excluded option:checked')].map(o => parseInt(o.value, 10)).filter(Number.isFinite);
    const giro = (document.getElementById('ls-giro')?.value || '').trim();
    const basePrice = document.getElementById('ls-base')?.value !== '' ? parseFloat(document.getElementById('ls-base').value) : null;
    const markupPct = document.getElementById('ls-markup')?.value !== '' ? parseFloat(document.getElementById('ls-markup').value) : 0;
    const finalPrice = document.getElementById('ls-final')?.value !== '' ? parseFloat(document.getElementById('ls-final').value) : null;
    const discountPct = document.getElementById('ls-discount')?.value !== '' ? parseFloat(document.getElementById('ls-discount').value) : 0;
    return { prodottoIds, scope, mode, clienteId, excludedClientIds, giro, basePrice, markupPct, finalPrice, discountPct };
  }

  function refreshListinoComposerPreview() {
    const host = document.getElementById('ls-composer-preview');
    if (!host) return;
    const state = getListinoComposerState();
    const products = state.prodottoIds.map(id => window.getProdotto(id)).filter(Boolean);
    const cliente = state.clienteId ? window.getCliente(state.clienteId) : null;
    const target = (() => {
      if (state.scope === 'all') return 'Tutti i clienti';
      if (state.scope === 'giro') return `Giro ${state.giro || 'non selezionato'}`;
      if (state.scope === 'cliente') return `Cliente ${cliente?.nome || 'non selezionato'}`;
      return `Eccezione ${state.giro || 'giro?'} + ${cliente?.nome || 'cliente?'}`;
    })();
    const logic = (() => {
      if (state.mode === 'base_markup') {
        const base = Number.isFinite(state.basePrice) ? window.eur(state.basePrice) : 'base n.d.';
        return `${base} + ${Number(state.markupPct || 0).toFixed(2)}%`;
      }
      if (state.mode === 'discount_pct') return `Sconto ${Number(state.discountPct || 0).toFixed(2)}%`;
      return `Prezzo diretto ${window.eur(state.finalPrice)}`;
    })();
    host.innerHTML = `
      <h4>Anteprima applicazione</h4>
      <div style="font-size:12px;color:var(--text2);">Target: <strong>${window.escapeHtml(target)}</strong>${state.excludedClientIds.length ? ` · esclusi ${state.excludedClientIds.length}` : ''}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:4px;">Logica: <strong>${window.escapeHtml(logic)}</strong></div>
      <div class="listino-composer-preview-list">
        ${products.length ? products.map(p => `
          <div class="listino-composer-preview-item">
            <span>[${window.escapeHtml(p.codice || '')}] ${window.escapeHtml(p.nome || '')}<br><small style="color:var(--text3);">${window.escapeHtml(state.mode === 'base_markup'
              ? `Base ${Number.isFinite(state.basePrice) ? window.eur(state.basePrice) : 'n.d.'} + ricarico ${Number(state.markupPct || 0).toFixed(2)}%`
              : (state.mode === 'final_price' ? 'Prezzo vendita diretto' : `Sconto ${Number(state.discountPct || 0).toFixed(2)}%`))}</small></span>
            <strong>${window.escapeHtml(state.mode === 'base_markup'
              ? (Number.isFinite(state.basePrice) ? window.eur(state.basePrice * (1 + Number(state.markupPct || 0) / 100)) : '-')
              : (state.mode === 'final_price' ? window.eur(state.finalPrice) : 'Derivato'))}</strong>
          </div>
        `).join('') : `<div style="font-size:12px;color:var(--text3);">Seleziona almeno un prodotto per vedere l'effetto della regola.</div>`}
      </div>
    `;
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
          p.codice || '',
          p.nome || '',
          p.categoria || '',
          listinoScopeLabel(l),
          listinoExcludedLabel(l),
          l.note || '',
        ].join(' ').toLowerCase();
        return text.includes(q);
      });
    }
    const statoRank = { attivo: 0, futuro: 1, scaduto: 2 };
    rows.sort((a, b) => {
      const sa = statoRank[getListinoStato(a)] ?? 9;
      const sb = statoRank[getListinoStato(b)] ?? 9;
      if (sa !== sb) return sa - sb;
      const pa = window.getProdotto(a.prodottoId).nome || '';
      const pb = window.getProdotto(b.prodottoId).nome || '';
      if (pa !== pb) return pa.localeCompare(pb);
      if ((a.validoDal || '') !== (b.validoDal || '')) return (a.validoDal || '') < (b.validoDal || '') ? 1 : -1;
      return b.id - a.id;
    });
    return rows;
  }

  function renderListiniKpi(filteredRows) {
    const host = document.getElementById('listini-kpi-grid');
    if (!host) return;
    const totalRows = window.state.listini.length;
    const totalProdotti = new Set(filteredRows.map(l => l.prodottoId)).size;
    const attivi = filteredRows.filter(l => getListinoStato(l) === 'attivo').length;
    const esclusi = new Set(filteredRows.flatMap(l => Array.isArray(l.excludedClientIds) ? l.excludedClientIds : [])).size;
    const diretti = filteredRows.filter(l => l.mode === 'final_price').length;
    host.innerHTML = `
      <div class="stat-card blue">
        <div class="stat-label">Regole visibili</div>
        <div class="stat-value" style="font-size:28px;">${filteredRows.length}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Prodotti coperti</div>
        <div class="stat-value" style="font-size:28px;">${totalProdotti}</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-label">Regole attive</div>
        <div class="stat-value" style="font-size:28px;">${attivi}</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Eccezioni clienti</div>
        <div class="stat-value" style="font-size:28px;">${esclusi}</div>
        <div style="font-size:11px;color:var(--text3);">${diretti} a prezzo diretto · ${totalRows} totali</div>
      </div>
    `;
  }

  function renderListiniSummary(filteredRows) {
    const summary = document.getElementById('listini-page-summary');
    if (!summary) return;
    const prodotti = new Set(filteredRows.map(l => l.prodottoId)).size;
    const ambiti = ['all', 'giro', 'cliente', 'giro_cliente']
      .map(scope => {
        const count = filteredRows.filter(l => l.scope === scope).length;
        if (!count) return '';
        const label = scope === 'all' ? 'tutti' : (scope === 'giro' ? 'giro' : (scope === 'cliente' ? 'cliente' : 'giro + cliente'));
        return `${count} ${label}`;
      })
      .filter(Boolean)
      .join(' · ');
    summary.innerHTML = `
      <div><strong>${filteredRows.length}</strong> regole in vista su <strong>${window.state.listini.length}</strong> totali · <strong>${prodotti}</strong> prodotti</div>
      <div>${ambiti || 'Nessun ambito visibile con i filtri correnti'}</div>
    `;
  }

  function renderListiniGroups(filteredRows) {
    const host = document.getElementById('listini-page-table');
    if (!host) return;
    if (!filteredRows.length) {
      host.innerHTML = '<div class="listini-empty">Nessun listino configurato con i filtri correnti</div>';
      return;
    }
    const groups = new Map();
    filteredRows.forEach(l => {
      if (!groups.has(l.prodottoId)) groups.set(l.prodottoId, []);
      groups.get(l.prodottoId).push(l);
    });
    const html = [...groups.entries()].map(([prodottoId, rules]) => {
      const p = window.getProdotto(prodottoId);
      const prodottoLabel = p.id ? `[${window.escapeHtml(p.codice || '')}] ${window.escapeHtml(p.nome || '')}` : `Prodotto #${prodottoId}`;
      const prezzoBase = window.getListinoBaseProdotto(prodottoId);
      const scopeCounts = {};
      rules.forEach(l => { scopeCounts[l.scope || 'all'] = (scopeCounts[l.scope || 'all'] || 0) + 1; });
      const chips = Object.entries(scopeCounts).map(([scope, count]) => {
        const label = scope === 'all' ? 'Tutti' : (scope === 'giro' ? 'Giro' : (scope === 'cliente' ? 'Cliente' : 'Giro + cliente'));
        return `<span class="listini-scope-chip">${window.escapeHtml(label)} <strong>${count}</strong></span>`;
      }).join('');
      const rulesHtml = rules.map(l => {
        const note = l.note ? window.escapeHtml(l.note) : 'Nessuna nota';
        const validita = `${window.escapeHtml(l.validoDal || '-')} → ${window.escapeHtml(l.validoAl || '∞')}`;
        return `
          <div class="listini-rule-row">
            <div class="listini-rule-main">
              <strong>${window.escapeHtml(listinoScopeLabel(l))}</strong>
              <div class="listini-rule-sub">${window.escapeHtml(listinoExcludedLabel(l).replace(/^\s*\|\s*/, '') || 'Nessuna esclusione cliente')}</div>
            </div>
            <div class="listini-rule-block">
              <div class="listini-rule-label">Regola</div>
              <div class="listini-rule-value">${window.escapeHtml(listinoRuleLabel(l))}</div>
            </div>
            <div class="listini-rule-block">
              <div class="listini-rule-label">Preview</div>
              <div class="listini-rule-value mono">${window.escapeHtml(listinoPreviewPrezzo(l))}</div>
            </div>
            <div class="listini-rule-block">
              <div class="listini-rule-label">Validità</div>
              <div class="listini-rule-value">${validita}</div>
            </div>
            <div class="listini-rule-block">
              <div class="listini-rule-label">Stato / note</div>
              <div class="listini-rule-value">${listinoStatoBadge(l)}</div>
              <div class="listini-rule-sub" style="margin-top:4px;">${note}</div>
            </div>
            <div class="listini-rule-actions">
              ${canManageListini() ? `<button class="btn btn-outline btn-sm" onclick="editListinoEntry(${l.id})">Modifica</button>` : ''}
              ${canManageListini() ? `<button class="btn btn-danger btn-sm" onclick="deleteListinoEntry(${l.id})">Elimina</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="listini-group-card">
          <div class="listini-group-head">
            <div class="listini-group-title">
              <strong>${prodottoLabel}</strong>
              <div class="listini-group-meta">
                <span>${window.escapeHtml(p.categoria || 'Categoria n.d.')}</span>
                <span>${window.escapeHtml(p.um || 'UM n.d.')}</span>
                ${p.packaging ? `<span>${window.escapeHtml(p.packaging)}</span>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span class="listini-price-pill">Prezzo base attivo ${window.escapeHtml(window.eur(prezzoBase))}</span>
              ${canManageListini() ? `<button class="btn btn-green btn-sm" onclick="openListiniModal(${prodottoId})">+ Regola</button>` : ''}
            </div>
          </div>
          <div class="listini-scope-chips">${chips}</div>
          <div class="listini-rules">${rulesHtml}</div>
        </div>
      `;
    }).join('');
    host.innerHTML = html;
  }

  function openListiniModal(prodottoId = null) {
    if (!canManageListini()) return;
    editingListinoId = null;
    document.getElementById('modal-listino-title').textContent = 'Nuovo listino';
    const multiProdWrap = document.getElementById('ls-prodotti-multi-wrap');
    if (multiProdWrap) multiProdWrap.style.display = '';
    fillListinoSelectors(prodottoId);
    document.getElementById('ls-scope').value = 'all';
    document.getElementById('ls-mode').value = 'base_markup';
    document.getElementById('ls-prodotto').value = prodottoId ? String(prodottoId) : '';
    document.querySelectorAll('#ls-prodotti-multi option, #ls-clienti-multi option, #ls-clienti-excluded option').forEach(o => {
      o.selected = false;
    });
    document.getElementById('ls-base').value = '';
    document.getElementById('ls-markup').value = '';
    document.getElementById('ls-discount').value = '';
    document.getElementById('ls-final').value = '';
    document.getElementById('ls-cliente').value = '';
    document.getElementById('ls-giro').value = '';
    document.getElementById('ls-dal').value = window.today();
    document.getElementById('ls-al').value = '';
    document.getElementById('ls-note').value = '';
    onListinoScopeChange();
    onListinoModeChange();
    refreshListinoComposerPreview();
    window.openModal('modal-listini');
  }

  function editListinoEntry(id) {
    if (!canManageListini()) return;
    const l = window.state.listini.find(x => x.id === id);
    if (!l) return;
    fillListinoSelectors(l.prodottoId);
    editingListinoId = id;
    const multiProdWrap = document.getElementById('ls-prodotti-multi-wrap');
    if (multiProdWrap) multiProdWrap.style.display = 'none';
    document.getElementById('modal-listino-title').textContent = 'Modifica listino';
    document.getElementById('ls-prodotto').value = l.prodottoId || '';
    document.getElementById('ls-scope').value = l.scope || 'all';
    document.getElementById('ls-mode').value = l.mode || 'final_price';
    document.getElementById('ls-giro').value = l.giro || '';
    document.getElementById('ls-cliente').value = l.clienteId || '';
    document.getElementById('ls-base').value = Number.isFinite(Number(l.basePrice)) ? l.basePrice : '';
    document.getElementById('ls-markup').value = Number.isFinite(Number(l.markupPct)) ? l.markupPct : '';
    document.getElementById('ls-discount').value = Number.isFinite(Number(l.discountPct)) ? l.discountPct : '';
    document.getElementById('ls-final').value = Number.isFinite(Number(l.finalPrice ?? l.prezzo)) ? (l.finalPrice ?? l.prezzo) : '';
    document.getElementById('ls-dal').value = l.validoDal || window.today();
    document.getElementById('ls-al').value = l.validoAl || '';
    document.getElementById('ls-note').value = l.note || '';
    document.querySelectorAll('#ls-prodotti-multi option').forEach(o => {
      o.selected = false;
    });
    document.querySelectorAll('#ls-clienti-multi option').forEach(o => {
      o.selected = false;
    });
    const excluded = new Set(Array.isArray(l.excludedClientIds) ? l.excludedClientIds.map(Number) : []);
    document.querySelectorAll('#ls-clienti-excluded option').forEach(o => {
      o.selected = excluded.has(Number(o.value));
    });
    onListinoScopeChange();
    onListinoModeChange();
    refreshListinoComposerPreview();
    window.openModal('modal-listini');
  }

  async function saveListinoEntry() {
    if (!canManageListini()) return;
    const prodottoId = document.getElementById('ls-prodotto').value ? parseInt(document.getElementById('ls-prodotto').value) : null;
    const prodottiExtra = [...document.querySelectorAll('#ls-prodotti-multi option:checked')].map(o => parseInt(o.value)).filter(Number.isFinite);
    const prodottoIds = [...new Set([prodottoId, ...prodottiExtra].filter(Number.isFinite))];
    const scope = document.getElementById('ls-scope').value;
    const mode = document.getElementById('ls-mode').value;
    const clienteId = document.getElementById('ls-cliente').value ? parseInt(document.getElementById('ls-cliente').value) : null;
    const clienteIdsMulti = [...document.querySelectorAll('#ls-clienti-multi option:checked')].map(o => parseInt(o.value)).filter(Number.isFinite);
    const clienteIds = [...new Set([clienteId, ...clienteIdsMulti].filter(Number.isFinite))];
    const excludedClientIds = [...document.querySelectorAll('#ls-clienti-excluded option:checked')].map(o => parseInt(o.value)).filter(Number.isFinite);
    const giro = (document.getElementById('ls-giro').value || '').trim();
    const basePrice = document.getElementById('ls-base').value !== '' ? parseFloat(document.getElementById('ls-base').value) : null;
    const markupPct = document.getElementById('ls-markup').value !== '' ? parseFloat(document.getElementById('ls-markup').value) : 0;
    const discountPct = document.getElementById('ls-discount').value !== '' ? parseFloat(document.getElementById('ls-discount').value) : 0;
    const finalPrice = document.getElementById('ls-final').value !== '' ? parseFloat(document.getElementById('ls-final').value) : null;
    const validoDal = document.getElementById('ls-dal').value;
    const validoAl = document.getElementById('ls-al').value || null;
    if (!prodottoIds.length || !validoDal) return window.showToast('Compila i campi obbligatori', 'warning');
    if ((scope === 'giro' || scope === 'giro_cliente') && !giro) return window.showToast('Seleziona il giro', 'warning');
    if ((scope === 'cliente' || scope === 'giro_cliente') && !clienteIds.length) return window.showToast('Seleziona il cliente', 'warning');
    if (mode === 'base_markup' && (!Number.isFinite(basePrice) || basePrice < 0)) return window.showToast('Prezzo base non valido', 'warning');
    if (mode === 'discount_pct' && (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100)) return window.showToast('Sconto % non valido', 'warning');
    if (mode === 'final_price' && (!Number.isFinite(finalPrice) || finalPrice < 0)) return window.showToast('Prezzo finale non valido', 'warning');
    if (validoAl && validoAl < validoDal) return window.showToast('Intervallo date non valido', 'warning');
    const body = {
      prodotto_id: prodottoId,
      prodotto_ids: prodottoIds,
      scope,
      mode,
      cliente_id: clienteId,
      cliente_ids: clienteIds,
      excluded_client_ids: excludedClientIds,
      giro,
      prezzo: finalPrice,
      final_price: finalPrice,
      base_price: basePrice,
      markup_pct: markupPct,
      discount_pct: discountPct,
      valido_dal: validoDal,
      valido_al: validoAl,
      note: document.getElementById('ls-note').value.trim(),
    };
    try {
      let saved;
      if (editingListinoId) {
        saved = await window.api('PUT', `/api/listini/${editingListinoId}`, body);
        const idx = window.state.listini.findIndex(x => x.id === editingListinoId);
        if (idx !== -1) window.state.listini[idx] = window.normalizeListino(saved);
      } else {
        saved = await window.api('POST', '/api/listini', body);
        if (saved?.rows && Array.isArray(saved.rows)) {
          window.state.listini.push(...saved.rows.map(window.normalizeListino));
        } else {
          window.state.listini.push(window.normalizeListino(saved));
        }
      }
      editingListinoId = null;
      window.closeModal('modal-listini');
      window.renderProdottiTable();
      renderListiniPage();
      window.showToast('Listino salvato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function deleteListinoEntry(id) {
    if (!canManageListini()) return;
    if (!await window.customConfirm('Eliminare questa voce listino?')) return;
    try {
      await window.api('DELETE', `/api/listini/${id}`);
      window.state.listini = window.state.listini.filter(l => l.id !== id);
      if (editingListinoId === id) editingListinoId = null;
      window.renderProdottiTable();
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
    ['ls-prodotto', 'ls-prodotti-multi', 'ls-cliente', 'ls-clienti-multi', 'ls-clienti-excluded', 'ls-giro', 'ls-base', 'ls-markup', 'ls-discount', 'ls-final']
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
  window.refreshListinoComposerPreview = refreshListinoComposerPreview;
  window.initListinoComposerBindings = initListinoComposerBindings;
})();
