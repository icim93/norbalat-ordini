let orderLines = [];
let selectedOrders = new Set();

function openNewOrder() {
  state.editingId = null;
  orderLines = [{ prodId: null, prodottoNomeLibero: '', qty: 1, prezzoUnitario: null }];
  document.getElementById('modal-ordine-title').textContent = 'Nuovo Ordine';
  document.getElementById('ord-data').value = today();
  document.getElementById('ord-stato').value = 'attesa';
  document.getElementById('ord-note').value = '';
  document.getElementById('ord-data-non-certa').checked = false;
  document.getElementById('ord-stef').checked = false;
  const altroVettoreEl = document.getElementById('ord-altro-vettore');
  if (altroVettoreEl) altroVettoreEl.checked = false;
  const giroOverrideEl = document.getElementById('ord-giro-override');
  if (giroOverrideEl) giroOverrideEl.value = '';
  acState.cliente = { value: null, query: '', focusIdx: -1 };
  const defaultAgente = state.currentUser.isAgente ? state.currentUser.id : null;
  populateOrderSelects(null, defaultAgente);
  renderOrderLines();
  openModal('modal-ordine');
  // focus rimosso: apriva automaticamente il dropdown cliente
}

function openEditOrder(id) {
  const o = state.ordini.find(x => x.id === id);
  state.editingId = id;
  orderLines = o.linee.map(l => ({
    prodId: l.prodId,
    prodottoNomeLibero: l.prodottoNomeLibero || '',
    qty: l.qty,
    prezzoUnitario: (l.prezzoUnitario !== undefined && l.prezzoUnitario !== null) ? Number(l.prezzoUnitario) : null,
    isPedana: !!l.isPedana,
    notaRiga: l.notaRiga||'',
    unitaMisura: l.unitaMisura||'pezzi',
    pesoEffettivo: l.pesoEffettivo||null,
  }));
  document.getElementById('modal-ordine-title').textContent = `Modifica Ordine #${id}`;
  document.getElementById('ord-data').value = o.data;
  document.getElementById('ord-stato').value = o.stato;
  document.getElementById('ord-note').value = o.note;
  document.getElementById('ord-data-non-certa').checked = o.dataNonCerta || false;
  document.getElementById('ord-stef').checked = o.stef || false;
  const altroVettoreEl = document.getElementById('ord-altro-vettore');
  if (altroVettoreEl) altroVettoreEl.checked = o.altroVettore || false;
  const giroOverrideEl = document.getElementById('ord-giro-override');
  acState.cliente = { value: o.clienteId, query: '', focusIdx: -1 };
  populateOrderSelects(o.clienteId, o.agenteId);
  if (giroOverrideEl) giroOverrideEl.value = o.giroOverride || '';
  if (o.autistaDiGiro) document.getElementById('ord-autista-di-giro').value = o.autistaDiGiro;
  updateConsegnatarioDisplay(o.clienteId);
  renderOrderLines();
  openModal('modal-ordine');
}

// ═══════════════════════════════════════════════
// AUTOCOMPLETE ENGINE
// ═══════════════════════════════════════════════

const acState = {
  cliente: { value: null, query: '', focusIdx: -1 },
  // per prodotti nelle righe ordine usiamo un sistema simile ma per riga
};

