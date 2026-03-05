function canSeeDevPanel() {
  return state.currentUser?.ruolo === 'admin';
}

function devAutoKey() {
  return 'dev_auto_monitor_' + (state.currentUser?.id || 'default');
}

function devErrorsKey() {
  return 'dev_errors_' + (state.currentUser?.id || 'default');
}

function devThresholdsKey() {
  return 'dev_thresholds_' + (state.currentUser?.id || 'default');
}

function isDevAutoEnabled() {
  return localStorage.getItem(devAutoKey()) !== '0';
}

function setDevAutoEnabled(val) {
  localStorage.setItem(devAutoKey(), val ? '1' : '0');
}

function loadDevErrors() {
  try {
    const raw = localStorage.getItem(devErrorsKey());
    state.devErrors = raw ? JSON.parse(raw) : [];
  } catch (_) {
    state.devErrors = [];
  }
}

function saveDevErrors() {
  localStorage.setItem(devErrorsKey(), JSON.stringify(state.devErrors.slice(0, 30)));
}

function loadDevThresholds() {
  const defaults = { db_warn: 120, db_err: 300, onb_warn: 8, onb_err: 20 };
  try {
    const raw = localStorage.getItem(devThresholdsKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...defaults, ...parsed };
  } catch (_) {
    return defaults;
  }
}

function saveDevThresholds(th) {
  localStorage.setItem(devThresholdsKey(), JSON.stringify(th));
}

function appendDevError(message) {
  state.devErrors.unshift(`[${new Date().toLocaleTimeString('it-IT')}] ${message}`);
  state.devErrors = state.devErrors.slice(0, 30);
  saveDevErrors();
}

function escHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}


