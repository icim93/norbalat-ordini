(function () {
  let editingFornitoreId = null;
  let editingOrdineFornitoreId = null;

  const STATO_META = {
    richiesta: { label: 'Da lavorare', cls: 'badge-orange' },
    in_lavorazione: { label: 'In lavorazione', cls: 'badge-blue' },
    inviato: { label: 'Inviato', cls: 'badge-green' },
    annullato: { label: 'Annullato', cls: 'badge-gray' },
  };

  function canManageOrdiniFornitori() {
    return ['admin', 'direzione'].includes(window.state.currentUser?.ruolo);
  }

  function canUseOrdiniFornitori() {
    return ['admin', 'direzione', 'magazzino'].includes(window.state.currentUser?.ruolo);
  }

  function canManageFornitori() {
    return canManageOrdiniFornitori();
  }

  function canCancelOrdineFornitore(order) {
    if (!order || ['inviato', 'annullato'].includes(order.stato)) return false;
    if (canManageOrdiniFornitori()) return true;
    return window.state.currentUser?.ruolo === 'magazzino'
      && order.stato === 'richiesta'
      && Number(order.requestedBy) === Number(window.state.currentUser?.id);
  }

  function emailListToText(values) {
    return (Array.isArray(values) ? values : []).filter(Boolean).join(', ');
  }

  function parseEmailText(value) {
    return String(value || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  function getFornitore(id) {
    return (window.state.fornitori || []).find(f => Number(f.id) === Number(id)) || null;
  }

  function getFornitoreDefaultEmails(fornitore) {
    return [fornitore?.email, fornitore?.pec].filter(Boolean);
  }

  function formatQty(value) {
    return Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  }

  function statoBadge(stato) {
    const meta = STATO_META[stato] || STATO_META.richiesta;
    return `<span class="badge ${meta.cls}">${meta.label}</span>`;
  }

  function defaultEmailSubject(order) {
    const prodotto = String(order?.prodottoNome || document.getElementById('ordine-fornitore-prodotto')?.value || 'prodotto').trim();
    return `Ordine Norbalat - ${prodotto}`;
  }

  function defaultEmailBody(order = null) {
    const prodotto = order?.prodottoNome || document.getElementById('ordine-fornitore-prodotto')?.value || '';
    const qta = order?.quantita || document.getElementById('ordine-fornitore-quantita')?.value || '';
    const um = order?.unitaMisura || document.getElementById('ordine-fornitore-unita')?.value || '';
    const note = order?.noteOrdine || document.getElementById('ordine-fornitore-note-ordine')?.value || document.getElementById('ordine-fornitore-note-magazzino')?.value || '';
    return [
      'Buongiorno,',
      '',
      'con la presente richiediamo disponibilita e conferma ordine per:',
      '',
      `Prodotto: ${prodotto}`,
      `Quantita: ${qta}${um ? ` ${um}` : ''}`,
      note ? `Note: ${note}` : '',
      '',
      'Restiamo in attesa di conferma.',
      '',
      'Norbalat',
    ].filter(line => line !== '').join('\n');
  }

  function refreshFornitoriData() {
    return Promise.all([
      window.api('GET', '/api/fornitori'),
      window.api('GET', '/api/ordini-fornitori'),
    ]).then(([fornitori, ordini]) => {
      window.state.fornitori = (fornitori || []).map(window.normalizeFornitore);
      window.state.ordiniFornitori = (ordini || []).map(window.normalizeOrdineFornitore);
      if (typeof window.refreshNavBadges === 'function') window.refreshNavBadges();
    });
  }

  function fillOrdineFornitoreSelects(selectedFornitoreId = '') {
    const sel = document.getElementById('ordine-fornitore-fornitore');
    if (sel) {
      sel.innerHTML = '<option value="">-- Seleziona fornitore --</option>' +
        [...(window.state.fornitori || [])]
          .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { sensitivity: 'base' }))
          .map(f => `<option value="${f.id}">${window.escapeHtml(f.nome)}</option>`)
          .join('');
      sel.value = selectedFornitoreId ? String(selectedFornitoreId) : '';
    }
    const list = document.getElementById('ordine-fornitore-prodotti-list');
    if (list) {
      list.innerHTML = (window.state.prodotti || [])
        .map(p => `<option value="${window.escapeHtml(`[${p.codice}] ${p.nome}`)}"></option>`)
        .join('');
    }
  }

  function syncOrdineFornitoreRecipients() {
    const orderId = Number(document.getElementById('ordine-fornitore-id')?.value || 0);
    const currentOrder = (window.state.ordiniFornitori || []).find(o => Number(o.id) === orderId);
    const input = document.getElementById('ordine-fornitore-email-to');
    if (!input || (currentOrder && input.value.trim())) return;
    const fornitore = getFornitore(document.getElementById('ordine-fornitore-fornitore')?.value);
    input.value = emailListToText(getFornitoreDefaultEmails(fornitore));
  }

  function inferProdottoIdFromInput(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    const match = raw.match(/^\[([^\]]+)\]/);
    const code = match ? match[1].trim().toLowerCase() : '';
    const prod = (window.state.prodotti || []).find(p =>
      (code && String(p.codice || '').toLowerCase() === code) ||
      String(`[${p.codice}] ${p.nome}`).toLowerCase() === raw ||
      String(p.nome || '').toLowerCase() === raw
    );
    return prod?.id || null;
  }

  function collectOrdineFornitorePayload() {
    const fornitoreId = parseInt(document.getElementById('ordine-fornitore-fornitore')?.value || '0', 10);
    const prodottoTextRaw = String(document.getElementById('ordine-fornitore-prodotto')?.value || '').trim();
    const prodottoId = inferProdottoIdFromInput(prodottoTextRaw);
    const prodotto = prodottoId ? (window.state.prodotti || []).find(p => Number(p.id) === Number(prodottoId)) : null;
    const prodottoNome = prodotto ? prodotto.nome : prodottoTextRaw.replace(/^\[[^\]]+\]\s*/, '');
    const quantita = Number(String(document.getElementById('ordine-fornitore-quantita')?.value || '').replace(',', '.'));
    const unitaMisura = String(document.getElementById('ordine-fornitore-unita')?.value || '').trim();
    if (!fornitoreId || !prodottoNome || !Number.isFinite(quantita) || quantita <= 0) {
      window.showToast('Compila fornitore, ordine e quantita', 'warning');
      return null;
    }
    return {
      fornitore_id: fornitoreId,
      prodotto_id: prodottoId,
      prodotto_nome: prodottoNome,
      quantita,
      unita_misura: unitaMisura,
      note_magazzino: String(document.getElementById('ordine-fornitore-note-magazzino')?.value || '').trim(),
      note_ordine: String(document.getElementById('ordine-fornitore-note-ordine')?.value || '').trim(),
      email_to: parseEmailText(document.getElementById('ordine-fornitore-email-to')?.value || ''),
      email_subject: String(document.getElementById('ordine-fornitore-email-subject')?.value || '').trim(),
      email_body: String(document.getElementById('ordine-fornitore-email-body')?.value || '').trim(),
    };
  }

  function updateOrdineFornitoreModalMode(order = null) {
    const manager = canManageOrdiniFornitori();
    const sent = order?.stato === 'inviato';
    const readonlyForWarehouse = !manager && order && order.stato !== 'richiesta';
    const emailFields = document.getElementById('ordine-fornitore-email-fields');
    const sendBtn = document.getElementById('ordine-fornitore-send-btn');
    const saveBtn = document.getElementById('ordine-fornitore-save-btn');
    const dirFields = document.getElementById('ordine-fornitore-direzione-fields');
    if (emailFields) emailFields.style.display = manager ? '' : 'none';
    if (dirFields) dirFields.style.display = manager ? '' : 'none';
    if (sendBtn) sendBtn.style.display = manager && !sent ? '' : 'none';
    if (saveBtn) {
      saveBtn.style.display = sent || readonlyForWarehouse ? 'none' : '';
      saveBtn.textContent = manager ? 'Salva formulazione' : 'Salva richiesta';
    }
    ['ordine-fornitore-fornitore', 'ordine-fornitore-prodotto', 'ordine-fornitore-quantita', 'ordine-fornitore-unita', 'ordine-fornitore-note-magazzino', 'ordine-fornitore-note-ordine', 'ordine-fornitore-email-to', 'ordine-fornitore-email-subject', 'ordine-fornitore-email-body']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = sent || readonlyForWarehouse;
      });
  }

  function openOrdineFornitoreModal(id = null) {
    if (!canUseOrdiniFornitori()) return;
    const order = id ? (window.state.ordiniFornitori || []).find(o => Number(o.id) === Number(id)) : null;
    editingOrdineFornitoreId = order?.id || null;
    document.getElementById('ordine-fornitore-id').value = order?.id || '';
    document.getElementById('modal-ordine-fornitore-title').textContent = order ? `Ordine fornitore #${order.id}` : 'Richiesta ordine fornitore';
    document.getElementById('modal-ordine-fornitore-subtitle').textContent = order
      ? `${order.fornitoreNome || 'Fornitore'} - ${STATO_META[order.stato]?.label || order.stato}`
      : 'Il magazzino apre la richiesta; admin e direzione completano quantita e invio.';
    fillOrdineFornitoreSelects(order?.fornitoreId || '');
    document.getElementById('ordine-fornitore-prodotto').value = order
      ? (order.prodottoCodice ? `[${order.prodottoCodice}] ${order.prodottoNome}` : order.prodottoNome)
      : '';
    document.getElementById('ordine-fornitore-quantita').value = order ? order.quantita : '';
    document.getElementById('ordine-fornitore-unita').value = order?.unitaMisura || '';
    document.getElementById('ordine-fornitore-note-magazzino').value = order?.noteMagazzino || '';
    document.getElementById('ordine-fornitore-note-ordine').value = order?.noteOrdine || '';
    document.getElementById('ordine-fornitore-email-to').value = order ? emailListToText(order.emailTo) : '';
    document.getElementById('ordine-fornitore-email-subject').value = order?.emailSubject || defaultEmailSubject(order);
    document.getElementById('ordine-fornitore-email-body').value = order?.emailBody || defaultEmailBody(order);
    syncOrdineFornitoreRecipients();
    updateOrdineFornitoreModalMode(order);
    window.openModal('modal-ordine-fornitore');
  }

  async function persistOrdineFornitore({ close = true } = {}) {
    const payload = collectOrdineFornitorePayload();
    if (!payload) return null;
    try {
      const saved = editingOrdineFornitoreId
        ? await window.api('PUT', `/api/ordini-fornitori/${editingOrdineFornitoreId}`, payload)
        : await window.api('POST', '/api/ordini-fornitori', payload);
      const normalized = window.normalizeOrdineFornitore(saved);
      const idx = window.state.ordiniFornitori.findIndex(o => Number(o.id) === Number(normalized.id));
      if (idx >= 0) window.state.ordiniFornitori[idx] = normalized;
      else window.state.ordiniFornitori.unshift(normalized);
      editingOrdineFornitoreId = normalized.id;
      if (typeof window.refreshNavBadges === 'function') window.refreshNavBadges();
      renderFornitoriPage();
      if (close) {
        window.closeModal('modal-ordine-fornitore');
        window.showToast('Ordine fornitore salvato', 'success');
      }
      return normalized;
    } catch (e) {
      window.showToast(e.message || 'Errore salvataggio ordine fornitore', 'warning');
      return null;
    }
  }

  async function saveOrdineFornitore() {
    await persistOrdineFornitore({ close: true });
  }

  async function sendOrdineFornitoreEmail() {
    if (!canManageOrdiniFornitori()) return;
    const saved = await persistOrdineFornitore({ close: false });
    if (!saved) return;
    const emailTo = parseEmailText(document.getElementById('ordine-fornitore-email-to')?.value || '');
    const emailBody = String(document.getElementById('ordine-fornitore-email-body')?.value || '').trim() || defaultEmailBody(saved);
    const emailSubject = String(document.getElementById('ordine-fornitore-email-subject')?.value || '').trim() || defaultEmailSubject(saved);
    if (!emailTo.length) {
      window.showToast('Inserisci almeno un destinatario email', 'warning');
      return;
    }
    if (!await window.customConfirm(`Inviare email ordine a ${emailTo.join(', ')}?`, 'Invia')) return;
    try {
      const sent = await window.api('POST', `/api/ordini-fornitori/${saved.id}/send`, {
        email_to: emailTo,
        email_subject: emailSubject,
        email_body: emailBody,
      }, { timeoutMs: 30000 });
      const normalized = window.normalizeOrdineFornitore(sent);
      const idx = window.state.ordiniFornitori.findIndex(o => Number(o.id) === Number(normalized.id));
      if (idx >= 0) window.state.ordiniFornitori[idx] = normalized;
      window.closeModal('modal-ordine-fornitore');
      renderFornitoriPage();
      if (typeof window.refreshNavBadges === 'function') window.refreshNavBadges();
      window.showToast('Email ordine inviata', 'success');
    } catch (e) {
      window.showToast(e.message || 'Invio email non riuscito', 'warning');
    }
  }

  async function annullaOrdineFornitore(id) {
    const order = (window.state.ordiniFornitori || []).find(o => Number(o.id) === Number(id));
    if (!order || order.stato === 'inviato') return;
    if (!await window.customConfirm(`Annullare ordine fornitore #${id}?`)) return;
    try {
      const updated = await window.api('PATCH', `/api/ordini-fornitori/${id}/stato`, { stato: 'annullato' });
      const normalized = window.normalizeOrdineFornitore(updated);
      const idx = window.state.ordiniFornitori.findIndex(o => Number(o.id) === Number(id));
      if (idx >= 0) window.state.ordiniFornitori[idx] = normalized;
      renderFornitoriPage();
      if (typeof window.refreshNavBadges === 'function') window.refreshNavBadges();
      window.showToast('Ordine annullato', 'success');
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  function openFornitoreModal(id = null) {
    if (!canManageFornitori()) return;
    editingFornitoreId = id ? Number(id) : null;
    const row = editingFornitoreId ? getFornitore(editingFornitoreId) : null;
    document.getElementById('modal-fornitore-title').textContent = row ? `Modifica fornitore` : 'Nuovo fornitore';
    document.getElementById('fornitore-id').value = row?.id || '';
    document.getElementById('fornitore-nome').value = row?.nome || '';
    document.getElementById('fornitore-email').value = row?.email || '';
    document.getElementById('fornitore-pec').value = row?.pec || '';
    document.getElementById('fornitore-localita').value = row?.localita || '';
    document.getElementById('fornitore-piva').value = row?.piva || '';
    document.getElementById('fornitore-contatto').value = row?.contattoNome || '';
    document.getElementById('fornitore-telefono').value = row?.telefono || '';
    document.getElementById('fornitore-note').value = row?.note || '';
    window.openModal('modal-fornitore');
  }

  async function saveFornitore() {
    if (!canManageFornitori()) return;
    const nome = String(document.getElementById('fornitore-nome')?.value || '').trim();
    if (!nome) {
      window.showToast('Inserisci il nome fornitore', 'warning');
      return;
    }
    const payload = {
      nome,
      email: String(document.getElementById('fornitore-email')?.value || '').trim(),
      pec: String(document.getElementById('fornitore-pec')?.value || '').trim(),
      localita: String(document.getElementById('fornitore-localita')?.value || '').trim(),
      piva: String(document.getElementById('fornitore-piva')?.value || '').trim(),
      contatto_nome: String(document.getElementById('fornitore-contatto')?.value || '').trim(),
      telefono: String(document.getElementById('fornitore-telefono')?.value || '').trim(),
      note: String(document.getElementById('fornitore-note')?.value || '').trim(),
    };
    try {
      const saved = editingFornitoreId
        ? await window.api('PUT', `/api/fornitori/${editingFornitoreId}`, payload)
        : await window.api('POST', '/api/fornitori', payload);
      const normalized = window.normalizeFornitore(saved);
      const idx = window.state.fornitori.findIndex(f => Number(f.id) === Number(normalized.id));
      if (idx >= 0) window.state.fornitori[idx] = normalized;
      else window.state.fornitori.push(normalized);
      window.closeModal('modal-fornitore');
      renderFornitoriPage();
      window.showToast('Fornitore salvato', 'success');
    } catch (e) {
      window.showToast(e.message || 'Errore salvataggio fornitore', 'warning');
    }
  }

  function renderFornitoriStats() {
    const el = document.getElementById('fornitori-stats');
    if (!el) return;
    const rows = window.state.ordiniFornitori || [];
    const count = stato => rows.filter(o => o.stato === stato).length;
    el.innerHTML = [
      ['Da lavorare', count('richiesta'), 'var(--orange)'],
      ['In lavorazione', count('in_lavorazione'), 'var(--blue)'],
      ['Inviati', count('inviato'), 'var(--success)'],
      ['Fornitori', (window.state.fornitori || []).length, 'var(--accent)'],
    ].map(([label, value, color]) => `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="color:${color};">${value}</div>
      </div>
    `).join('');
  }

  function renderFornitoriList() {
    const el = document.getElementById('fornitori-list');
    if (!el) return;
    const q = String(document.getElementById('search-fornitori')?.value || '').trim().toLowerCase();
    let rows = [...(window.state.fornitori || [])];
    if (q) rows = rows.filter(f => [f.nome, f.localita, f.email, f.pec, f.contattoNome].join(' ').toLowerCase().includes(q));
    rows.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { sensitivity: 'base' }));
    el.innerHTML = rows.length ? rows.map(f => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--surface);">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13px;">${window.escapeHtml(f.nome)}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:2px;">${window.escapeHtml([f.localita, f.contattoNome].filter(Boolean).join(' - ') || '-')}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px;word-break:break-word;">${window.escapeHtml([f.email, f.pec].filter(Boolean).join(', ') || 'Nessuna email')}</div>
          </div>
          ${canManageOrdiniFornitori() ? `<button class="btn btn-outline btn-sm" onclick="openFornitoreModal(${f.id})">Mod</button>` : ''}
        </div>
      </div>
    `).join('') : '<div class="empty-state"><p>Nessun fornitore trovato</p></div>';
  }

  function renderOrdiniFornitoriTable() {
    const tbody = document.getElementById('ordini-fornitori-table');
    if (!tbody) return;
    const q = String(document.getElementById('search-ordini-fornitori')?.value || '').trim().toLowerCase();
    const stato = document.getElementById('filter-ordini-fornitori-stato')?.value || '';
    let rows = [...(window.state.ordiniFornitori || [])];
    if (stato) rows = rows.filter(o => o.stato === stato);
    if (q) {
      rows = rows.filter(o => [o.fornitoreNome, o.prodottoNome, o.noteMagazzino, o.noteOrdine, o.requestedByName].join(' ').toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      const ta = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
      const tb = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
      return tb - ta || Number(b.id) - Number(a.id);
    });
    tbody.innerHTML = rows.length ? rows.map(o => `
      <tr>
        <td>${statoBadge(o.stato)}</td>
        <td style="white-space:nowrap;">${window.formatDateTime(o.requestedAt)}</td>
        <td>
          <b>${window.escapeHtml(o.fornitoreNome || '-')}</b>
          ${o.fornitoreContatto ? `<div style="font-size:11px;color:var(--text3);">${window.escapeHtml(o.fornitoreContatto)}</div>` : ''}
        </td>
        <td>
          <div style="font-weight:700;">${window.escapeHtml(o.prodottoNome || '-')}</div>
          ${o.noteMagazzino ? `<div style="font-size:11px;color:var(--text2);max-width:300px;">${window.escapeHtml(o.noteMagazzino).slice(0, 120)}</div>` : ''}
        </td>
        <td style="font-family:'DM Mono',monospace;white-space:nowrap;">${formatQty(o.quantita)} ${window.escapeHtml(o.unitaMisura || '')}</td>
        <td>${window.escapeHtml(o.requestedByName || '-')}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="openOrdineFornitoreModal(${o.id})">${canManageOrdiniFornitori() && o.stato !== 'inviato' ? 'Gestisci' : 'Apri'}</button>
          ${canCancelOrdineFornitore(o) ? `<button class="btn btn-danger btn-sm" onclick="annullaOrdineFornitore(${o.id})">Annulla</button>` : ''}
        </td>
      </tr>
    `).join('') : '<tr><td colspan="7"><div class="empty-state"><p>Nessun ordine fornitore registrato</p></div></td></tr>';
  }

  async function renderFornitoriPage(options = {}) {
    if (!canUseOrdiniFornitori()) return;
    if (options.load) {
      try {
        await refreshFornitoriData();
      } catch (e) {
        window.showToast(e.message || 'Errore caricamento ordini fornitori', 'warning');
      }
    }
    const newBtn = document.querySelector('#page-fornitori .btn-green');
    if (newBtn) newBtn.style.display = canUseOrdiniFornitori() ? '' : 'none';
    const supplierBtn = document.querySelector('#page-fornitori .btn-outline[onclick="openFornitoreModal()"]');
    if (supplierBtn) supplierBtn.style.display = canManageFornitori() ? '' : 'none';
    renderFornitoriStats();
    renderOrdiniFornitoriTable();
    renderFornitoriList();
  }

  window.openOrdineFornitoreModal = openOrdineFornitoreModal;
  window.saveOrdineFornitore = saveOrdineFornitore;
  window.sendOrdineFornitoreEmail = sendOrdineFornitoreEmail;
  window.annullaOrdineFornitore = annullaOrdineFornitore;
  window.openFornitoreModal = openFornitoreModal;
  window.saveFornitore = saveFornitore;
  window.renderFornitoriPage = renderFornitoriPage;
  window.renderFornitoriList = renderFornitoriList;
  window.syncOrdineFornitoreRecipients = syncOrdineFornitoreRecipients;
  window.refreshFornitoriData = refreshFornitoriData;
})();