function acHighlight(text, query) {
  if (!query) return text;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function acFilter(type) {
  if (type === 'cliente') {
    const q = document.getElementById('ac-cliente-input').value.trim().toLowerCase();
    acState.cliente.query = q;
    acState.cliente.value = null;
    document.getElementById('ord-cliente').value = '';
    document.getElementById('ac-cliente-input')?.classList.remove('has-value');
    acRender('cliente');
    acOpen('cliente');
    document.getElementById('ord-cliente-note-box').style.display = 'none';
  } else if (type === 'tentata') {
    const q = document.getElementById('ac-tentata-input').value.trim().toLowerCase();
    if (!acState.tentata) acState.tentata = { value: null, query: '', focusIdx: -1 };
    acState.tentata.query = q;
    acState.tentata.value = null;
    document.getElementById('tentata-cliente').value = '';
    acRender('tentata');
    acOpen('tentata');
  } else if (type === 'cat-cliente') {
    const q = document.getElementById('ac-cat-cliente-input').value.trim().toLowerCase();
    if (!acState['cat-cliente']) acState['cat-cliente'] = { value: null, query: '', focusIdx: -1 };
    acState['cat-cliente'].query = q;
    acState['cat-cliente'].value = null;
    document.getElementById('cat-cliente').value = '';
    document.getElementById('ac-cat-cliente-input')?.classList.remove('has-value');
    acRender('cat-cliente');
    acOpen('cat-cliente');
    document.getElementById('cat-cliente-note-box').style.display = 'none';
  }
}

function acOpen(type) {
  if (type === 'cliente') {
    acRender('cliente');
    document.getElementById('ac-cliente-dd').classList.add('open');
    acState.cliente.focusIdx = -1;
  } else if (type === 'tentata') {
    acRender('tentata');
    document.getElementById('ac-tentata-dd').classList.add('open');
    if (!acState.tentata) acState.tentata = { value: null, query: '', focusIdx: -1 };
    acState.tentata.focusIdx = -1;
  } else if (type === 'cat-cliente') {
    acRender('cat-cliente');
    document.getElementById('ac-cat-cliente-dd').classList.add('open');
    if (!acState['cat-cliente']) acState['cat-cliente'] = { value: null, query: '', focusIdx: -1 };
    acState['cat-cliente'].focusIdx = -1;
  }
}

function acClose(type) {
  if (type === 'cliente') {
    document.getElementById('ac-cliente-dd').classList.remove('open');
  } else if (type === 'tentata') {
    document.getElementById('ac-tentata-dd').classList.remove('open');
  } else if (type === 'cat-cliente') {
    document.getElementById('ac-cat-cliente-dd').classList.remove('open');
  }
}

function acRender(type) {
  if (type === 'cat-cliente') {
    if (!acState['cat-cliente']) acState['cat-cliente'] = { value: null, query: '', focusIdx: -1 };
    const q = acState['cat-cliente'].query;
    const dd = document.getElementById('ac-cat-cliente-dd');
    if (!dd) return;
    const giri = ['bari nord','bari/foggia','murgia','taranto','lecce','lecce est','valle itria','calabria','foggia','diretto','stef','variabile',''];
    let html = '';
    let totalShown = 0;
    giri.forEach(g => {
      let gruppo = clientiOrdinabili().filter(c => c.giro === g);
      if (q) gruppo = gruppo.filter(c => c.nome.toLowerCase().includes(q) || c.localita.toLowerCase().includes(q));
      if (!gruppo.length) return;
      html += `<div class="ac-group-label">${g ? g.toUpperCase() : 'NON ASSEGNATO'}</div>`;
      gruppo.forEach(cl => {
        html += `<div class="ac-item" data-id="${cl.id}" onmousedown="acSelect('cat-cliente',${cl.id})">
          <span>${acHighlight(cl.nome, q)}</span>
          <span class="ac-sub">${cl.localita}${cl.giro ? ' · ' + cl.giro : ''}</span>
        </div>`;
        totalShown++;
      });
    });
    if (!totalShown) html = '<div class="ac-empty">Nessun cliente trovato</div>';
    dd.innerHTML = html;
    return;
  }
  if (type === 'tentata') {
    if (!acState.tentata) acState.tentata = { value: null, query: '', focusIdx: -1 };
    const q = acState.tentata.query;
    const dd = document.getElementById('ac-tentata-dd');
    if (!dd) return;
    let clienti = clientiOrdinabili();
    if (q) clienti = clienti.filter(c => c.nome.toLowerCase().includes(q) || c.localita.toLowerCase().includes(q));
    dd.innerHTML = clienti.slice(0,15).map(c => `
      <div class="ac-item" data-id="${c.id}" onmousedown="acSelect('tentata',${c.id})">
        <span>${acHighlight(c.nome, q)}</span>
        <span class="ac-sub">${c.localita}${c.giro ? ' · ' + c.giro : ''}</span>
      </div>`).join('') || '<div class="ac-empty">Nessun cliente trovato</div>';
    return;
  }
  if (type !== 'cliente') return;
  const q = acState.cliente.query;
  const dd = document.getElementById('ac-cliente-dd');

  const giri = ['bari nord','bari/foggia','murgia','taranto','lecce','lecce est','valle itria','calabria','foggia','diretto','stef','variabile',''];
  let html = '';
  let totalShown = 0;

  giri.forEach(g => {
    let gruppo = clientiOrdinabili().filter(c => c.giro === g);
    if (q) gruppo = gruppo.filter(c =>
      c.nome.toLowerCase().includes(q) ||
      c.localita.toLowerCase().includes(q)
    );
    if (!gruppo.length) return;
    html += `<div class="ac-group-label">${g ? g.toUpperCase() : 'NON ASSEGNATO'}</div>`;
    gruppo.forEach(c => {
      html += `<div class="ac-item" data-id="${c.id}" onmousedown="acSelect('cliente',${c.id})">
        <span>${acHighlight(c.nome, q)}</span>
        <span class="ac-sub">${c.localita}${c.giro ? ' · ' + c.giro : ''}</span>
      </div>`;
      totalShown++;
    });
  });

  if (!totalShown) html = '<div class="ac-empty">Nessun cliente trovato</div>';
  dd.innerHTML = html;
}

function acSelect(type, id) {
  if (type === 'cliente') {
    const c = state.clienti.find(x => x.id === id);
    if (!c) return;
    if (!isClienteSbloccato(c)) { showToast('Cliente non ancora approvato dall’amministrazione', 'warning'); return; }
    acState.cliente.value = id;
    document.getElementById('ac-cliente-input').value = c.nome;
    document.getElementById('ac-cliente-input').classList.add('has-value');
    document.getElementById('ord-cliente').value = id;
    acClose('cliente');

    // Mostra note fisse cliente se presenti
    const noteBox = document.getElementById('ord-cliente-note-box');
    const noteText = document.getElementById('ord-cliente-note-text');
    if (noteBox && noteText) {
      if (c.note && c.note.trim()) {
        noteText.textContent = c.note;
        noteBox.style.display = 'block';
      } else {
        noteBox.style.display = 'none';
      }
    } else {
      document.getElementById('ord-cliente-note-box').style.display = 'none';
    }

    // Imposta agente di default dal cliente
    if (c.agenteId) {
      const selAg = document.getElementById('ord-agente');
      if (selAg) selAg.value = c.agenteId;
    }
    const giroOverrideEl = document.getElementById('ord-giro-override');
    if (giroOverrideEl && !state.editingId) giroOverrideEl.value = '';
    updateConsegnatarioDisplay(id);

    // Pre-imposta data dalla prossima data utile del giro del cliente
    if (c.giro && !state.editingId) {
      const nextDate = getNextGiroDate(c.giro);
      if (nextDate) {
        document.getElementById('ord-data').value = nextDate;
      }
    }

    // Ri-renderizza righe prodotto per aggiornare lo storico del cliente
    renderOrderLines();
    // Se c'è solo una riga vuota, apri subito il dropdown con lo storico
    setTimeout(() => {
      if (orderLines.length === 1 && !orderLines[0].prodId) {
        acProdOpen(0);
      }
    }, 60);
  } else if (type === 'tentata') {
    const c = state.clienti.find(x => x.id === id);
    if (!c) return;
    if (!isClienteSbloccato(c)) { showToast('Cliente non ancora approvato dall’amministrazione', 'warning'); return; }
    if (!acState.tentata) acState.tentata = { value: null, query: '', focusIdx: -1 };
    acState.tentata.value = id;
    document.getElementById('ac-tentata-input').value = c.nome;
    document.getElementById('tentata-cliente').value = id;
    acClose('tentata');
  } else if (type === 'cat-cliente') {
    const cl = state.clienti.find(x => x.id === id);
    if (!cl) return;
    if (!isClienteSbloccato(cl)) { showToast('Cliente non ancora approvato dall’amministrazione', 'warning'); return; }
    if (!acState['cat-cliente']) acState['cat-cliente'] = { value: null, query: '', focusIdx: -1 };
    acState['cat-cliente'].value = id;
    const inp = document.getElementById('ac-cat-cliente-input');
    if (inp) { inp.value = cl.nome; inp.classList.add('has-value'); }
    document.getElementById('cat-cliente').value = id;
    acClose('cat-cliente');
    // Note cliente
    const nb = document.getElementById('cat-cliente-note-box');
    const nt = document.getElementById('cat-cliente-note-text');
    if (nb && nt) {
      if (cl.note && cl.note.trim()) { nt.textContent = cl.note; nb.style.display = 'block'; }
      else nb.style.display = 'none';
    }
    // Agente default
    if (cl.agenteId) {
      const sel = document.getElementById('cat-agente');
      if (sel) sel.value = cl.agenteId;
    }
    const giroSel = document.getElementById('cat-giro-override');
    if (giroSel && !state.editingId) giroSel.value = '';
    // Data dal giro
    if (cl.giro && !state.editingId) {
      const nd = getNextGiroDate(cl.giro);
      if (nd) document.getElementById('cat-data').value = nd;
    }
    // Aggiorna catalogo con storico cliente
    catRenderCategorie();
  }
}

function acKey(e, type) {
  const dd = document.getElementById(`ac-${type}-dd`);
  if (!dd) return;
  const items = dd.querySelectorAll('.ac-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acState[type].focusIdx = Math.min(acState[type].focusIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('focused', i === acState[type].focusIdx));
    items[acState[type].focusIdx]?.scrollIntoView({block:'nearest'});
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acState[type].focusIdx = Math.max(acState[type].focusIdx - 1, 0);
    items.forEach((el, i) => el.classList.toggle('focused', i === acState[type].focusIdx));
    items[acState[type].focusIdx]?.scrollIntoView({block:'nearest'});
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (acState[type].focusIdx >= 0) {
      const id = parseInt(items[acState[type].focusIdx].dataset.id);
      acSelect(type, id);
    }
  } else if (e.key === 'Escape') {
    acClose(type);
  }
}

// Chiudi dropdown cliccando fuori
document.addEventListener('click', function(e) {
  if (!e.target.closest('#ac-cliente-wrap')) acClose('cliente');
  if (!e.target.closest('#ac-tentata-wrap')) acClose('tentata');
  if (!e.target.closest('#ac-cat-cliente-wrap')) acClose('cat-cliente');
});

// ═══════════════════════════════════════════════
// AUTOCOMPLETE PER RIGHE PRODOTTO
// ═══════════════════════════════════════════════

function getDefaultUM(prodotto) {
  if (!prodotto) return 'Pezzi';
  const cat = (prodotto.categoria || '').toUpperCase();
  if (cat.includes('PANNA')) return 'Cartoni';
  return 'Pezzi';
}

function umPlurale(um, qty) {
  const q = parseInt(qty) || 1;
  const map = {
    'Pezzi':   q === 1 ? 'Pezzo'    : 'Pezzi',
    'Cartoni': q === 1 ? 'Cartone'  : 'Cartoni',
    'Litri':   'Litri',
    'Kg':      'Kg',
    'Pedana':  q === 1 ? 'Pedana'   : 'Pedane',
  };
  return map[um] || um;
}

function getLastPriceForClienteProd(clienteId, prodId) {
  if (!clienteId || !prodId) return null;
  const orders = [...state.ordini]
    .filter(o => o.clienteId === clienteId)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || (b.id - a.id));
  for (const o of orders) {
    const r = (o.linee || []).find(x => x.prodId === prodId && x.prezzoUnitario !== null && x.prezzoUnitario !== undefined);
    if (r) return Number(r.prezzoUnitario);
  }
  return null;
}

