(function () {
  const CLAL_DEFAULT_URL = 'https://www.clal.it/index.php?section=burro_milano#zangolato';

  function fmtNum(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderClalRows(rows, originLabel = '') {
    const tbody = document.getElementById('experimental-clal-rows');
    if (!tbody) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:10px;color:var(--text3);">Nessun dato disponibile</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((r) => {
      const d = r.date_iso || r.ref_date || r.date_raw || '';
      const dateTxt = d ? (String(d).includes('-') ? window.formatDate?.(d) || d : d) : '-';
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
  }

  function setClalMeta(text) {
    const meta = document.getElementById('experimental-clal-meta');
    if (meta) meta.textContent = text || '';
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
    await loadExperimentalConfig();
    if (!document.getElementById('experimental-clal-rows')?.children.length) {
      loadClalZangolatoHistory().catch(() => {});
    }
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
      if (meta) meta.textContent = `${r.source || ''} · ${r.content_type || ''} · mode ${r.mode || 'auto'} · ${size} caratteri · ${now.toLocaleString('it-IT')}`;
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

  async function loadClalZangolato(persist) {
    const customUrl = (document.getElementById('experimental-url')?.value || '').trim();
    setClalMeta('Caricamento dati CLAL...');
    try {
      const qs = [];
      if (customUrl) qs.push(`url=${encodeURIComponent(customUrl)}`);
      if (persist) qs.push('persist=1');
      const path = `/api/experimental/clal/zangolato${qs.length ? '?' + qs.join('&') : ''}`;
      const r = await window.api('GET', path);
      const rows = Array.isArray(r.rows) ? r.rows : [];
      renderClalRows(rows, persist ? 'live+saved' : 'live');
      const latest = r.latest ? `${r.latest.date_iso || r.latest.date_raw || '-'} ${fmtNum(r.latest.min_price)}-${fmtNum(r.latest.max_price)} €/kg` : 'n.d.';
      setClalMeta(`Fonte: ${r.source || ''} · Righe: ${r.rows_count || 0} · Ultimo: ${latest}${persist ? ` · Snapshot salvati: ${r.inserted_count || 0}` : ''}`);
      if (typeof window.showToast === 'function') window.showToast(persist ? 'Import CLAL completato e snapshot salvato' : 'Import CLAL completato', 'success');
    } catch (e) {
      setClalMeta(`Errore CLAL: ${e.message}`);
      if (typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  async function loadClalZangolatoHistory() {
    setClalMeta('Caricamento storico...');
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
      setClalMeta(`Storico snapshot: ${rows.length} record`);
    } catch (e) {
      setClalMeta(`Errore storico: ${e.message}`);
      if (typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  window.renderSperimentale = renderSperimentale;
  window.saveExperimentalConfig = saveExperimentalConfig;
  window.loadExperimentalSource = loadExperimentalSource;
  window.copyExperimentalPreview = copyExperimentalPreview;
  window.loadClalZangolato = loadClalZangolato;
  window.loadClalZangolatoHistory = loadClalZangolatoHistory;
})();
