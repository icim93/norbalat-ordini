function initReportDropdowns() {
  const defaultOpen = new Set(['chart-week', 'chart-agenti']);
  const defs = [
    { contentId: 'chart-week', toggleEl: () => document.querySelector('#chart-week')?.previousElementSibling },
    { contentId: 'chart-agenti', toggleEl: () => document.querySelector('#chart-agenti')?.previousElementSibling },
    { contentId: 'report-crm-weekly', toggleEl: () => document.querySelector('#report-crm-weekly')?.previousElementSibling },
    { contentId: 'report-crm-monthly', toggleEl: () => document.querySelector('#report-crm-monthly')?.previousElementSibling },
    { contentId: 'report-top-prodotti', toggleEl: () => document.querySelector('#report-top-prodotti')?.previousElementSibling },
    { contentId: 'report-giri', toggleEl: () => document.querySelector('#report-giri')?.previousElementSibling },
    { contentId: 'report-clienti-inattivi', toggleEl: () => document.querySelector('#report-clienti-inattivi')?.previousElementSibling },
    { contentId: 'report-agenti-clienti', toggleEl: () => document.querySelector('#report-agenti-clienti')?.previousElementSibling },
    { contentId: 'report-clienti-table', toggleEl: () => document.querySelector('#report-clienti-table')?.closest('.card')?.querySelector('.card-header') },
    { contentId: 'activity-log-list', toggleEl: () => document.querySelector('#activity-log-list')?.previousElementSibling },
  ];
  defs.forEach(def => {
    const content = document.getElementById(def.contentId);
    const toggle = def.toggleEl();
    if (!content || !toggle) return;
    if (!content.dataset.reportOpen) content.dataset.reportOpen = defaultOpen.has(def.contentId) ? '1' : '0';
    if (!toggle.dataset.reportReady) {
      toggle.dataset.reportReady = '1';
      toggle.style.cursor = 'pointer';
      toggle.onclick = (ev) => {
        if (ev.target.closest('button')) return;
        const willOpen = content.dataset.reportOpen !== '1';
        content.dataset.reportOpen = willOpen ? '1' : '0';
        content.style.display = willOpen ? '' : 'none';
        const ind = toggle.querySelector('.report-toggle-ind');
        if (ind) ind.textContent = willOpen ? '▾' : '▸';
      };
      const ind = document.createElement('span');
      ind.className = 'report-toggle-ind';
      ind.textContent = content.dataset.reportOpen === '1' ? '▾' : '▸';
      ind.style.marginLeft = '8px';
      ind.style.fontSize = '12px';
      ind.style.color = 'var(--text3)';
      toggle.appendChild(ind);
    }
    content.style.display = content.dataset.reportOpen === '1' ? '' : 'none';
  });
}

const reportDataCache = {};

function isMagazzinoReportOnly() {
  return state.currentUser?.ruolo === 'magazzino';
}

function setAllReportSections(open) {
  const ids = ['chart-week', 'chart-agenti', 'report-crm-weekly', 'report-crm-monthly', 'report-top-prodotti', 'report-giri', 'report-clienti-inattivi', 'report-agenti-clienti', 'report-clienti-table', 'activity-log-list'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.dataset.reportOpen = open ? '1' : '0';
    el.style.display = open ? '' : 'none';
    const toggle = el.previousElementSibling || el.closest('.card')?.querySelector('.card-header');
    const ind = toggle?.querySelector('.report-toggle-ind');
    if (ind) ind.textContent = open ? '▾' : '▸';
  });
}

function toggleReportStatsVisibility(showStats) {
  const page = document.getElementById('page-report');
  if (!page) return;
  page.querySelectorAll('.report-grid').forEach((grid) => {
    grid.style.display = showStats ? '' : 'none';
  });
  const filters = document.getElementById('report-filters-card');
  if (filters) filters.style.display = showStats ? '' : 'none';
}