function resolveDefaultLinePrice(line, clienteId, dataOrdine) {
  if (!line?.prodId) return 0;
  const fromListino = getListinoPrezzo(line.prodId, clienteId, dataOrdine);
  if (fromListino !== null && fromListino !== undefined) return Number(fromListino);
  const last = getLastPriceForClienteProd(clienteId, line.prodId);
  if (last !== null && last !== undefined) return Number(last);
  return 0;
}

function renderOrderLines() {
  const container = document.getElementById('ord-lines-container');
  const clienteId = parseInt(document.getElementById('ord-cliente')?.value || acState.cliente?.value || 0) || null;
  const dataOrdine = document.getElementById('ord-data')?.value || today();
  let totale = 0;
  let righeConPrezzo = 0;
  container.innerHTML = orderLines.map((l, i) => {
    const p = l.prodId ? getProdotto(l.prodId) : null;
    const umOpts = ['Pezzi','Cartoni','Litri','Kg','Pedana'];
    const curUM = l.unitaMisura || (p ? getDefaultUM(p) : 'Pezzi');
    const isPedana = curUM === 'Pedana';
    const prezzoListino = p ? getListinoPrezzo(p.id, clienteId, dataOrdine) : null;
    const prezzo = Number.isFinite(Number(l.prezzoUnitario)) ? Number(l.prezzoUnitario) : null;
    const qty = Number(l.qty || 0);
    const subtot = (prezzo !== null && Number.isFinite(qty)) ? prezzo * qty : null;
    if (subtot !== null) { totale += subtot; righeConPrezzo++; }
    return `
    <div class="order-line" id="ord-line-${i}">
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="ac-wrap" style="flex:1;min-width:0;position:relative;">
          <input type="text" class="ac-input${p ? ' has-value' : ''}"
            id="ac-prod-input-${i}"
            value="${p ? '['+p.codice+'] '+p.nome : ''}"
            placeholder="Cerca codice o nome prodotto..."
            autocomplete="off"
            oninput="acProdFilter(${i})"
            onfocus="acProdOpen(${i})"
            onkeydown="acProdKey(event,${i})"
            style="width:100%;">
          <div class="ac-dropdown" id="ac-prod-dd-${i}"></div>
        </div>
        <input type="number" class="qty-input" value="${l.qty||1}" min="1"
          onchange="orderLines[${i}].qty=parseInt(this.value)||1;renderOrderLines()"
          placeholder="Qta" style="width:56px;flex-shrink:0;">
        <select
          onchange="orderLines[${i}].unitaMisura=this.value;orderLines[${i}].isPedana=(this.value==='Pedana');orderLines[${i}]._umPersonalizzata=true;renderOrderLines()"
          style="flex-shrink:0;font-size:12px;padding:5px 6px;border:1.5px solid ${isPedana ? 'var(--accent)' : 'var(--border)'};border-radius:6px;background:${isPedana ? 'var(--accent-light)' : 'var(--surface2)'};color:var(--text1);cursor:pointer;max-width:92px;">
          ${umOpts.map(u => `<option value="${u}" ${u===curUM?'selected':''}>${umPlurale(u, l.qty||1)}</option>`).join('')}
        </select>
        <button class="line-delete" onclick="removeOrderLine(${i})" style="flex-shrink:0;width:32px;height:32px;border-radius:6px;border:none;background:transparent;cursor:pointer;font-size:16px;color:var(--text3);display:flex;align-items:center;justify-content:center;" title="Rimuovi">x</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 150px;gap:8px;margin-top:6px;">
        <input type="text" value="${l.prodottoNomeLibero||''}"
          placeholder="Prodotto libero (opzionale)"
          oninput="orderLines[${i}].prodottoNomeLibero=this.value"
          style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text1);width:100%;box-sizing:border-box;">
        <div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:2px;">Prezzo €</div>
          <input type="text" inputmode="decimal" value="${prezzo !== null ? prezzo.toFixed(2) : ''}"
            placeholder="0,00"
            oninput="const raw=String(this.value||'').trim();const norm=raw.replace(',','.');const n=Number(norm);orderLines[${i}].prezzoUnitario=(raw===''||!Number.isFinite(n)?null:n);"
            style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text1);width:100%;box-sizing:border-box;">
        </div>
      </div>
      ${p && p.packaging ? `<div style="font-size:11px;color:var(--text3);padding-left:2px;">${p.packaging}${isPedana ? ' - PEDANA INTERA' : ''}</div>` : (isPedana ? `<div style="font-size:11px;color:var(--accent);font-weight:600;">PEDANA INTERA</div>` : '')}
      ${p && p.note ? `<div style="font-size:11px;color:var(--blue);padding-left:2px;">${p.note}</div>` : ''}
      ${p ? `<div style="font-size:11px;color:var(--text2);padding-left:2px;">Listino: ${prezzoListino !== null ? eur(prezzoListino) : 'n.d.'}${subtot !== null ? ` - Subtotale: <b>${eur(subtot)}</b>` : ''}</div>` : ''}
      <input type="text" value="${l.notaRiga||''}"
        placeholder="Nota riga"
        oninput="orderLines[${i}].notaRiga=this.value"
        style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text1);width:100%;box-sizing:border-box;">
    </div>`;
  }).join('') || '<div style="padding:12px;color:var(--text3);font-size:13px;">Nessun prodotto aggiunto</div>';
  const summary = document.getElementById('ord-price-summary');
  if (summary) {
    if (!orderLines.length) {
      summary.textContent = '';
    } else {
      summary.innerHTML = `Totale stimato ordine: <b>${eur(totale)}</b>${(orderLines.length-righeConPrezzo)>0 ? ` - ${(orderLines.length-righeConPrezzo)} riga/e senza prezzo` : ''}`;
    }
  }
}

