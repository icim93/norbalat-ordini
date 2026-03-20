(function () {
  const navOpenSections = new Set();
  const AUTH_STORAGE_KEY = 'norbalat_auth_session';

  const navConfigs = {
    admin: [
      {
        section: 'Dashboard',
        items: [
          { page: 'dashboard', icon: '🏠', label: 'Dashboard' },
        ],
      },
      {
        section: 'Ordini',
        items: [
          { page: 'ordini', icon: '📋', label: 'Ordini' },
        ],
      },
      {
        section: 'Magazzino',
        items: [
          { page: 'magazzino', icon: '📋', label: 'Preparazione' },
          { page: 'giacenze', icon: '📦', label: 'Giacenze' },
          { page: 'tentata', icon: '🚚', label: 'Tentata Vendita' },
          { page: 'piano', icon: '🚛', label: 'Piano Carico' },
          { page: 'autista', icon: '🚚', label: 'Vista Autista' },
        ],
      },
      {
        section: 'Anagrafiche',
        items: [
          { page: 'clienti', icon: '🏢', label: 'Clienti' },
          { page: 'prodotti', icon: '🧀', label: 'Prodotti' },
          { page: 'utenti', icon: '👥', label: 'Utenti' },
          { page: 'ferie', icon: '🌴', label: 'Ferie' },
          { page: 'messaggi', icon: '✉️', label: 'Messaggi' },
        ],
      },
      {
        section: 'Statistiche',
        items: [
          { page: 'report', icon: '📊', label: 'Report' },
        ],
      },
      {
        section: 'Utility',
        items: [
          { page: 'listini', icon: '💶', label: 'Listini' },
          { page: 'rese', icon: '♻️', label: 'Gestione Rese' },
          { page: 'sperimentale', icon: '🧪', label: 'CLAL' },
          { page: 'documenti', icon: '🗂️', label: 'Documenti' },
          { page: 'impostazioni', icon: '⚙️', label: 'Impostazioni' },
        ],
      },
      {
        section: 'Profilo',
        items: [
          { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
        ],
      },
    ],
    amministrazione: [
      { page: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { page: 'clienti', icon: '🏢', label: 'Clienti' },
      { page: 'ferie', icon: '🌴', label: 'Ferie' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'listini', icon: '💶', label: 'Listini' },
      { page: 'ordini', icon: '📋', label: 'Ordini' },
      { page: 'report', icon: '📊', label: 'Report' },
      { page: 'messaggi', icon: '✉️', label: 'Messaggi' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
    autista: [
      { page: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { page: 'autista', icon: '🚚', label: 'Il mio giro' },
      { page: 'tentata', icon: '🛒', label: 'Tentata Vendita' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'piano', icon: '🚛', label: 'Piano Carico' },
      { page: 'ordini', icon: '📋', label: 'Tutti gli ordini' },
      { page: 'messaggi', icon: '✉️', label: 'Messaggi' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
    magazzino: [
      { page: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { page: 'magazzino', icon: '📋', label: 'Da preparare' },
      { page: 'giacenze', icon: '📦', label: 'Giacenze' },
      { page: 'tentata', icon: '🚚', label: 'Tentata Vendita' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'piano', icon: '🚛', label: 'Piano Carico' },
      { page: 'ordini', icon: '📋', label: 'Ordini' },
      { page: 'messaggi', icon: '✉️', label: 'Messaggi' },
      { page: 'report', icon: '📄', label: 'PDF Ordini' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
    direzione: [
      { page: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { page: 'clienti', icon: '🏢', label: 'Clienti' },
      { page: 'ferie', icon: '🌴', label: 'Ferie' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'listini', icon: '💶', label: 'Listini' },
      { page: 'rese', icon: '♻️', label: 'Gestione Rese' },
      { page: 'report', icon: '📊', label: 'Report' },
      { page: 'sperimentale', icon: '🧪', label: 'CLAL' },
      { page: 'ordini', icon: '📋', label: 'Ordini' },
      { page: 'messaggi', icon: '✉️', label: 'Messaggi' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
  };

  function getFlatNavItems(config) {
    return (config || []).flatMap(entry => Array.isArray(entry.items) ? entry.items : [entry]);
  }

  function getSectionKey(section) {
    return String(section || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function getSectionForPage(config, page) {
    const group = (config || []).find(entry => Array.isArray(entry.items) && entry.items.some(item => item.page === page));
    return group?.section || null;
  }

  function ensurePageSectionOpen(config, page) {
    const section = getSectionForPage(config, page);
    if (section) navOpenSections.add(getSectionKey(section));
  }

  function getNavBadgeValue(page) {
    const ordini = window.state.ordini || [];
    const clienti = window.state.clienti || [];
    const crmSummary = window.state.crmSummary || {};
    if (page === 'ordini') {
      return ordini.filter(o => o.stato === 'attesa' || o.stato === 'preparazione').length;
    }
    if (page === 'magazzino') {
      const today = typeof window.today === 'function' ? window.today() : '';
      return ordini.filter(o => o.data === today && o.stato !== 'consegnato' && o.stato !== 'annullato').length;
    }
    if (page === 'giacenze') {
      const alerts = window.state.giacenzeAlerts || {};
      return (alerts.sotto_soglia?.length || 0) + (alerts.in_scadenza?.length || 0);
    }
    if (page === 'clienti') {
      if (typeof window.canApproveOnboarding === 'function' && window.canApproveOnboarding()) {
        return clienti.filter(c => ['bozza', 'in_attesa', 'in_verifica', 'sospeso'].includes(c.onboardingStato)).length;
      }
      const today = typeof window.today === 'function' ? window.today() : '';
      return Object.values(crmSummary).filter(c => c?.followup_date && String(c.followup_date).slice(0, 10) <= today).length;
    }
    if (page === 'documenti') {
      return Array.isArray(window.state.docCurrentFiles) ? window.state.docCurrentFiles.length : 0;
    }
    if (page === 'piano') {
      return (window.state.camions || []).filter(c => !c.confermato).length;
    }
    if (page === 'autista') {
      const today = typeof window.today === 'function' ? window.today() : '';
      const userId = window.state.currentUser?.id;
      return ordini.filter(o => o.data === today && (o.agenteId === userId || o.autistaDiGiro === userId) && o.stato !== 'annullato').length;
    }
    if (page === 'messaggi') {
      return Number(window.state.messagesUnreadCount || 0);
    }
    return 0;
  }

  function renderNavBadge(page, type) {
    const value = getNavBadgeValue(page);
    const cls = type === 'drawer' ? 'drawer-nav-badge' : 'nav-item-badge';
    return `<span class="${cls}" data-nav-badge="${page}" style="${value ? '' : 'display:none;'}">${value || ''}</span>`;
  }

  function renderNavButton(item, prefix = 'nav', extra = '') {
    const isDrawer = extra === 'drawer-nav-item';
    return `
    <button class="${extra || 'nav-item'}" id="${prefix}-${item.page}" onclick="goTo('${item.page}')">
      <span class="${isDrawer ? 'drawer-nav-icon' : 'nav-icon'}">${item.icon}</span>
      <span class="${isDrawer ? 'drawer-nav-label' : 'nav-item-label'}">${item.label}${renderNavBadge(item.page, isDrawer ? 'drawer' : 'sidebar')}</span>
    </button>
  `;
  }

  function renderSectionToggle(section, type) {
    const key = getSectionKey(section);
    const baseClass = type === 'drawer' ? 'drawer-nav-section-toggle' : 'nav-section-toggle';
    const labelClass = type === 'drawer' ? 'drawer-nav-section-label' : 'nav-section-label';
    const chevronClass = type === 'drawer' ? 'drawer-nav-section-chevron' : 'nav-section-chevron';
    return `
      <button class="${baseClass}" type="button" data-section-toggle="${key}" onclick="toggleNavSection('${key}')">
        <span class="${labelClass}">${section}</span>
        <span class="${chevronClass}">▾</span>
      </button>
    `;
  }

  function renderSidebarNav(config) {
    const hasSections = (config || []).some(entry => Array.isArray(entry.items));
    if (!hasSections) {
      return config.map(item => renderNavButton(item)).join('');
    }
    return config.map(group => `
      <div class="nav-section" data-section="${getSectionKey(group.section)}">
        ${renderSectionToggle(group.section, 'sidebar')}
        <div class="nav-section-items" data-section-items="${getSectionKey(group.section)}">
          ${group.items.map(item => renderNavButton(item)).join('')}
        </div>
      </div>
    `).join('');
  }

  function renderDrawerNav(config) {
    const hasSections = (config || []).some(entry => Array.isArray(entry.items));
    const renderItem = (item) => `
      <button class="drawer-nav-item" id="dnav-${item.page}" onclick="goTo('${item.page}');closeDrawer()">
        <span class="drawer-nav-icon">${item.icon}</span>${item.label}
      </button>
    `;
    if (!hasSections) {
      return config.map(renderItem).join('');
    }
    return config.map(group => `
      <div class="drawer-nav-section" data-section="${getSectionKey(group.section)}">
        ${renderSectionToggle(group.section, 'drawer')}
        <div class="drawer-nav-section-items" data-section-items="${getSectionKey(group.section)}">
          ${group.items.map(renderItem).join('')}
        </div>
      </div>
    `).join('');
  }

  function syncCollapsibleNav() {
    document.querySelectorAll('[data-section]').forEach(sectionEl => {
      const key = sectionEl.getAttribute('data-section');
      sectionEl.classList.toggle('open', navOpenSections.has(key));
    });
  }

  function refreshNavBadges() {
    document.querySelectorAll('[data-nav-badge]').forEach(el => {
      const page = el.getAttribute('data-nav-badge');
      const value = getNavBadgeValue(page);
      if (value) {
        el.textContent = String(value);
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  }

  function toggleNavSection(sectionKey) {
    if (!sectionKey) return;
    if (navOpenSections.has(sectionKey)) navOpenSections.delete(sectionKey);
    else navOpenSections.add(sectionKey);
    syncCollapsibleNav();
  }

  function getStoredAuth() {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
  }

  function storeAuthSession(token, user, remember) {
    const payload = JSON.stringify({ token, user });
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    (remember ? localStorage : sessionStorage).setItem(AUTH_STORAGE_KEY, payload);
  }

  function clearStoredAuth() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  }

  async function applyAuthenticatedSession(token, user) {
    window.state.token = token;
    window.state.currentUser = window.normalizeUtente(user);
    window.loadDevErrors();
    window.state.devThresholds = window.loadDevThresholds();
    await window.loadAllData();

    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-app').style.display = 'block';
    document.getElementById('topbar-username').textContent =
      (window.state.currentUser.nome + ' ' + (window.state.currentUser.cognome || '')).trim();
    const roleLabels = { admin: 'Admin', amministrazione: 'Amministrazione', autista: 'Autista', magazzino: 'Magazzino', direzione: 'Direzione' };
    document.getElementById('topbar-role').textContent = roleLabels[window.state.currentUser.ruolo];
    setupNav();
    const defaultPages = { admin: 'dashboard', amministrazione: 'dashboard', autista: 'dashboard', magazzino: 'dashboard', direzione: 'dashboard' };
    goTo(defaultPages[window.state.currentUser.ruolo] || 'dashboard');
    window.startDevMonitor();
  }

  async function doLogin() {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const remember = !!document.getElementById('login-remember')?.checked;
    if (!username || !password) {
      window.showToast('Inserisci username e password', 'warning');
      return;
    }

    const btn = document.querySelector('#screen-login .btn-primary');
    if (btn) {
      btn.textContent = 'Accesso...';
      btn.disabled = true;
    }

    try {
      const data = await fetch(window.BASE_URL + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Credenziali errate');
        return d;
      });

      storeAuthSession(data.token, data.user, remember);
      await applyAuthenticatedSession(data.token, data.user);
    } catch (e) {
      const raw = String(e?.message || '');
      const credErr = raw.toLowerCase().includes('username o password') || raw.toLowerCase().includes('credenziali');
      window.showToast(credErr ? 'Username o password errati' : (raw || 'Errore di connessione'), 'warning');
    } finally {
      if (btn) {
        btn.textContent = 'Accedi ->';
        btn.disabled = false;
      }
    }
  }

  function doLogout() {
    window.stopDevMonitor();
    if (typeof window.stopTopbarNotificationPolling === 'function') window.stopTopbarNotificationPolling();
    if (typeof window.stopMessaggiPolling === 'function') window.stopMessaggiPolling();
    clearStoredAuth();
    window.state.token = null;
    window.state.currentUser = null;
    window.state.utenti = [];
    window.state.clienti = [];
    window.state.prodotti = [];
    window.state.listini = [];
    window.state.rese = [];
    window.state.listinoProdottoId = null;
    window.state.ordini = [];
    window.state.camions = [];
    window.state.pianoData = '';
    window.state.giriCalendario = [];
    window.state.devMetrics = null;
    window.state.devSmoke = null;
    window.state.devErrors = [];
    window.state.devThresholds = null;
    window.state.emailNotifications = null;
    window.state.emailNotificationsLoaded = false;
    window.state.crmSummary = {};
    window.state.docFolders = [];
    window.state.docCurrentFolderId = null;
    window.state.docCurrentFiles = [];
    window.state.docCanManage = false;
    window.state.magazzinoHighlightOrderId = null;
    window.state.magazzinoUndoStack = [];
    window.state.magazzinoResidualLog = [];
    window.state.messagesInbox = [];
    window.state.messagesSent = [];
    window.state.messagesUnreadCount = 0;
    window.state.messagesRecent = [];
    window.state.messagesCurrentBox = 'inbox';
    window.state.messagesSelectedId = null;
    window.state.messagesLoaded = false;
    window.state.messagesPoller = null;
    window.state.topbarNotifications = [];
    window.state.orderNotificationSeenId = 0;
    window.state.orderNotificationPoller = null;
    document.getElementById('screen-app').style.display = 'none';
    document.getElementById('screen-login').style.display = 'flex';
  }

  async function tryRestoreSession() {
    const stored = getStoredAuth();
    if (!stored?.token || !stored?.user) return;
    try {
      await applyAuthenticatedSession(stored.token, stored.user);
    } catch (_) {
      clearStoredAuth();
      doLogout();
    }
  }

  function setupNav() {
    const role = window.state.currentUser.ruolo;
    const config = navConfigs[role] || navConfigs.admin;
    const items = getFlatNavItems(config);
    navOpenSections.clear();
    ensurePageSectionOpen(config, window.state.currentPage || items[0]?.page);
    const u = window.state.currentUser;
    const roleLabels = { admin: 'Admin / Ufficio', amministrazione: 'Amministrazione', autista: 'Autista / Agente', magazzino: 'Magazzino', direzione: 'Direzione' };
    const sidebar = document.getElementById('sidebar-nav');
    sidebar.innerHTML = renderSidebarNav(config);

    const drawerNav = document.getElementById('drawer-nav');
    if (drawerNav) {
      drawerNav.innerHTML = renderDrawerNav(config);
    }

    const dn = document.getElementById('drawer-username');
    const dr = document.getElementById('drawer-role');
    if (dn) dn.textContent = (u.nome + ' ' + (u.cognome || '')).trim();
    if (dr) dr.textContent = roleLabels[u.ruolo] || u.ruolo;

    const mobileNav = document.getElementById('mobile-nav-items');
    if (mobileNav) {
      mobileNav.innerHTML = items.slice(0, 4).map(i => `
      <button class="mobile-nav-item" id="mnav-${i.page}" onclick="goTo('${i.page}')">
        <span class="mn-icon">${i.icon}</span>${i.label}
      </button>
    `).join('');
    }

    syncCollapsibleNav();
    refreshNavBadges();
  }

  function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  function goTo(page) {
    closeDrawer();
    const role = window.state.currentUser?.ruolo;
    const config = navConfigs[role] || navConfigs.admin;
    ensurePageSectionOpen(config, page);
    syncCollapsibleNav();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item, .mobile-nav-item, .drawer-nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    const nav = document.getElementById('nav-' + page);
    if (nav) nav.classList.add('active');
    const mnav = document.getElementById('mnav-' + page);
    if (mnav) mnav.classList.add('active');
    const dnav = document.getElementById('dnav-' + page);
    if (dnav) dnav.classList.add('active');
    window.state.currentPage = page;
    renderPage(page);
  }

  function renderPage(page) {
    if (page === 'dashboard') window.renderDashboard();
    if (page === 'ordini') window.renderOrdiniTable();
    if (page === 'clienti') window.renderClientiTable();
    if (page === 'documenti') window.renderDocumentiPage();
    if (page === 'listini') window.renderListiniPage();
    if (page === 'rese') window.renderResePage();
    if (page === 'prodotti') window.renderProdottiTable();
    if (page === 'utenti') window.renderUtentiTable();
    if (page === 'autista') window.renderAutistaView();
    if (page === 'magazzino') {
      const dtInput = document.getElementById('filter-magazzino-data');
      if (dtInput && !dtInput.value) dtInput.value = window.today();
      window.renderMagazzino();
    }
    if (page === 'giacenze') window.renderGiacenzePage();
    if (page === 'messaggi') window.renderMessaggiPage();
    if (page === 'tentata') window.renderTentataPage();
    if (page === 'piano') window.renderPianoPage();
    if (page === 'ferie') window.renderFeriePage();
    if (page === 'report') window.renderReport();
    if (page === 'impostazioni') window.renderImpostazioni();
    if (page === 'sperimentale') window.renderSperimentale();
    if (page === 'profilo') window.renderProfilo();
  }

  window.doLogin = doLogin;
  window.doLogout = doLogout;
  window.setupNav = setupNav;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
  window.goTo = goTo;
  window.refreshNavBadges = refreshNavBadges;
  window.toggleNavSection = toggleNavSection;
  window.renderPage = renderPage;

  document.addEventListener('DOMContentLoaded', () => {
    const rememberEl = document.getElementById('login-remember');
    if (rememberEl) rememberEl.checked = !!localStorage.getItem(AUTH_STORAGE_KEY);
    tryRestoreSession();
  });
})();



