(function () {
  async function renderSperimentale() {
    const pre = document.getElementById('experimental-preview');
    if (pre && !pre.textContent.trim()) {
      pre.textContent = 'Premi "Aggiorna" per acquisire i dati.';
    }
  }

  async function loadExperimentalSource() {
    const url = (document.getElementById('experimental-url')?.value || '').trim();
    const meta = document.getElementById('experimental-meta');
    const pre = document.getElementById('experimental-preview');
    if (meta) meta.textContent = 'Caricamento...';
    try {
      const q = url ? `?url=${encodeURIComponent(url)}` : '';
      const r = await window.api('GET', `/api/experimental/source${q}`);
      if (meta) meta.textContent = `${r.source || ''} · ${r.content_type || ''}`;
      if (pre) pre.textContent = typeof r.preview === 'string' ? r.preview : JSON.stringify(r.preview, null, 2);
    } catch (e) {
      if (meta) meta.textContent = `Errore: ${e.message}`;
      if (pre) pre.textContent = '';
      if (typeof window.showToast === 'function') window.showToast(e.message, 'warning');
    }
  }

  window.renderSperimentale = renderSperimentale;
  window.loadExperimentalSource = loadExperimentalSource;
})();
