function renderProdottiSchedaStatus(prodotto) {
  const status = document.getElementById('pr-scheda-status');
  const dlBtn = document.getElementById('pr-scheda-download-btn');
  const delBtn = document.getElementById('pr-scheda-delete-btn');
  const hasScheda = !!prodotto?.hasSchedaTecnica;
  if (status) {
    status.textContent = hasScheda
      ? `Allegato: ${prodotto.schedaTecnicaNome || 'scheda tecnica'}${prodotto.schedaTecnicaUploadedAt ? ` · caricato il ${formatDateTime(prodotto.schedaTecnicaUploadedAt)}` : ''}`
      : 'Nessun allegato caricato.';
  }
  if (dlBtn) dlBtn.style.display = hasScheda ? '' : 'none';
  if (delBtn) delBtn.style.display = (hasScheda && state.editingId) ? '' : 'none';
}

function getProdottoBaseUnitLabel(um) {
  const map = { kg: 'kg', lt: 'lt', pz: 'pz' };
  return map[String(um || '').trim().toLowerCase()] || (um || 'unità');
}

function renderProdottoConversionSummary() {
  const box = document.getElementById('pr-conversion-summary');
  if (!box) return;
  const um = document.getElementById('pr-um')?.value || 'kg';
  const baseLabel = getProdottoBaseUnitLabel(um);
  const pesoMedioPezzoKg = Number(document.getElementById('pr-peso-medio-pezzo-kg')?.value || 0);
  const pezziPerCartone = Number(document.getElementById('pr-pezzi-per-cartone')?.value || 0);
  const cartoniAttivi = document.getElementById('pr-cartoni-attivi')?.value === '1';
  const pedaneAttive = document.getElementById('pr-pedane-attive')?.value === '1';
  const unitaPerCartone = Number(document.getElementById('pr-unita-per-cartone')?.value || 0);
  const cartoniPerPedana = Number(document.getElementById('pr-cartoni-per-pedana')?.value || 0);
  const pesoCartoneKg = Number(document.getElementById('pr-peso-cartone-kg')?.value || 0);
  const parts = [];
  if (Number.isFinite(pesoMedioPezzoKg) && pesoMedioPezzoKg > 0) {
    parts.push(`1 pezzo ≈ ${pesoMedioPezzoKg.toFixed(2).replace(/\.00$/, '')} kg`);
  }
  if (cartoniAttivi && Number.isFinite(pezziPerCartone) && pezziPerCartone > 0) {
    parts.push(`1 cartone = ${pezziPerCartone} pezzi`);
  }
  if (cartoniAttivi && Number.isFinite(unitaPerCartone) && unitaPerCartone > 0) {
    parts.push(`1 cartone ≈ ${unitaPerCartone.toFixed(2).replace(/\.00$/, '')} ${baseLabel}`);
  }
  if (cartoniAttivi && pedaneAttive && Number.isFinite(unitaPerCartone) && unitaPerCartone > 0 && Number.isFinite(cartoniPerPedana) && cartoniPerPedana > 0) {
    parts.push(`1 pedana = ${cartoniPerPedana} cartoni ≈ ${(cartoniPerPedana * unitaPerCartone).toFixed(2).replace(/\.00$/, '')} ${baseLabel}`);
  }
  if (cartoniAttivi && Number.isFinite(pesoCartoneKg) && pesoCartoneKg > 0) {
    parts.push(`peso logistico cartone = ${pesoCartoneKg} kg`);
  }
  box.textContent = parts.length ? parts.join(' · ') : 'Nessuna conversione impostata.';
}

function getProdottoDefaultsByCategoria(categoria) {
  if (categoria === 'CAGLIATA') {
    return { gestioneGiacenza: false, puntoRiordino: null };
  }
  if (categoria === 'PANNA UHT') {
    return { gestioneGiacenza: true, puntoRiordino: 500 };
  }
  if (categoria === 'FORMAGGI') {
    return { gestioneGiacenza: true, puntoRiordino: 50 };
  }
  return null;
}