// Single delegated listener for closing prod dropdowns on outside click (set once)
if (!window._prodDdListenerSet) {
  window._prodDdListenerSet = true;
  document.addEventListener('click', function(e) {
    orderLines.forEach((_, i) => {
      const wrap = document.getElementById(`ord-line-${i}`);
      if (wrap && !wrap.contains(e.target)) {
        const dd = document.getElementById(`ac-prod-dd-${i}`);
        if (dd) dd.classList.remove('open');
      }
    });
  });
}

function acProdFilter(i) {
  const inp = document.getElementById(`ac-prod-input-${i}`);
  const dd = document.getElementById(`ac-prod-dd-${i}`);
  if (!inp || !dd) return;
  const q = inp.value.trim().toLowerCase();
  orderLines[i].prodId = null;
  inp.classList.remove('has-value');
  acProdRender(i, q);
  dd.classList.add('open');
}

function acProdOpen(i) {
  const inp = document.getElementById(`ac-prod-input-${i}`);
  const dd = document.getElementById(`ac-prod-dd-${i}`);
  if (!inp || !dd) return;
  const q = inp.value.trim().toLowerCase();
  acProdRender(i, q);
  dd.classList.add('open');
}

// Ritorna i prodotti ordinati dal cliente, ordinati per frequenza (più ordinato = primo)
// Esclude i prodotti già selezionati nelle righe correnti
function getClienteStoricoProdotti(clienteId, escludiProdIds = []) {
  if (!clienteId) return [];

  // Conta quante volte ogni prodotto è stato ordinato da questo cliente
  const freq = {};
  state.ordini
    .filter(o => o.clienteId === clienteId)
    .forEach(o => {
      o.linee.forEach(l => {
        if (!l.prodId) return;
        freq[l.prodId] = (freq[l.prodId] || 0) + 1;
      });
    });

  return Object.entries(freq)
    .filter(([id]) => !escludiProdIds.includes(parseInt(id)))
    .sort(([, a], [, b]) => b - a)           // più frequenti prima
    .slice(0, 8)                              // max 8 suggeriti
    .map(([id, count]) => ({ prodotto: getProdotto(parseInt(id)), count }))
    .filter(x => x.prodotto.id);             // scarta eventuali id non trovati
}