function ensureMagazzinoPdfCard() {
  const page = document.getElementById('page-report');
  if (!page) return null;
  let card = document.getElementById('report-magazzino-pdf-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'report-magazzino-pdf-card';
    card.className = 'card';
    card.style.maxWidth = '980px';
    card.style.marginTop = '12px';
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">PDF Ordini Magazzino</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="renderMagazzinoPdfPreviewInline()">Aggiorna anteprima</button>
          <button class="btn btn-green btn-sm" onclick="openPDFGiornaliero()">Apri pannello PDF</button>
        </div>
      </div>
      <div id="report-magazzino-pdf-preview" style="padding:12px 16px;color:var(--text2);font-size:13px;">Anteprima non caricata.</div>
    `;
    page.appendChild(card);
  }
  card.style.display = '';
  return card;
}

function hideMagazzinoPdfCard() {
  const card = document.getElementById('report-magazzino-pdf-card');
  if (card) card.style.display = 'none';
}

function renderMagazzinoPdfPreviewInline() {
  const previewBox = document.getElementById('report-magazzino-pdf-preview');
  if (!previewBox) return;
  const dataEl = document.getElementById('pdf-data');
  if (dataEl) dataEl.value = today();
  const mag = document.querySelector('input[name="pdf-tipo"][value="magazzino"]');
  if (mag) mag.checked = true;
  if (typeof updatePDFPreview === 'function') updatePDFPreview();
  const src = document.getElementById('pdf-preview');
  previewBox.innerHTML = src?.innerHTML || '<span style="color:var(--text3);">Nessuna anteprima disponibile.</span>';
}

function reportFilterStorageKey() {
  return 'report_filters_' + (state.currentUser?.id || 'default');
}

function ensureReportToolbar() {
  if (isMagazzinoReportOnly()) return;
  const page = document.getElementById('page-report');
  if (!page) return;
  const existing = document.getElementById('report-filters-card');
  if (existing) return;
  const firstGrid = page.querySelector('.report-grid');
  if (!firstGrid) return;
  const card = document.createElement('div');
  card.id = 'report-filters-card';
  card.className = 'card';
  card.style.marginBottom = '16px';
  card.innerHTML = `
    <div class="card-header">
      <div class="toolbar-shell">
        <div class="toolbar-filters report-filters">
          <div class="toolbar-field">
            <label class="toolbar-label">Dal</label>
            <input type="date" id="report-filter-from" onchange="renderReport()">
          </div>
          <div class="toolbar-field">
            <label class="toolbar-label">Al</label>
            <input type="date" id="report-filter-to" onchange="renderReport()">
          </div>
          <div class="toolbar-field">
            <label class="toolbar-label">Giro</label>
            <select id="report-filter-giro" onchange="renderReport()">
              <option value="">Tutti</option>
              <option value="bari nord">Bari Nord</option>
              <option value="bari/foggia">Bari/Foggia</option>
              <option value="murgia">Murgia</option>
              <option value="taranto">Taranto</option>
              <option value="lecce">Lecce</option>
              <option value="lecce est">Lecce Est</option>
              <option value="valle itria">Valle Itria</option>
              <option value="calabria">Calabria</option>
              <option value="foggia">Foggia</option>
              <option value="diretto">Diretto</option>
            </select>
          </div>
          <div class="toolbar-field">
            <label class="toolbar-label">Agente</label>
            <select id="report-filter-agente" onchange="renderReport()"><option value="">Tutti</option></select>
          </div>
        </div>
        <div class="toolbar-actions">
          <button class="btn btn-outline btn-sm" onclick="resetReportFilters()">Reset</button>
          <button class="btn btn-outline btn-sm" onclick="setAllReportSections(false)">Chiudi tutte</button>
          <button class="btn btn-outline btn-sm" onclick="setAllReportSections(true)">Apri tutte</button>
        </div>
      </div>
    </div>`;
  page.insertBefore(card, firstGrid);
  populateReportAgentFilter();
  loadReportFilters();
}

function ensureReportExportButtons() {
  const conf = [
    { selector: '#chart-week', key: 'week' },
    { selector: '#chart-agenti', key: 'agenti' },
    { selector: '#report-crm-weekly', key: 'crm-weekly' },
    { selector: '#report-crm-monthly', key: 'crm-monthly' },
    { selector: '#report-top-prodotti', key: 'prodotti' },
    { selector: '#report-giri', key: 'giri' },
    { selector: '#report-clienti-inattivi', key: 'inattivi' },
    { selector: '#report-agenti-clienti', key: 'agenti-clienti' },
    { selector: '#report-clienti-table', key: 'classifica-clienti' },
  ];
  conf.forEach(c => {
    const target = document.querySelector(c.selector);
    if (!target) return;
    const header = target.previousElementSibling || target.closest('.card')?.querySelector('.card-header') || target.closest('.chart-placeholder')?.querySelector('.chart-title');
    if (!header || header.querySelector(`[data-export='${c.key}']`)) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-sm';
    btn.dataset.export = c.key;
    btn.textContent = 'CSV';
    btn.style.marginLeft = '8px';
    btn.onclick = (e) => { e.stopPropagation(); exportReportCsv(c.key); };
    header.appendChild(btn);
  });
}

function populateReportAgentFilter() {
  const sel = document.getElementById('report-filter-agente');
  if (!sel) return;
  const cur = sel.value;
  const agenti = state.utenti.filter(u => u.ruolo === 'autista');
  sel.innerHTML = '<option value="">Tutti</option>' +
    agenti.map(a => `<option value="${a.id}">${(a.nome+' '+(a.cognome||'')).trim()}</option>`).join('');
  if (cur) sel.value = cur;
}

function loadReportFilters() {
  const fromEl = document.getElementById('report-filter-from');
  const toEl = document.getElementById('report-filter-to');
  const giroEl = document.getElementById('report-filter-giro');
  const agenteEl = document.getElementById('report-filter-agente');
  if (!fromEl || !toEl || !giroEl || !agenteEl) return;
  const raw = localStorage.getItem(reportFilterStorageKey());
  if (!raw) return;
  try {
    const f = JSON.parse(raw);
    fromEl.value = f.from || '';
    toEl.value = f.to || '';
    giroEl.value = f.giro || '';
    agenteEl.value = f.agente || '';
  } catch(_) {}
}

function readReportFilters() {
  const from = document.getElementById('report-filter-from')?.value || '';
  const to = document.getElementById('report-filter-to')?.value || '';
  const giro = document.getElementById('report-filter-giro')?.value || '';
  const agente = document.getElementById('report-filter-agente')?.value || '';
  const filters = { from, to, giro, agente };
  localStorage.setItem(reportFilterStorageKey(), JSON.stringify(filters));
  return filters;
}

function resetReportFilters() {
  const fromEl = document.getElementById('report-filter-from');
  const toEl = document.getElementById('report-filter-to');
  const giroEl = document.getElementById('report-filter-giro');
  const agenteEl = document.getElementById('report-filter-agente');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  if (giroEl) giroEl.value = '';
  if (agenteEl) agenteEl.value = '';
  localStorage.removeItem(reportFilterStorageKey());
  renderReport();
}

function getReportOrdiniFiltrati() {
  const f = readReportFilters();
  return state.ordini.filter(o => {
    if (f.from && o.data < f.from) return false;
    if (f.to && o.data > f.to) return false;
    if (f.giro && (getCliente(o.clienteId)?.giro || '') !== f.giro) return false;
    if (f.agente && String(o.agenteId || '') !== String(f.agente)) return false;
    return true;
  });
}

function downloadCsv(filename, rows) {
  if (!rows || !rows.length) {
    showToast('Nessun dato da esportare', 'warning');
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    if (s.includes('"') || s.includes(';') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const csv = [headers.join(';')].concat(rows.map(r => headers.map(h => esc(r[h])).join(';'))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportReportCsv(section) {
  const rows = reportDataCache[section] || [];
  const d = new Date().toISOString().slice(0,10);
  downloadCsv(`report_${section}_${d}.csv`, rows);
}

async function renderReport() {
  if (isMagazzinoReportOnly()) {
    toggleReportStatsVisibility(false);
    ensureMagazzinoPdfCard();
    renderMagazzinoPdfPreviewInline();
    return;
  }

  toggleReportStatsVisibility(true);
  hideMagazzinoPdfCard();
  ensureReportToolbar();
  ensureReportExportButtons();
  populateReportAgentFilter();
  initReportDropdowns();
  if (state.currentUser?.ruolo === 'admin' || state.currentUser?.ruolo === 'direzione' || state.currentUser?.ruolo === 'amministrazione') {
    try {
      const logs = await api('GET', '/api/activity');
      state.activityLog = (logs||[]).map(l=>({ts:l.ts,userId:l.user_id,userName:l.user_name,action:l.action,detail:l.detail}));
    } catch(e) {}
  }

  const ordiniReport = getReportOrdiniFiltrati();
  const total = ordiniReport.length || 1;
  const agenti = state.utenti.filter(u => u.ruolo === 'autista');

  const days = [];
  for (let i=6;i>=0;i--) {
    const d = new Date();
    d.setDate(d.getDate()-i);
    const ds = d.toISOString().split('T')[0];
    days.push({label:d.toLocaleDateString('it-IT',{weekday:'short'}),count:ordiniReport.filter(o=>o.data===ds).length, data: ds});
  }
  reportDataCache.week = days.map(x => ({ data: x.data, giorno: x.label, ordini: x.count }));
  const maxDay = Math.max(...days.map(d=>d.count),1);
  const chartEl = document.getElementById('chart-week');
  if(chartEl) chartEl.innerHTML = days.map(d=>`<div class="bar-wrap"><div class="bar-val">${d.count||''}</div><div class="bar" style="height:${Math.max((d.count/maxDay)*110,2)}px;"></div><div class="bar-label">${d.label}</div></div>`).join('');

  const agData = agenti.map(a => {
    const n = ordiniReport.filter(o => o.agenteId===a.id||o.autistaDiGiro===a.id).length;
    const pct = Math.round(n/total*100);
    return { agente: (a.nome+' '+(a.cognome||'')).trim(), ordini: n, percentuale: pct };
  });
  reportDataCache.agenti = agData;
  const agChart = document.getElementById('chart-agenti');
  if(agChart) agChart.innerHTML = agData.map(a=>`<div style="margin-bottom:14px;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px;"><span style="font-weight:600;">${a.agente}</span><span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);">${a.ordini}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${a.percentuale}%"></div></div></div>`).join('');

  const clientiReport = state.clienti.filter(cl => typeof isClienteAnagrafico === 'function' ? isClienteAnagrafico(cl) : !(typeof isTentataVenditaCliente === 'function' && isTentataVenditaCliente(cl)));
  const ordiniClientiReport = ordiniReport.filter(o => typeof isClienteAnagrafico === 'function' ? isClienteAnagrafico(getCliente(o.clienteId)) : !(typeof isTentataVenditaCliente === 'function' && isTentataVenditaCliente(getCliente(o.clienteId))));

  const prospects = state.clienti.filter(cl => typeof isCrmProspectCliente === 'function' && isCrmProspectCliente(cl));
  const sameDate = (ts) => String(ts || '').slice(0, 10);
  const weeklyConv = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const onboarding = prospects.filter(c => sameDate(c.createdAt) === ds).length;
    const converted = prospects.filter(c => sameDate(c.crmConvertitoAt) === ds).length;
    weeklyConv.push({
      data: ds,
      giorno: d.toLocaleDateString('it-IT', { weekday: 'short' }),
      onboarding,
      convertiti: converted,
      tasso: onboarding ? Math.round((converted / onboarding) * 100) : 0,
    });
  }
  reportDataCache['crm-weekly'] = weeklyConv;
  const crmWeeklyEl = document.getElementById('report-crm-weekly');
  if (crmWeeklyEl) {
    crmWeeklyEl.innerHTML = weeklyConv.map(item => `
      <div style="display:grid;grid-template-columns:72px 1fr auto;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="font-weight:700;font-size:13px;">${item.giorno}</div>
        <div>
          <div style="font-size:12px;color:var(--text2);">Onboarding ${item.onboarding} · Convertiti ${item.convertiti}</div>
          <div style="margin-top:6px;height:8px;background:var(--border);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(item.tasso, 100)}%;background:var(--accent);border-radius:999px;"></div>
          </div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);">${item.tasso}%</div>
      </div>
    `).join('');
  }

  const monthlyConv = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const ym = d.toISOString().slice(0, 7);
    const onboarding = prospects.filter(c => String(c.createdAt || '').slice(0, 7) === ym).length;
    const converted = prospects.filter(c => String(c.crmConvertitoAt || '').slice(0, 7) === ym).length;
    monthlyConv.push({
      mese: d.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' }),
      onboarding,
      convertiti: converted,
      tasso: onboarding ? Math.round((converted / onboarding) * 100) : 0,
    });
  }
  reportDataCache['crm-monthly'] = monthlyConv;
  const crmMonthlyEl = document.getElementById('report-crm-monthly');
  if (crmMonthlyEl) {
    crmMonthlyEl.innerHTML = monthlyConv.map(item => `
      <div style="display:grid;grid-template-columns:110px 1fr auto;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="font-weight:700;font-size:13px;text-transform:capitalize;">${item.mese}</div>
        <div>
          <div style="font-size:12px;color:var(--text2);">Onboarding ${item.onboarding} · Convertiti ${item.convertiti}</div>
          <div style="margin-top:6px;height:8px;background:var(--border);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(item.tasso, 100)}%;background:var(--gold);border-radius:999px;"></div>
          </div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--gold);">${item.tasso}%</div>
      </div>
    `).join('');
  }
  const cliData = clientiReport.map(cl=>({...cl,n:ordiniClientiReport.filter(o=>o.clienteId===cl.id).length})).sort((a,b)=>b.n-a.n);
  reportDataCache['classifica-clienti'] = cliData.map(cl => ({ cliente: cl.nome, localita: cl.localita, giro: cl.giro, ordini: cl.n, percentuale: Math.round(cl.n/total*100) }));
  const cliEl = document.getElementById('report-clienti-table');
  if(cliEl) cliEl.innerHTML = cliData.map(cl=>`<tr><td><b style="font-size:13px;">${cl.nome}</b></td><td style="color:var(--text2);font-size:13px;">${cl.localita}</td><td>${cl.giro?`<span class="badge badge-blue">${cl.giro}</span>`:'-'}</td><td style="font-family:'DM Mono',monospace;font-weight:700;">${cl.n}</td><td><div style="display:flex;align-items:center;gap:8px;"><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${Math.round(cl.n/total*100)}%;background:var(--accent);border-radius:3px;"></div></div><span style="font-size:11px;font-family:'DM Mono',monospace;color:var(--text3);">${Math.round(cl.n/total*100)}%</span></div></td></tr>`).join('');

  const prodFreq = {}; ordiniClientiReport.forEach(o=>o.linee.forEach(l=>{if(l.prodId)prodFreq[l.prodId]=(prodFreq[l.prodId]||0)+(l.qty||1);}));
  const topProd = Object.entries(prodFreq).map(([id,qty])=>({p:getProdotto(parseInt(id)),qty})).filter(x=>x.p.id).sort((a,b)=>b.qty-a.qty).slice(0,10);
  reportDataCache.prodotti = topProd.map(x => ({ codice: x.p.codice, prodotto: x.p.nome, categoria: x.p.categoria, quantita: x.qty }));
  const maxProd = topProd[0]?.qty||1;
  const prodEl = document.getElementById('report-top-prodotti');
  if(prodEl) prodEl.innerHTML = topProd.length ? topProd.map((x,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);"><div style="width:22px;height:22px;border-radius:50%;background:${i<3?'var(--gold-light)':'var(--surface2)'};color:${i<3?'var(--gold)':'var(--text3)'};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</div><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${x.p.nome}</div><div style="font-size:11px;color:var(--text3);">${x.p.categoria}</div></div><div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);min-width:36px;text-align:right;">${x.qty}</div><div style="width:50px;height:5px;background:var(--border);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${Math.round(x.qty/maxProd*100)}%;background:var(--gold);border-radius:3px;"></div></div></div>`).join('') : '<div style="padding:16px;color:var(--text3);text-align:center;">Nessun dato</div>';

  const giriList = ['bari nord','bari/foggia','murgia','taranto','lecce','lecce est','valle itria','calabria','foggia','diretto','stef','variabile'];
  const giroFreq = {}; ordiniClientiReport.forEach(o=>{const g=getCliente(o.clienteId)?.giro||'altro';giroFreq[g]=(giroFreq[g]||0)+1;});
  const giroData = giriList.map(g=>({g,n:giroFreq[g]||0})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  reportDataCache.giri = giroData.map(x => ({ giro: x.g, ordini: x.n }));
  const maxGiro = giroData[0]?.n||1;
  const giroEl = document.getElementById('report-giri');
  if(giroEl) giroEl.innerHTML = giroData.length ? giroData.map(x=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);"><div style="min-width:90px;font-size:13px;font-weight:600;text-transform:capitalize;">${x.g}</div><div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round(x.n/maxGiro*100)}%;background:var(--accent);border-radius:4px;"></div></div><div style="font-family:'DM Mono',monospace;font-weight:700;font-size:13px;color:var(--accent);min-width:24px;text-align:right;">${x.n}</div></div>`).join('') : '<div style="padding:16px;color:var(--text3);">Nessun dato</div>';

  const oggi=new Date(); const soglia=new Date(oggi); soglia.setDate(oggi.getDate()-30); const sogliaStr=soglia.toISOString().split('T')[0];
  const clientiInattivi = clientiReport.map(cl=>{const oc=ordiniClientiReport.filter(o=>o.clienteId===cl.id);const ul=oc.length?oc.map(o=>o.data).sort().reverse()[0]:null;return{...cl,ultimo:ul};}).filter(cl=>!cl.ultimo||cl.ultimo<sogliaStr).sort((a,b)=>(a.ultimo||'').localeCompare(b.ultimo||'')).slice(0,15);
  reportDataCache.inattivi = clientiInattivi.map(cl => ({ cliente: cl.nome, localita: cl.localita, giro: cl.giro, ultimo_ordine: cl.ultimo || '' }));
  const inEl = document.getElementById('report-clienti-inattivi');
  if(inEl) inEl.innerHTML = clientiInattivi.length ? clientiInattivi.map(cl=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);"><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;">${cl.nome}</div><div style="font-size:11px;color:var(--text3);">${cl.localita}${cl.giro?' - '+cl.giro:''}</div></div><div style="text-align:right;flex-shrink:0;">${cl.ultimo?`<div style="font-size:12px;color:var(--orange);font-weight:600;">${formatDate(cl.ultimo)}</div><div style="font-size:10px;color:var(--text3);">ultimo ordine</div>`:`<div style="font-size:12px;color:var(--danger);font-weight:600;">Mai ordinato</div>`}</div></div>`).join('') : '<div style="padding:16px;color:var(--success);text-align:center;">Tutti i clienti sono attivi</div>';

  const agCliData = agenti.map(a=>({agente:(a.nome+' '+(a.cognome||'')).trim(),clienti:clientiReport.filter(cl=>cl.agenteId===a.id)}));
  reportDataCache['agenti-clienti'] = agCliData.flatMap(x => x.clienti.map(cl => ({ agente: x.agente, cliente: cl.nome, localita: cl.localita, giro: cl.giro })));
  const agCliEl = document.getElementById('report-agenti-clienti');
  if(agCliEl) agCliEl.innerHTML = agCliData.map(x=>`<div style="margin-bottom:16px;"><div style="font-weight:700;font-size:14px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border);">Agente: ${x.agente} <span style="font-weight:400;color:var(--text2);font-size:13px;">(${x.clienti.length} clienti)</span></div>${x.clienti.length?x.clienti.map(cl=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;"><span class="badge badge-blue" style="font-size:10px;">${cl.giro||'-'}</span><span>${cl.nome}</span><span style="color:var(--text3);">${cl.localita}</span></div>`).join(''):'<div style="font-size:13px;color:var(--text3);">Nessun cliente</div>'}</div>`).join('');

  renderActivityLog();
}
// CALENDARIO GIRI FISSI
// ═══════════════════════════════════════════════

const GIORNI_NOMI = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

function getNextGiroDate(giroName) {
  const conf = state.giriCalendario.find(g => g.giro === giroName);
  if (!conf || !conf.giorni.length) return null;
  const oggi = new Date();
  for (let delta = 0; delta <= 7; delta++) {
    const d = new Date(oggi);
    d.setDate(oggi.getDate() + delta);
    if (conf.giorni.includes(d.getDay())) {
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

