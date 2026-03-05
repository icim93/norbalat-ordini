(function () {
  async function loadExperimentalConfig() {
    try {
      const cfg = await window.api('GET', '/api/experimental/config');
      const urlEl = document.getElementById('experimental-url');
      const modeEl = document.getElementById('experimental-mode');
      if (urlEl && !urlEl.value) urlEl.value = cfg.url || '';
      if (modeEl) modeEl.value = cfg.mode || 'auto';
    } catch (_) {}
  }

  async function renderSperimentale() {
    const pre = document.getElementById('experimental-preview');
    if (pre && !pre.textContent.trim()) {
      pre.textContent = 'Premi "Aggiorna" per acquisire i dati.';
    }
    await loadExperimentalConfig();
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
      if (meta) meta.textContent = `${r.source || ''} · ${r.content_type || ''} · mode ${r.mode || 'auto'}`;
      if (pre) pre.textContent = typeof r.preview === 'string' ? r.preview : JSON.stringify(r.preview, null, 2);
    } catch (e) {
      if (meta) meta.textContent = `Errore: ${e.message}`;
      if (pre) pre.textContent = '';
      if (typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  window.renderSperimentale = renderSperimentale;
  window.saveExperimentalConfig = saveExperimentalConfig;
  window.loadExperimentalSource = loadExperimentalSource;
})();