function acProdRender(i, q) {
  const dd = document.getElementById(`ac-prod-dd-${i}`);
  if (!dd) return;

  // Prodotti già selezionati nelle altre righe (per non riproporre duplicati nello storico)
  const giaScelti = orderLines
    .filter((l, idx) => idx !== i && l.prodId)
    .map(l => l.prodId);

  let html = '';
  let total = 0;

  // ── SEZIONE STORICO CLIENTE (solo senza query, se cliente selezionato) ──
  const clienteId = acState.cliente.value;
  if (!q && clienteId) {
    const storico = getClienteStoricoProdotti(clienteId, giaScelti);
    if (storico.length) {
      html += `<div class="ac-group-label" style="background:linear-gradient(90deg,#e8f5e9,var(--surface2));color:var(--accent);">⭐ Prodotti abituali</div>`;
      storico.forEach(({ prodotto: p, count }) => {
        html += `<div class="ac-item" data-id="${p.id}" onmousedown="acProdSelect(${i},${p.id})">
          <span>
            <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text3);">[${p.codice}]</span>
            ${p.nome}
            <span class="ac-freq">×${count}</span>
          </span>
          <span class="ac-sub">${p.categoria} · ${p.um}${p.packaging ? ' · ' + p.packaging : ''}</span>
        </div>`;
        total++;
      });
      html += `<div class="ac-group-label" style="font-size:9px;letter-spacing:0.5px;">TUTTI I PRODOTTI</div>`;
    }
  }

  // ── SEZIONE TUTTI I PRODOTTI (filtrati per query se presente) ──
  const cats = ['FORMAGGI','RICOTTA','CAGLIATA','PANNA UHT','ALTRO'];
  // ID già mostrati nello storico (per non duplicarli)
  const storicoIds = (!q && clienteId)
    ? getClienteStoricoProdotti(clienteId, giaScelti).map(x => x.prodotto.id)
    : [];

  cats.forEach(cat => {
    let gruppo = state.prodotti.filter(p => p.categoria === cat && !storicoIds.includes(p.id));
    if (q) gruppo = gruppo.filter(p =>
      p.codice.toLowerCase().includes(q) ||
      p.nome.toLowerCase().includes(q)
    );
    if (!gruppo.length) return;
    if (!q) html += `<div class="ac-group-label">${cat}</div>`;
    else html += `<div class="ac-group-label">${cat}</div>`;
    gruppo.forEach(p => {
      html += `<div class="ac-item" data-id="${p.id}" onmousedown="acProdSelect(${i},${p.id})">
        <span><span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text3);">[${p.codice}]</span> ${acHighlight(p.nome, q)}</span>
        <span class="ac-sub">${p.categoria} · ${p.um}${p.packaging ? ' · ' + p.packaging : ''}</span>
      </div>`;
      total++;
    });
  });

  if (!total && !html.includes('ac-item')) html = '<div class="ac-empty">Nessun prodotto trovato</div>';
  dd.innerHTML = html;
}