function ensureDevPanelDom() {
  const root = document.querySelector('#page-profilo > div');
  if (!root || document.getElementById('profilo-dev-card')) return;
  const card = document.createElement('div');
  card.id = 'profilo-dev-card';
  card.className = 'card';
  card.style.marginTop = '20px';
  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">Sviluppatore <span id="dev-health-badge" class="badge badge-gray">N/D</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="dev-auto-toggle" onchange="toggleDevAuto(this.checked)" style="width:14px;height:14px;accent-color:var(--accent);">
          Monitoraggio automatico
        </label>
        <button class="btn btn-outline btn-sm" onclick="refreshDevMetrics(false)">Aggiorna</button>
        <button class="btn btn-outline btn-sm" onclick="runDevSmoke()">Smoke test</button>
      </div>
    </div>
    <div style="padding:14px 18px;">
      <div id="dev-status-line" style="font-size:13px;color:var(--text2);margin-bottom:10px;">In attesa dati...</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <label style="font-size:12px;color:var(--text2);">DB warn <input type="number" id="dev-th-db-warn" min="1" style="width:70px;margin-left:4px;" onchange="updateDevThresholds()"></label>
        <label style="font-size:12px;color:var(--text2);">DB err <input type="number" id="dev-th-db-err" min="1" style="width:70px;margin-left:4px;" onchange="updateDevThresholds()"></label>
        <label style="font-size:12px;color:var(--text2);">Onb warn <input type="number" id="dev-th-onb-warn" min="0" style="width:70px;margin-left:4px;" onchange="updateDevThresholds()"></label>
        <label style="font-size:12px;color:var(--text2);">Onb err <input type="number" id="dev-th-onb-err" min="0" style="width:70px;margin-left:4px;" onchange="updateDevThresholds()"></label>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;">
        <div class="stat-card"><div class="stat-label">DB latency</div><div class="stat-value" id="dev-db-lat">-</div></div>
        <div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value" id="dev-uptime">-</div></div>
        <div class="stat-card"><div class="stat-label">Memoria</div><div class="stat-value" id="dev-mem">-</div></div>
        <div class="stat-card"><div class="stat-label">Onboarding pending</div><div class="stat-value" id="dev-onb">-</div></div>
      </div>
      <div id="dev-smoke" style="margin:8px 0 12px;font-size:12px;color:var(--text2);"></div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:8px;">Ultime attivita</div>
      <div id="dev-recent-activity" style="max-height:170px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--surface2);font-size:12px;"></div>
      <div id="dev-errors" style="margin-top:10px;font-size:12px;color:var(--danger);"></div>
    </div>
  `;
  root.appendChild(card);
}

function stopDevMonitor() {
  if (state.devMonitorTimer) {
    clearInterval(state.devMonitorTimer);
    state.devMonitorTimer = null;
  }
}

function startDevMonitor() {
  stopDevMonitor();
  if (!canSeeDevPanel()) return;
  refreshDevMetrics(true);
  if (!isDevAutoEnabled()) return;
  state.devMonitorTimer = setInterval(() => {
    refreshDevMetrics(true);
  }, 30000);
}

function toggleDevAuto(enabled) {
  setDevAutoEnabled(enabled);
  startDevMonitor();
}

function updateDevThresholds() {
  if (!canSeeDevPanel()) return;
  const read = (id, fallback, min) => {
    const raw = parseInt(document.getElementById(id)?.value, 10);
    if (Number.isNaN(raw)) return fallback;
    return Math.max(min, raw);
  };
  const next = {
    db_warn: read('dev-th-db-warn', state.devThresholds?.db_warn ?? 120, 1),
    db_err: read('dev-th-db-err', state.devThresholds?.db_err ?? 300, 1),
    onb_warn: read('dev-th-onb-warn', state.devThresholds?.onb_warn ?? 8, 0),
    onb_err: read('dev-th-onb-err', state.devThresholds?.onb_err ?? 20, 0),
  };
  if (next.db_warn > next.db_err) next.db_warn = next.db_err;
  if (next.onb_warn > next.onb_err) next.onb_warn = next.onb_err;
  state.devThresholds = next;
  saveDevThresholds(next);
  renderDevPanel();
}

async function runDevSmoke() {
  if (!canSeeDevPanel()) return;
  try {
    state.devSmoke = await api('GET', '/api/dev/smoke');
    renderDevPanel();
    showToast(state.devSmoke.ok ? 'Smoke test OK' : 'Smoke test con errori', state.devSmoke.ok ? 'success' : 'warning');
  } catch (e) {
    appendDevError(`Smoke test: ${e.message}`);
    renderDevPanel();
    showToast(e.message, 'warning');
  }
}

function getDevHealthState(d, thresholds) {
  if (!d) return { level: 0, label: 'N/D', cls: 'badge-gray' };
  let level = 0;
  if ((d.db_latency_ms ?? 0) >= thresholds.db_warn) level = Math.max(level, 1);
  if ((d.db_latency_ms ?? 0) >= thresholds.db_err) level = Math.max(level, 2);
  if ((d.onboarding?.pending ?? 0) >= thresholds.onb_warn) level = Math.max(level, 1);
  if ((d.onboarding?.pending ?? 0) >= thresholds.onb_err) level = Math.max(level, 2);
  if (state.devErrors.length) level = Math.max(level, 1);
  if (state.devSmoke && state.devSmoke.ok === false) level = 2;
  if (level === 2) return { level, label: 'ERR', cls: 'badge-red' };
  if (level === 1) return { level, label: 'WARN', cls: 'badge-orange' };
  return { level, label: 'OK', cls: 'badge-green' };
}

async function refreshDevMetrics(silent = false) {
  if (!canSeeDevPanel()) return;
  try {
    const d = await api('GET', '/api/dev/metrics');
    state.devMetrics = d;
    renderDevPanel();
  } catch (e) {
    appendDevError(e.message);
    renderDevPanel();
    if (!silent) showToast(e.message, 'warning');
  }
}

function renderDevPanel() {
  const card = document.getElementById('profilo-dev-card');
  if (!card) return;
  const visible = canSeeDevPanel();
  card.style.display = visible ? 'block' : 'none';
  if (!visible) return;
  const auto = document.getElementById('dev-auto-toggle');
  if (auto) auto.checked = isDevAutoEnabled();
  if (!state.devThresholds) state.devThresholds = loadDevThresholds();
  const th = state.devThresholds;
  const setInput = (id, value) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = value;
  };
  setInput('dev-th-db-warn', th.db_warn);
  setInput('dev-th-db-err', th.db_err);
  setInput('dev-th-onb-warn', th.onb_warn);
  setInput('dev-th-onb-err', th.onb_err);
  const d = state.devMetrics;
  const status = document.getElementById('dev-status-line');
  const badge = document.getElementById('dev-health-badge');
  const health = getDevHealthState(d, th);
  if (badge) {
    badge.classList.remove('badge-gray', 'badge-green', 'badge-orange', 'badge-red');
    badge.classList.add(health.cls);
    badge.textContent = health.label;
  }
  if (!d) {
    if (status) status.textContent = 'Nessun dato diagnostico disponibile.';
    return;
  }
  if (status) status.textContent = `Server ${d.version} - ultimo check ${new Date(d.server_time).toLocaleString('it-IT')}`;
  document.getElementById('dev-db-lat').textContent = `${d.db_latency_ms} ms`;
  document.getElementById('dev-uptime').textContent = `${Math.floor((d.uptime_sec || 0)/60)} min`;
  document.getElementById('dev-mem').textContent = `${d.memory_mb} MB`;
  document.getElementById('dev-onb').textContent = `${d.onboarding?.pending ?? 0}`;
  const act = document.getElementById('dev-recent-activity');
  if (act) {
    const rows = d.recent_activity || [];
    act.innerHTML = rows.length
      ? rows.map(r => `<div style="padding:6px 0;border-bottom:1px solid var(--border);"><b>${r.action}</b> - ${r.user_name}<br><span style="color:var(--text3);">${r.detail || ''} (${new Date(r.ts).toLocaleTimeString('it-IT')})</span></div>`).join('')
      : '<div style="color:var(--text3);">Nessuna attivita recente</div>';
  }
  const err = document.getElementById('dev-errors');
  if (err) err.innerHTML = state.devErrors.length
    ? `<b>Errori recenti:</b><br>${state.devErrors.map(escHtml).join('<br>')}`
    : '';
  const smokeEl = document.getElementById('dev-smoke');
  if (smokeEl) {
    if (!state.devSmoke) {
      smokeEl.innerHTML = 'Smoke test non eseguito.';
    } else {
      const lines = (state.devSmoke.checks || []).map(c => {
        const value = c.ms != null ? `${c.ms} ms` : (c.value != null ? `${c.value}` : '');
        const detail = c.error ? ` - ${escHtml(c.error)}` : (value ? ` - ${escHtml(value)}` : '');
        return `${c.ok ? '[OK]' : '[KO]'} ${escHtml(c.check)}${detail}`;
      });
      smokeEl.innerHTML = `<b>Smoke ${state.devSmoke.ok ? 'OK' : 'KO'}</b> (${new Date(state.devSmoke.ts).toLocaleString('it-IT')})<br>${lines.join('<br>')}`;
    }
  }
}