function applyProdottoCategoriaDefaults(force = false) {
  if (state.editingId) return;
  const categoria = document.getElementById('pr-cat')?.value || '';
  const defaults = getProdottoDefaultsByCategoria(categoria);
  if (!defaults) return;

  const gestioneEl = document.getElementById('pr-gestione-giacenza');
  const riordinoEl = document.getElementById('pr-punto-riordino');
  if (gestioneEl && (force || !gestioneEl.dataset.touched)) gestioneEl.value = defaults.gestioneGiacenza ? '1' : '0';
  if (riordinoEl && (force || !riordinoEl.dataset.touched)) riordinoEl.value = defaults.puntoRiordino ?? '';
}

function renderProdottiTable() {
  const q = (document.getElementById('search-prodotti')?.value || '').toLowerCase();
  const filterCat = document.getElementById('filter-cat-prodotti')?.value || '';
  const filterVerifica = document.getElementById('filter-verifica-prodotti')?.value || '';
  let list = state.prodotti;
  if (q) list = list.filter(p =>
    p.nome.toLowerCase().includes(q) ||
    p.codice.toLowerCase().includes(q) ||
    p.categoria.toLowerCase().includes(q)
  );
  if (filterCat) list = list.filter(p => p.categoria === filterCat);
  if (filterVerifica === 'da_verificare') list = list.filter(p => p.autoAnagrafato);
  list = [...list].sort((a, b) => {
    const autoDiff = Number(!!b.autoAnagrafato) - Number(!!a.autoAnagrafato);
    if (autoDiff !== 0) return autoDiff;
    return (a.nome || '').localeCompare(b.nome || '', 'it', { sensitivity: 'base' });
  });

  const tbody = document.getElementById('prodotti-table');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="empty-state"><div class="empty-icon">-</div><p>Nessun prodotto trovato</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(p => `
    <tr>
      <td><span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3);">${escapeHtml(p.codice)}</span></td>
      <td>
        <b>${escapeHtml(p.nome)}</b>
        ${p.autoAnagrafato ? `<div style="margin-top:4px;"><span class="badge badge-orange">Da verificare</span></div>` : ''}
      </td>
      <td><span class="badge badge-gray">${escapeHtml(p.categoria)}</span></td>
      <td style="font-family:'DM Mono',monospace;">${escapeHtml(p.um)}</td>
      <td style="font-size:12px;color:var(--text2);">
        ${escapeHtml(p.packaging || '')}
        ${(p.pesoMedioPezzoKg) ? `<div style="margin-top:4px;">1 pz ≈ ${escapeHtml(String(p.pesoMedioPezzoKg))} kg</div>` : ''}
        ${(p.cartoniAttivi && p.pezziPerCartone) ? `<div>1 ct = ${escapeHtml(String(p.pezziPerCartone))} pz</div>` : ''}
        ${(p.cartoniAttivi && p.unitaPerCartone) ? `<div style="margin-top:4px;">1 ct = ${escapeHtml(String(p.unitaPerCartone))} ${escapeHtml(p.um)}</div>` : ''}
        ${(p.pedaneAttive && p.cartoniPerPedana && p.unitaPerCartone) ? `<div>1 pd = ${escapeHtml(String(p.cartoniPerPedana))} ct</div>` : ''}
      </td>
      <td><span class="badge ${p.pesoFisso ? 'badge-blue' : 'badge-orange'}">${p.pesoFisso ? 'Fisso' : 'Variabile'}</span></td>
      <td><span class="badge ${p.gestioneGiacenza ? 'badge-green' : 'badge-gray'}">${p.gestioneGiacenza ? 'Gestito' : 'Escluso'}</span></td>
      <td style="font-family:'DM Mono',monospace;">${p.puntoRiordino !== null ? escapeHtml(String(p.puntoRiordino)) : '<span style="color:var(--text3);font-size:12px;">-</span>'}</td>
      <td><span class="badge ${p.assortimentoStato === 'attivo' ? 'badge-green' : (p.assortimentoStato === 'su_ordinazione' ? 'badge-blue' : 'badge-gray')}">${p.assortimentoStato === 'fuori_assortimento' ? 'Fuori assort.' : (p.assortimentoStato === 'su_ordinazione' ? 'Su ordinazione' : 'Attivo')}</span></td>
      <td>${p.hasSchedaTecnica ? `<button class="btn btn-outline btn-sm" onclick="downloadProdottoScheda(${p.id})">Apri</button>` : '<span style="color:var(--text3);font-size:12px;">-</span>'}</td>
      <td style="font-family:'DM Mono',monospace;">${eur(getListinoBaseProdotto(p.id))}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-outline btn-sm" title="Modifica prodotto" aria-label="Modifica prodotto" onclick="openEditProdotto(${p.id})">Mod</button>
          <button class="btn btn-outline btn-sm" title="Carica scheda tecnica" aria-label="Carica scheda tecnica" onclick="promptProdottoSchedaUpload(${p.id})">Scheda</button>
          <button class="btn btn-danger btn-sm" title="Elimina prodotto" aria-label="Elimina prodotto" onclick="deleteProdotto(${p.id})">Del</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openNewProdotto() {
  state.editingId = null;
  document.getElementById('modal-prodotto-title').textContent = 'Nuovo Prodotto';
  ['pr-codice', 'pr-nome', 'pr-packaging', 'pr-note', 'pr-punto-riordino', 'pr-peso-medio-pezzo-kg', 'pr-pezzi-per-cartone', 'pr-unita-per-cartone', 'pr-cartoni-per-pedana', 'pr-peso-cartone-kg'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pr-cat').value = 'FORMAGGI';
  document.getElementById('pr-um').value = 'kg';
  document.getElementById('pr-peso').value = 'F';
  document.getElementById('pr-gestione-giacenza').value = '1';
  document.getElementById('pr-assortimento-stato').value = 'attivo';
  document.getElementById('pr-cartoni-attivi').value = '0';
  document.getElementById('pr-pedane-attive').value = '0';
  ['pr-gestione-giacenza', 'pr-punto-riordino', 'pr-um', 'pr-peso', 'pr-cartoni-attivi', 'pr-peso-medio-pezzo-kg', 'pr-pezzi-per-cartone', 'pr-unita-per-cartone', 'pr-pedane-attive', 'pr-cartoni-per-pedana', 'pr-peso-cartone-kg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) delete el.dataset.touched;
  });
  applyProdottoCategoriaDefaults(true);
  const fileInput = document.getElementById('pr-scheda-file');
  if (fileInput) fileInput.value = '';
  renderProdottiSchedaStatus(null);
  renderProdottoConversionSummary();
  openModal('modal-prodotto');
}

function openEditProdotto(id) {
  const p = state.prodotti.find(x => x.id === id);
  if (!p) return;
  state.editingId = id;
  document.getElementById('modal-prodotto-title').textContent = 'Modifica Prodotto';
  document.getElementById('pr-codice').value = p.codice;
  document.getElementById('pr-nome').value = p.nome;
  document.getElementById('pr-cat').value = p.categoria;
  document.getElementById('pr-um').value = p.um;
  document.getElementById('pr-peso').value = p.pesoFisso ? 'F' : 'V';
  document.getElementById('pr-gestione-giacenza').value = p.gestioneGiacenza ? '1' : '0';
  document.getElementById('pr-punto-riordino').value = p.puntoRiordino ?? '';
  document.getElementById('pr-assortimento-stato').value = p.assortimentoStato || 'attivo';
  document.getElementById('pr-packaging').value = p.packaging;
  document.getElementById('pr-cartoni-attivi').value = p.cartoniAttivi ? '1' : '0';
  document.getElementById('pr-peso-medio-pezzo-kg').value = p.pesoMedioPezzoKg ?? '';
  document.getElementById('pr-pezzi-per-cartone').value = p.pezziPerCartone ?? '';
  document.getElementById('pr-unita-per-cartone').value = p.unitaPerCartone ?? '';
  document.getElementById('pr-pedane-attive').value = p.pedaneAttive ? '1' : '0';
  document.getElementById('pr-cartoni-per-pedana').value = p.cartoniPerPedana ?? '';
  document.getElementById('pr-peso-cartone-kg').value = p.pesoCartoneKg ?? '';
  document.getElementById('pr-note').value = p.note || '';
  const fileInput = document.getElementById('pr-scheda-file');
  if (fileInput) fileInput.value = '';
  renderProdottiSchedaStatus(p);
  renderProdottoConversionSummary();
  openModal('modal-prodotto');
}

document.addEventListener('DOMContentLoaded', () => {
  const catEl = document.getElementById('pr-cat');
  const touchedIds = ['pr-gestione-giacenza', 'pr-punto-riordino', 'pr-um', 'pr-peso', 'pr-cartoni-attivi', 'pr-peso-medio-pezzo-kg', 'pr-pezzi-per-cartone', 'pr-unita-per-cartone', 'pr-pedane-attive', 'pr-cartoni-per-pedana', 'pr-peso-cartone-kg'];
  touchedIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { el.dataset.touched = '1'; });
    el.addEventListener('change', () => { el.dataset.touched = '1'; });
  });
  ['pr-um', 'pr-cartoni-attivi', 'pr-peso-medio-pezzo-kg', 'pr-pezzi-per-cartone', 'pr-unita-per-cartone', 'pr-pedane-attive', 'pr-cartoni-per-pedana', 'pr-peso-cartone-kg'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', renderProdottoConversionSummary);
    el.addEventListener('change', renderProdottoConversionSummary);
  });
  if (catEl) {
    catEl.addEventListener('change', () => applyProdottoCategoriaDefaults(false));
  }
});

async function saveProdotto() {
  const codice = document.getElementById('pr-codice').value.trim().toUpperCase();
  const nome = document.getElementById('pr-nome').value.trim();
  const categoria = document.getElementById('pr-cat').value;
  const um = document.getElementById('pr-um').value.trim();
  if (!codice || !nome || !categoria || !um) {
    showToast('Compila tutti i campi obbligatori', 'warning');
    return;
  }
  const body = {
    codice,
    nome,
    categoria,
    um,
    packaging: document.getElementById('pr-packaging').value.trim(),
    peso_fisso: (document.getElementById('pr-peso').value === 'F'),
    gestione_giacenza: document.getElementById('pr-gestione-giacenza').value === '1',
    cartoni_attivi: document.getElementById('pr-cartoni-attivi').value === '1',
    peso_medio_pezzo_kg: (() => {
      const raw = document.getElementById('pr-peso-medio-pezzo-kg').value;
      return raw === '' ? null : Number(raw);
    })(),
    pezzi_per_cartone: (() => {
      const raw = document.getElementById('pr-pezzi-per-cartone').value;
      return raw === '' ? null : Number(raw);
    })(),
    unita_per_cartone: (() => {
      const raw = document.getElementById('pr-unita-per-cartone').value;
      return raw === '' ? null : Number(raw);
    })(),
    pedane_attive: document.getElementById('pr-pedane-attive').value === '1',
    cartoni_per_pedana: (() => {
      const raw = document.getElementById('pr-cartoni-per-pedana').value;
      return raw === '' ? null : Number(raw);
    })(),
    peso_cartone_kg: (() => {
      const raw = document.getElementById('pr-peso-cartone-kg').value;
      return raw === '' ? null : Number(raw);
    })(),
    punto_riordino: (() => {
      const raw = document.getElementById('pr-punto-riordino').value;
      return raw === '' ? null : Number(raw);
    })(),
    assortimento_stato: document.getElementById('pr-assortimento-stato').value,
    note: document.getElementById('pr-note').value.trim(),
  };
  if (body.punto_riordino !== null && (!Number.isFinite(body.punto_riordino) || body.punto_riordino < 0)) {
    showToast('Punto di riordino non valido', 'warning');
    return;
  }
  if (body.peso_medio_pezzo_kg !== null && (!Number.isFinite(body.peso_medio_pezzo_kg) || body.peso_medio_pezzo_kg <= 0)) {
    showToast('Peso medio pezzo non valido', 'warning');
    return;
  }
  if (body.pezzi_per_cartone !== null && (!Number.isFinite(body.pezzi_per_cartone) || body.pezzi_per_cartone <= 0)) {
    showToast('Pezzi per cartone non validi', 'warning');
    return;
  }
  if (body.cartoni_attivi
      && (!Number.isFinite(body.unita_per_cartone) || body.unita_per_cartone <= 0)
      && Number.isFinite(body.peso_medio_pezzo_kg) && body.peso_medio_pezzo_kg > 0
      && Number.isFinite(body.pezzi_per_cartone) && body.pezzi_per_cartone > 0) {
    body.unita_per_cartone = body.peso_medio_pezzo_kg * body.pezzi_per_cartone;
  }
  if (body.peso_cartone_kg === null
      && Number.isFinite(body.peso_medio_pezzo_kg) && body.peso_medio_pezzo_kg > 0
      && Number.isFinite(body.pezzi_per_cartone) && body.pezzi_per_cartone > 0) {
    body.peso_cartone_kg = body.peso_medio_pezzo_kg * body.pezzi_per_cartone;
  }
  if (body.cartoni_attivi && (!Number.isFinite(body.unita_per_cartone) || body.unita_per_cartone <= 0)) {
    showToast('Unità per cartone non valide', 'warning');
    return;
  }
  if (!body.cartoni_attivi) {
    body.pezzi_per_cartone = null;
    body.unita_per_cartone = null;
    body.pedane_attive = false;
    body.cartoni_per_pedana = null;
  }
  if (body.pedane_attive && (!Number.isFinite(body.cartoni_per_pedana) || body.cartoni_per_pedana <= 0)) {
    showToast('Cartoni per pedana non validi', 'warning');
    return;
  }
  if (body.peso_cartone_kg !== null && (!Number.isFinite(body.peso_cartone_kg) || body.peso_cartone_kg <= 0)) {
    showToast('Peso cartone logistico non valido', 'warning');
    return;
  }
  try {
    if (state.editingId) {
      await api('PUT', `/api/prodotti/${state.editingId}`, body);
      const idx = state.prodotti.findIndex(p => p.id === state.editingId);
      if (idx !== -1) {
        state.prodotti[idx] = normalizeProdotto({
          ...state.prodotti[idx],
          ...body,
          id: state.editingId,
          peso_fisso: body.peso_fisso ? 1 : 0,
          gestione_giacenza: body.gestione_giacenza ? 1 : 0,
          cartoni_attivi: body.cartoni_attivi ? 1 : 0,
          peso_medio_pezzo_kg: body.peso_medio_pezzo_kg,
          pezzi_per_cartone: body.pezzi_per_cartone,
          unita_per_cartone: body.unita_per_cartone,
          pedane_attive: body.pedane_attive ? 1 : 0,
          cartoni_per_pedana: body.cartoni_per_pedana,
          peso_cartone_kg: body.peso_cartone_kg,
          punto_riordino: body.punto_riordino,
          assortimento_stato: body.assortimento_stato,
          auto_anagrafato: 0,
          auto_anagrafato_at: null,
          has_scheda_tecnica: state.prodotti[idx].hasSchedaTecnica,
          scheda_tecnica_nome: state.prodotti[idx].schedaTecnicaNome,
          scheda_tecnica_mime: state.prodotti[idx].schedaTecnicaMime,
          scheda_tecnica_uploaded_at: state.prodotti[idx].schedaTecnicaUploadedAt,
        });
      }
    } else {
      const saved = await api('POST', '/api/prodotti', body);
      state.prodotti.push(normalizeProdotto({
        ...body,
        id: saved.id,
        peso_fisso: body.peso_fisso ? 1 : 0,
        gestione_giacenza: body.gestione_giacenza ? 1 : 0,
        cartoni_attivi: body.cartoni_attivi ? 1 : 0,
        peso_medio_pezzo_kg: body.peso_medio_pezzo_kg,
        pezzi_per_cartone: body.pezzi_per_cartone,
        unita_per_cartone: body.unita_per_cartone,
        pedane_attive: body.pedane_attive ? 1 : 0,
        cartoni_per_pedana: body.cartoni_per_pedana,
        peso_cartone_kg: body.peso_cartone_kg,
        punto_riordino: body.punto_riordino,
        assortimento_stato: body.assortimento_stato,
      }));
    }
    closeModal('modal-prodotto');
    showToast(state.editingId ? 'Prodotto aggiornato' : 'Prodotto salvato', 'success');
    state.editingId = null;
    renderProdottiTable();
    renderListiniPage();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}

function readProdottoSchedaFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Lettura file non riuscita'));
    reader.readAsDataURL(file);
  });
}

async function uploadProdottoScheda(prodottoId, file) {
  if (!prodottoId || !file) return;
  const contentBase64 = await readProdottoSchedaFile(file);
  const response = await api('POST', `/api/prodotti/${prodottoId}/scheda`, {
    file_name: file.name,
    mime_type: file.type || 'application/octet-stream',
    content_base64: contentBase64,
  });
  const idx = state.prodotti.findIndex(p => p.id === prodottoId);
  if (idx !== -1) {
    state.prodotti[idx].hasSchedaTecnica = true;
    state.prodotti[idx].schedaTecnicaNome = response.file_name || file.name;
    state.prodotti[idx].schedaTecnicaMime = response.mime_type || file.type || 'application/octet-stream';
    state.prodotti[idx].schedaTecnicaUploadedAt = response.uploaded_at || new Date().toISOString();
  }
  renderProdottiSchedaStatus(state.prodotti.find(p => p.id === prodottoId) || null);
  renderProdottiTable();
}

async function uploadProdottoSchedaFromModal() {
  if (!state.editingId) {
    showToast('Salva prima il prodotto, poi carica la scheda tecnica', 'warning');
    return;
  }
  const input = document.getElementById('pr-scheda-file');
  const file = input?.files?.[0];
  if (!file) {
    showToast('Seleziona un file PDF o DOC', 'warning');
    return;
  }
  try {
    await uploadProdottoScheda(state.editingId, file);
    if (input) input.value = '';
    showToast('Scheda tecnica caricata', 'success');
  } catch (e) {
    showToast(e.message || 'Errore upload scheda tecnica', 'warning');
  }
}

function promptProdottoSchedaUpload(prodottoId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await uploadProdottoScheda(prodottoId, file);
      showToast('Scheda tecnica caricata', 'success');
    } catch (e) {
      showToast(e.message || 'Errore upload scheda tecnica', 'warning');
    }
  };
  input.click();
}

async function downloadProdottoScheda(prodottoId) {
  if (!prodottoId) return;
  try {
    const res = await fetch(`${window.BASE_URL}/api/prodotti/${prodottoId}/scheda`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (res.status === 401) {
      doLogout();
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Download non riuscito');
    }
    const blob = await res.blob();
    const disp = res.headers.get('content-disposition') || '';
    const matched = disp.match(/filename=\"?([^\";]+)\"?/i);
    const fallbackName = matched?.[1] || 'scheda-tecnica';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast(e.message || 'Errore download scheda tecnica', 'warning');
  }
}

async function deleteProdottoScheda(prodottoId) {
  if (!prodottoId) return;
  if (!await customConfirm('Rimuovere la scheda tecnica di questo prodotto?')) return;
  try {
    await api('DELETE', `/api/prodotti/${prodottoId}/scheda`);
    const prodotto = state.prodotti.find(p => p.id === prodottoId);
    if (prodotto) {
      prodotto.hasSchedaTecnica = false;
      prodotto.schedaTecnicaNome = '';
      prodotto.schedaTecnicaMime = '';
      prodotto.schedaTecnicaUploadedAt = null;
    }
    const input = document.getElementById('pr-scheda-file');
    if (input) input.value = '';
    renderProdottiSchedaStatus(prodotto || null);
    renderProdottiTable();
    showToast('Scheda tecnica rimossa', 'success');
  } catch (e) {
    showToast(e.message || 'Errore rimozione scheda tecnica', 'warning');
  }
}

async function deleteProdotto(id) {
  id = parseInt(id, 10);
  if (!await customConfirm('Eliminare questo prodotto?')) return;
  try {
    await api('DELETE', `/api/prodotti/${id}`);
    state.prodotti = state.prodotti.filter(x => x.id !== id);
    showToast('Prodotto eliminato');
    renderProdottiTable();
    renderListiniPage();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}