function acProdSelect(i, prodId) {
  orderLines[i].prodId = prodId;
  orderLines[i].prodottoNomeLibero = '';
  const p = getProdotto(prodId);
  // Imposta UM di default in base alla categoria, solo se non già personalizzata dall'utente
  if (!orderLines[i]._umPersonalizzata) {
    orderLines[i].unitaMisura = getDefaultUM(p);
    orderLines[i].isPedana = false;
  }
  const clienteId = parseInt(document.getElementById('ord-cliente')?.value || acState.cliente?.value || 0) || null;
  const dataOrdine = document.getElementById('ord-data')?.value || today();
  orderLines[i].prezzoUnitario = resolveDefaultLinePrice(orderLines[i], clienteId, dataOrdine);
  const inp = document.getElementById(`ac-prod-input-${i}`);
  if (inp) { inp.value = `[${p.codice}] ${p.nome}`; inp.classList.add('has-value'); }
  document.getElementById(`ac-prod-dd-${i}`)?.classList.remove('open');
  renderOrderLines();
  const inp2 = document.getElementById(`ac-prod-input-${i}`);
  if (inp2) { inp2.value = `[${p.codice}] ${p.nome}`; inp2.classList.add('has-value'); }
}

function acProdKey(e, i) {
  const dd = document.getElementById(`ac-prod-dd-${i}`);
  const items = dd?.querySelectorAll('.ac-item') || [];
  let idx = parseInt(dd?.dataset.focus || '-1');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(idx + 1, items.length - 1);
    dd.dataset.focus = idx;
    items.forEach((el, j) => el.classList.toggle('focused', j === idx));
    items[idx]?.scrollIntoView({block:'nearest'});
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(idx - 1, 0);
    dd.dataset.focus = idx;
    items.forEach((el, j) => el.classList.toggle('focused', j === idx));
    items[idx]?.scrollIntoView({block:'nearest'});
  } else if (e.key === 'Enter' && idx >= 0) {
    e.preventDefault();
    const id = parseInt(items[idx].dataset.id);
    acProdSelect(i, id);
  } else if (e.key === 'Escape') {
    dd?.classList.remove('open');
  }
}

function addOrderLine() {
  orderLines.push({ prodId: null, prodottoNomeLibero: '', qty: 1, prezzoUnitario: null });
  renderOrderLines();
  // Focus sul nuovo campo
  setTimeout(() => document.getElementById(`ac-prod-input-${orderLines.length-1}`)?.focus(), 50);
}

function removeOrderLine(i) {
  orderLines.splice(i, 1);
  renderOrderLines();
}

function getAutistaDiGiro(giro) {
  return state.utenti.find(u => u.ruolo === 'autista' && (u.giriConsegna||[]).includes(giro)) || null;
}

function updateConsegnatarioDisplay(clienteId) {
  const c = clienteId ? getCliente(clienteId) : null;
  const giroOverride = (document.getElementById('ord-giro-override')?.value || '').trim();
  const giroRef = giroOverride || c?.giro || '';
  const aut = giroRef ? getAutistaDiGiro(giroRef) : null;
  const box = document.getElementById('ord-consegnatario-nome');
  const hidden = document.getElementById('ord-autista-di-giro');
  if (!box) return;
  if (aut) {
    box.textContent = (aut.nome + ' ' + (aut.cognome||'')).trim();
    box.style.color = 'var(--text1)';
    if (hidden) hidden.value = aut.id;
  } else {
    box.textContent = c ? '— nessun autista per questo giro' : '—';
    box.style.color = 'var(--text3)';
    if (hidden) hidden.value = '';
  }
}

