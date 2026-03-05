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
    const clienti = [...window.state.clienti].sort((a, b) => a.nome.localeCompare(b.nome));
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
    const q = (document.getElementById('search-listini')?.value || '').toLowerCase();
    const scopeFilter = document.getElementById('filter-scope-listini')?.value || '';
    const statoFilter = document.getElementById('filter-stato-listini')?.value || '';
    let rows = [...window.state.listini];
    if (scopeFilter) rows = rows.filter(l => l.scope === scopeFilter);
    if (statoFilter) rows = rows.filter(l => getListinoStato(l) === statoFilter);
    if (q) {
      rows = rows.filter(l => {
        const p = window.getProdotto(l.prodottoId);
        const text = [p.codice || '', p.nome || '', p.categoria || '', listinoScopeLabel(l), listinoExcludedLabel(l), l.note || ''].join(' ').toLowerCase();
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

    const tbody = document.getElementById('listini-page-table');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map(l => {
      const p = window.getProdotto(l.prodottoId);
      const prodottoLabel = p.id ? `[${p.codice}] ${p.nome}` : `Prodotto #${l.prodottoId}`;
      return `
        <tr>
          <td><b>${prodottoLabel}</b></td>
          <td>${listinoScopeLabel(l)}${listinoExcludedLabel(l)}</td>
          <td>${listinoRuleLabel(l)}</td>
          <td style="font-family:'DM Mono',monospace;">${listinoPreviewPrezzo(l)}</td>
          <td>${l.validoDal || '-'}</td>
          <td>${l.validoAl || '-'}</td>
          <td>${listinoStatoBadge(l)}</td>
          <td>${l.note || ''}</td>
          <td>
            ${canManageListini() ? `<button class="btn btn-outline btn-sm" onclick="editListinoEntry(${l.id})">Modifica</button>` : ''}
            ${canManageListini() ? `<button class="btn btn-danger btn-sm" onclick="deleteListinoEntry(${l.id})">Elimina</button>` : ''}
          </td>
        </tr>
      `;
    }).join('') : '<tr><td colspan="9" style="color:var(--text3);">Nessun listino configurato</td></tr>';
  }

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
})();
