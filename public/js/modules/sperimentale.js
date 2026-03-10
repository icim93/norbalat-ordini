(function () {
  const CLAL_DEFAULT_URL = 'https://www.clal.it/index.php?section=burro_milano#zangolato';
  const DEFAULT_SPREAD = 0.5;
  const DEFAULT_COEFFICIENT = 82;
  const CREAM_BANDS = [
    { label: 'Sotto il 30%', from: 0, to: 30, mode: 'max_only' },
    { label: 'Dal 30% al 40%', from: 30, to: 40 },
    { label: 'Dal 40% al 50%', from: 40, to: 50 },
    { label: 'Dal 50% al 60%', from: 50, to: 60 },
    { label: 'Dal 60% al 70%', from: 60, to: 70 },
    { label: 'Dal 70% al 80%', from: 70, to: 80 },
  ];

  function fmtNum(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${fmtNum(n)} EUR`;
  }

  function fmtDateTime(v) {
    if (!v) return '-';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('it-IT');
  }

  function fmtDateOnly(v) {
    if (!v) return '-';
    const s = String(v).trim();
    const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('it-IT');
  }

  function parseInputNumber(id, fallback) {
    const raw = document.getElementById(id)?.value;
    const n = Number(String(raw || '').replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  }

  function getLatestClalRow(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list[0] || null;
  }

  function updateClalHighlights(row) {
    const latestMin = document.getElementById('experimental-clal-latest-min');
    const latestMax = document.getElementById('experimental-clal-latest-max');
    const latestDate = document.getElementById('experimental-clal-latest-date');
    const refDate = row?.date_iso || row?.ref_date || row?.date_raw || '';
    if (latestMin) latestMin.textContent = row ? fmtMoney(row.min_price ?? row.minPrice) : '-';
    if (latestMax) latestMax.textContent = row ? fmtMoney(row.max_price ?? row.maxPrice) : '-';
    if (latestDate) latestDate.textContent = fmtDateOnly(refDate);
  }

  function computeCreamPrice(clalPrice, spread, coefficient, fatPct) {
    const price = Number(clalPrice);
    const fat = Number(fatPct);
    const coeff = Number(coefficient);
    const spreadNum = Number(spread);
    if (!Number.isFinite(price) || !Number.isFinite(fat) || !Number.isFinite(coeff) || coeff <= 0) return null;
    return ((price + spreadNum) / coeff) * fat;
  }

  function renderExperimentalCreamPanel() {
    const tbody = document.getElementById('experimental-cream-rows');
    const summary = document.getElementById('experimental-cream-summary');
    if (!tbody || !summary) return;

    const latest = getLatestClalRow(window.state.experimentalClalRows);
    updateClalHighlights(latest);
    if (!latest) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:10px;color:var(--text3);">Importa prima il dato CLAL per calcolare la panna.</td></tr>';
      summary.textContent = 'Nessun dato CLAL disponibile.';
      return;
    }

    const spread = parseInputNumber('experimental-cream-spread', DEFAULT_SPREAD);
    const coefficient = parseInputNumber('experimental-cream-coefficient', DEFAULT_COEFFICIENT);

    const minClal = Number(latest.min_price ?? latest.minPrice);
    const maxClal = Number(latest.max_price ?? latest.maxPrice ?? minClal);
    if (!Number.isFinite(minClal) || !Number.isFinite(maxClal) || !Number.isFinite(coefficient) || coefficient <= 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:10px;color:var(--text3);">Dati non validi per il calcolo.</td></tr>';
      summary.textContent = 'Verifica CLAL, spread e coefficiente.';
      return;
    }

    const rows = CREAM_BANDS.map((band) => {
      const minValue = computeCreamPrice(minClal, spread, coefficient, band.from);
      const maxValue = computeCreamPrice(maxClal, spread, coefficient, band.to);
      return {
        ...band,
        minValue,
        maxValue,
      };
    });

    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td style="padding:8px 10px;border-top:1px solid var(--border);">${row.label}</td>
        <td style="padding:8px 10px;border-top:1px solid var(--border);text-align:right;font-family:'DM Mono',monospace;">${row.mode === 'max_only' ? `Massimo ${fmtMoney(row.maxValue)}` : `Da ${fmtMoney(row.minValue)} a ${fmtMoney(row.maxValue)}`}</td>
      </tr>
    `).join('');

    const firstOperational = rows[1];
    const lastOperational = rows[rows.length - 1];
    summary.textContent = `Fasce automatiche calcolate da CLAL ${fmtMoney(minClal)} - ${fmtMoney(maxClal)}, spread ${fmtMoney(spread)} e coefficiente ${fmtNum(coefficient)}. Dal 30% al 40%: da ${fmtMoney(firstOperational?.minValue)} a ${fmtMoney(firstOperational?.maxValue)}. Ultima fascia: da ${fmtMoney(lastOperational?.minValue)} a ${fmtMoney(lastOperational?.maxValue)}.`;
  }

  function renderClalRows(rows, originLabel = '') {
    const tbody = document.getElementById('experimental-clal-rows');
    if (!tbody) return;
    const list = Array.isArray(rows) ? rows : [];
    window.state.experimentalClalRows = list;
    updateClalHighlights(getLatestClalRow(list));
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:10px;color:var(--text3);">Nessun dato disponibile</td></tr>';
      renderExperimentalCreamPanel();
      return;
    }
    tbody.innerHTML = list.map((r) => {
      const d = r.date_iso || r.ref_date || r.date_raw || '';
      const dateTxt = fmtDateOnly(d);
      const minV = r.min_price ?? r.minPrice ?? null;
      const maxV = r.max_price ?? r.maxPrice ?? null;
      const src = originLabel || (r.fetched_at ? 'storico' : 'live');
      return `<tr>
        <td style="padding:8px 10px;border-top:1px solid var(--border);">${dateTxt}</td>
        <td style="padding:8px 10px;border-top:1px solid var(--border);text-align:right;font-family:'DM Mono',monospace;">${fmtNum(minV)}</td>
        <td style="padding:8px 10px;border-top:1px solid var(--border);text-align:right;font-family:'DM Mono',monospace;">${fmtNum(maxV)}</td>
        <td style="padding:8px 10px;border-top:1px solid var(--border);color:var(--text2);">${src}</td>
      </tr>`;
    }).join('');
    renderExperimentalCreamPanel();
  }

  function setClalMeta(text) {
    const meta = document.getElementById('experimental-clal-meta');
    if (meta) meta.textContent = text || '';
  }

  function renderClalScheduleStatus(status) {
    const lastImportEl = document.getElementById('experimental-clal-last-import');
    const nextWindowEl = document.getElementById('experimental-clal-next-window');
    if (lastImportEl) {
      const last = status?.last_import;
      if (!last) {
        lastImportEl.textContent = 'Nessun bollettino salvato';
      } else {
        const refDate = fmtDateOnly(last.ref_date || last.date_raw || '-');
        lastImportEl.textContent = `${refDate} - importato il ${fmtDateTime(last.fetched_at)}`;
      }
    }
    if (nextWindowEl) {
      const next = status?.next_window;
      nextWindowEl.textContent = next?.label || '-';
    }
  }

  async function loadClalStatus() {
    try {
      const r = await window.api('GET', '/api/experimental/clal/status');
      window.state.experimentalClalStatus = r;
      renderClalScheduleStatus(r);
    } catch (_) {
      renderClalScheduleStatus(null);
    }
  }

  async function loadExperimentalConfig() {
    try {
      const cfg = await window.api('GET', '/api/experimental/config');
      const urlEl = document.getElementById('experimental-url');
      const modeEl = document.getElementById('experimental-mode');
      if (urlEl && !urlEl.value) urlEl.value = cfg.url || CLAL_DEFAULT_URL;
      if (modeEl) modeEl.value = cfg.mode || 'auto';
    } catch (_) {}
  }

  async function renderSperimentale() {
    const pre = document.getElementById('experimental-preview');
    if (pre && !pre.textContent.trim()) {
      pre.textContent = 'Premi "Aggiorna" per acquisire i dati dalla sorgente configurata.';
    }
    window.state.experimentalClalRows = window.state.experimentalClalRows || [];
    await loadExperimentalConfig();
    await loadClalStatus();
    renderExperimentalCreamPanel();
    await loadClalZangolato(true, { silent: true, auto: true, fallbackToHistory: true });
  }

  async function saveExperimentalConfig() {
    const url = (document.getElementById('experimental-url')?.value || '').trim();
    const body = {
      mode: (document.getElementById('experimental-mode')?.value || 'auto').trim(),
    };
    if (url) body.url = url;
    try {
      await window.api('PUT', '/api/experimental/config', body);
      if (typeof window.showToast === 'function') window.showToast('Configurazione sorgente salvata', 'success');
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  async function loadExperimentalSource() {
    const url = (document.getElementById('experimental-url')?.value || '').trim();
    const mode = (document.getElementById('experimental-mode')?.value || 'auto').trim();
    const meta = document.getElementById('experimental-meta');
    const pre = document.getElementById('experimental-preview');
    if (meta) meta.textContent = 'Caricamento...';
    try {
      const qp = [];
      if (url) qp.push(`url=${encodeURIComponent(url)}`);
      if (mode) qp.push(`mode=${encodeURIComponent(mode)}`);
      const q = qp.length ? `?${qp.join('&')}` : '';
      const r = await window.api('GET', `/api/experimental/source${q}`);
      const previewRaw = typeof r.preview === 'string' ? r.preview : JSON.stringify(r.preview, null, 2);
      let previewOut = previewRaw;
      if ((r.mode === 'json' || r.content_type?.includes('json') || mode === 'json') && typeof previewRaw === 'string') {
        try {
          previewOut = JSON.stringify(JSON.parse(previewRaw), null, 2);
        } catch (_) {}
      }
      const now = new Date();
      const size = String(previewOut || '').length;
      if (meta) meta.textContent = `${r.source || ''} - ${r.content_type || ''} - mode ${r.mode || 'auto'} - ${size} caratteri - ${now.toLocaleString('it-IT')}`;
      if (pre) pre.textContent = previewOut;
      window.state.experimentalLastPreview = previewOut;
    } catch (e) {
      if (meta) meta.textContent = `Errore: ${e.message}`;
      if (pre) pre.textContent = '';
      if (typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  async function copyExperimentalPreview() {
    const txt = document.getElementById('experimental-preview')?.textContent || '';
    if (!txt.trim()) {
      if (typeof window.showToast === 'function') window.showToast('Nessuna anteprima da copiare', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(txt);
      if (typeof window.showToast === 'function') window.showToast('Anteprima copiata negli appunti', 'success');
    } catch (_) {
      if (typeof window.showToast === 'function') window.showToast('Copia non riuscita', 'warning');
    }
  }

  async function loadClalZangolato(persist, options = {}) {
    const { silent = false, auto = false, fallbackToHistory = false } = options;
    const customUrl = (document.getElementById('experimental-url')?.value || '').trim();
    setClalMeta(auto ? 'Aggiornamento automatico dati CLAL...' : 'Caricamento dati CLAL...');
    try {
      const qs = [];
      if (customUrl) qs.push(`url=${encodeURIComponent(customUrl)}`);
      if (persist) qs.push('persist=1');
      const path = `/api/experimental/clal/zangolato${qs.length ? '?' + qs.join('&') : ''}`;
      const r = await window.api('GET', path);
      const rows = Array.isArray(r.rows) ? r.rows : [];
      renderClalRows(rows, persist ? 'live+saved' : 'live');
      const latest = r.latest ? `${fmtDateOnly(r.latest.date_iso || r.latest.date_raw || '-')} ${fmtNum(r.latest.min_price)}-${fmtNum(r.latest.max_price)} EUR/kg` : 'n.d.';
      const autoLabel = auto ? ' - aggiornamento automatico' : '';
      setClalMeta(`Fonte: ${r.source || ''} - Righe: ${r.rows_count || 0} - Ultimo: ${latest}${persist ? ` - Nuovi snapshot: ${r.inserted_count || 0}` : ''}${autoLabel}`);
      await loadClalStatus();
      if (!silent && typeof window.showToast === 'function') window.showToast(persist ? 'Import CLAL completato e snapshot salvato' : 'Import CLAL completato', 'success');
    } catch (e) {
      if (fallbackToHistory) {
        await loadClalZangolatoHistory({ silent: true, reason: e.message });
        return;
      }
      setClalMeta(`Errore CLAL: ${e.message}`);
      if (!silent && typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  async function loadClalZangolatoHistory(options = {}) {
    const { silent = false, reason = '' } = options;
    setClalMeta(reason ? `Caricamento storico (${reason})...` : 'Caricamento storico...');
    try {
      const r = await window.api('GET', '/api/experimental/clal/zangolato/history?limit=120');
      const rows = (r.rows || []).map((x) => ({
        ref_date: x.ref_date,
        date_raw: x.date_raw,
        min_price: x.min_price,
        max_price: x.max_price,
        fetched_at: x.fetched_at,
      }));
      renderClalRows(rows, 'storico');
      setClalMeta(`Storico snapshot: ${rows.length} record${reason ? ` - live non disponibile: ${reason}` : ''}`);
      await loadClalStatus();
    } catch (e) {
      setClalMeta(`Errore storico: ${e.message}`);
      if (!silent && typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  window.renderSperimentale = renderSperimentale;
  window.renderExperimentalCreamPanel = renderExperimentalCreamPanel;
  window.saveExperimentalConfig = saveExperimentalConfig;
  window.loadExperimentalSource = loadExperimentalSource;
  window.copyExperimentalPreview = copyExperimentalPreview;
  window.loadClalZangolato = loadClalZangolato;
  window.loadClalZangolatoHistory = loadClalZangolatoHistory;
})();