function populateOrderSelects(clienteId, agenteId) {
  // Agenti commerciali: tutti con isAgente=true
  const agenti = state.utenti.filter(u => u.isAgente);
  const selAgente = document.getElementById('ord-agente');
  selAgente.innerHTML = '<option value="">— Seleziona agente —</option>' + agenti.map(a =>
    `<option value="${a.id}" ${a.id==agenteId?'selected':''}>${(a.nome+' '+(a.cognome||'')).trim()}</option>`
  ).join('');

  // Consegnatario auto dal giro del cliente
  updateConsegnatarioDisplay(clienteId);
  const giroSel = document.getElementById('ord-giro-override');
  if (giroSel) {
    const giri = [...new Set(state.giriCalendario.map(g => (g.giro || '').trim()).filter(Boolean))].sort();
    giroSel.innerHTML = '<option value="">Usa giro cliente</option>' + giri.map(g => `<option value="${g}">${g}</option>`).join('');
  }

  // Autocomplete cliente
  const inp = document.getElementById('ac-cliente-input');
  if (!inp) return;
  if (clienteId) {
    const c = getCliente(clienteId);
    inp.value = c.nome;
    inp.classList.add('has-value');
    document.getElementById('ord-cliente').value = clienteId;
    acState.cliente.value = clienteId;
    // Pre-seleziona agente del cliente se non già impostato
    if (!agenteId && c.agenteId) {
      selAgente.value = c.agenteId;
    }
    const noteBox = document.getElementById('ord-cliente-note-box');
    const noteText = document.getElementById('ord-cliente-note-text');
    if (noteBox && noteText) {
      if (c.note && c.note.trim()) {
        noteText.textContent = c.note;
        noteBox.style.display = 'block';
      } else {
        noteBox.style.display = 'none';
      }
    }
  } else {
    inp.value = '';
    inp.classList.remove('has-value');
    const ordCliente = document.getElementById('ord-cliente');
    if (ordCliente) ordCliente.value = '';
    acState.cliente.value = null;
    document.getElementById('ord-cliente-note-box').style.display = 'none';
  }

  if (!agenteId && state.currentUser.ruolo === 'autista') {
    selAgente.value = state.currentUser.id;
  }
}


async function saveOrder() {
  const clienteId   = parseInt(document.getElementById('ord-cliente').value);
  const agenteId    = parseInt(document.getElementById('ord-agente').value) || null;
  const autistaDiGiro = parseInt(document.getElementById('ord-autista-di-giro').value) || null;
  const data        = document.getElementById('ord-data').value;
  const stato       = document.getElementById('ord-stato').value;
  const note        = document.getElementById('ord-note').value.trim();
  const dataNonCerta= document.getElementById('ord-data-non-certa').checked;
  const stef        = document.getElementById('ord-stef')?.checked || false;
  const altroVettore = document.getElementById('ord-altro-vettore')?.checked || false;
  const giroOverride = (document.getElementById('ord-giro-override')?.value || '').trim();

  if (!clienteId) { showToast('Seleziona un cliente', 'warning'); return; }
  const cliente = getCliente(clienteId);
  if (!isClienteSbloccato(cliente)) { showToast('Cliente non ancora approvato dall’amministrazione', 'warning'); return; }
  if (!data)      { showToast('Inserisci la data', 'warning'); return; }

  const linee = orderLines
    .filter(l => (l.prodId || String(l.prodottoNomeLibero || '').trim()) && Number(l.qty) > 0)
    .map(l => ({
      prodotto_id: l.prodId || null,
      prodotto_nome_libero: String(l.prodottoNomeLibero || '').trim(),
      qty: l.qty,
      prezzo_unitario: Number.isFinite(Number(l.prezzoUnitario)) ? Number(l.prezzoUnitario) : null,
      is_pedana: !!l.isPedana,
      nota_riga: l.notaRiga||'',
      unita_misura: l.unitaMisura||'pezzi'
    }));
  
  if (!linee.length) {
    showToast('Aggiungi almeno un prodotto', 'warning');
    return;
  }

  const body = { cliente_id: clienteId, agente_id: agenteId, autista_di_giro: autistaDiGiro,
                 data, stato, note, data_non_certa: dataNonCerta, stef, altro_vettore: altroVettore, giro_override: giroOverride, linee };
  try {
    let saved;
    if (state.editingId) {
      saved = await api('PUT', `/api/ordini/${state.editingId}`, body);
    } else {
      saved = await api('POST', '/api/ordini', body);
    }
    // Aggiorna state locale
    const normalized = normalizeOrdine(saved);
    if (state.editingId) {
      const idx2 = state.ordini.findIndex(o => o.id === state.editingId);
      if (idx2 !== -1) state.ordini[idx2] = normalized;
      else state.ordini.unshift(normalized);
    } else {
      state.ordini.unshift(normalized);
    }
    closeModal('modal-ordine');
    showToast(state.editingId ? 'Ordine aggiornato ✅' : 'Ordine salvato ✅', 'success');
    state.editingId = null;
    renderPage(state.currentPage);
  } catch(e) {
    showToast(e.message || 'Errore salvataggio', 'warning');
  }
}

async function deleteOrder(id) {
  id = parseInt(id);
  const o = state.ordini.find(x => x.id === id);
  const nome = o ? getCliente(o.clienteId).nome : '?';
  if (!await customConfirm(`Eliminare ordine #${id} (${nome})?`)) return;
  try {
    await api('DELETE', `/api/ordini/${id}`);
    state.ordini = state.ordini.filter(x => x.id !== id);
    showToast('Ordine eliminato');
    renderPage(state.currentPage);
  } catch(e) { showToast(e.message, 'warning'); }
}

// ═══════════════════════════════════════════════
// DETTAGLIO ORDINE
// ═══════════════════════════════════════════════

function openDettaglio(id) {
  const o = state.ordini.find(x => x.id === id);
  const c = getCliente(o.clienteId);
  const a = getAgente(o.agenteId);
  const cons = o.autistaDiGiro ? getAgente(o.autistaDiGiro) : null;

  document.getElementById('det-title').textContent = `Ordine #${o.id} — ${c.nome}`;

  document.getElementById('det-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px;">Cliente</div>
        <div style="font-weight:600;">${c.nome}</div>
        <div style="font-size:13px;color:var(--text2);">${c.localita}${c.giro ? ` — giro: ${c.giro}` : ''}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px;">Agente</div>
        <div style="font-weight:600;">${(a.nome+' '+(a.cognome||'')).trim()}</div>
        <div style="font-size:13px;color:var(--text2);">${formatDate(o.data)}</div>
      </div>
    </div>
    <div style="margin-bottom:14px;">${statoBadge(o.stato)}</div>
    <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px;">Prodotti ordinati</div>
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      ${o.linee.map(l => {
        const p = l.prodId ? getProdotto(l.prodId) : null;
        const nome = l.prodottoNomeLibero || p?.nome || 'Prodotto libero';
        const codice = p?.codice || 'LIB';
        const um = l.unitaMisura || p?.um || 'pz';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);font-size:14px;">
          <div>
            <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text3);margin-right:8px;">[${codice}]</span>
            <span>${nome}</span>
            ${p?.packaging ? `<div style="font-size:11px;color:var(--text3);">📦 ${p.packaging}</div>` : ''}
          </div>
          <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);">${l.qty} ${um}</span>
        </div>`;
      }).join('')}
    </div>
    ${o.note ? `<div style="margin-top:14px;padding:12px;background:var(--surface2);border-radius:8px;font-size:13px;color:var(--text2);"><b>Note:</b> ${o.note}</div>` : ''}
  `;

  const footer = document.getElementById('det-footer');
  const canConferma = o.stato !== 'consegnato' && o.stato !== 'annullato';
  footer.innerHTML = `
    <button class="btn btn-outline" onclick="closeModal('modal-dettaglio')">Chiudi</button>
    ${canConferma ? `<button class="btn btn-green" onclick="confermaConsegna(${o.id})">✅ Conferma Consegna</button>` : ''}
    ${canConferma ? `<button class="btn btn-outline" onclick="consegnaParziale(${o.id})">↪️ Consegna parziale</button>` : ''}
    <button class="btn btn-orange" onclick="closeModal('modal-dettaglio');openEditOrder(${o.id})">✏️ Modifica</button>
  `;

  openModal('modal-dettaglio');
}

async function confermaConsegna(id) {
  id = parseInt(id);
  try {
    await api('PATCH', `/api/ordini/${id}/stato`, { stato: 'consegnato' });
    const o = state.ordini.find(x => x.id === id);
    if (o) o.stato = 'consegnato';
    showToast('Consegna confermata! ✅', 'success');
    closeModal('modal-dettaglio');
    renderPage(state.currentPage);
  } catch(e) { showToast(e.message, 'warning'); }
}

async function consegnaParziale(id) {
  const o = state.ordini.find(x => x.id === id);
  if (!o) return;
  const delivered = {};
  for (const l of o.linee) {
    const nome = l.prodottoNomeLibero || getProdotto(l.prodId).nome;
    const v = prompt(`Quantità consegnata per ${nome} (ordinata: ${l.qty})`, String(l.qty));
    if (v === null) return;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > Number(l.qty)) {
      showToast(`Quantità non valida per ${nome}`, 'warning');
      return;
    }
    delivered[l.id] = n;
  }
  const note = prompt('Note consegna parziale (opzionale)', '') || '';
  const suggested = window.today();
  const preferredDateRaw = prompt(`Data riporto residuo (YYYY-MM-DD). Lascia vuoto per prossima consegna automatica`, suggested) || '';
  const preferredDate = preferredDateRaw.trim() || null;
  try {
    const r = await api('POST', `/api/ordini/${id}/consegna-parziale`, { delivered, note, preferred_date: preferredDate });
    showToast(`Consegna parziale registrata. Riporto su ordine #${r.new_order_id} (${r.next_date})`, 'success');
    await loadAllData();
    closeModal('modal-dettaglio');
    renderPage(state.currentPage);
  } catch (e) {
    showToast(e.message, 'warning');
  }
}

// ═══════════════════════════════════════════════
// AUTISTA VIEW
// ═══════════════════════════════════════════════


