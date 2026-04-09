(function () {
  const navOpenSections = new Set();
  const AUTH_STORAGE_KEY = 'norbalat_auth_session';

  const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const NAV_ICONS = {
    dashboard: `<svg ${S}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    ordini: `<svg ${S}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>`,
    magazzino: `<svg ${S}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
    giacenze: `<svg ${S}><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`,
    tentata: `<svg ${S}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 001.98-1.67L23 6H6"/></svg>`,
    piano: `<svg ${S}><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
    autista: `<svg ${S}><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
    clienti: `<svg ${S}><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>`,
    crm: `<svg ${S}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>`,
    prodotti: `<svg ${S}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    utenti: `<svg ${S}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
    ferie: `<svg ${S}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    messaggi: `<svg ${S}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    report: `<svg ${S}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`,
    listini: `<svg ${S}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
    rese: `<svg ${S}><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>`,
    sperimentale: `<svg ${S}><path d="M9 3h6m-1 0v6l4 11a1 1 0 01-1 1H7a1 1 0 01-1-1l4-11V3"/></svg>`,
    documenti: `<svg ${S}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`,
    impostazioni: `<svg ${S}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
    profilo: `<svg ${S}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  };

  const navConfigs = {
    admin: [
      {
        section: 'Dashboard',
        items: [
          { page: 'dashboard', icon: NAV_ICONS.dashboard, label: 'Dashboard' },
        ],
      },
      {
        section: 'Ordini',
        items: [
          { page: 'ordini', icon: NAV_ICONS.ordini, label: 'Ordini' },
        ],
      },
      {
        section: 'Magazzino',
        items: [
          { page: 'magazzino', icon: NAV_ICONS.magazzino, label: 'Preparazione' },
          { page: 'giacenze', icon: NAV_ICONS.giacenze, label: 'Giacenze' },
          { page: 'tentata', icon: NAV_ICONS.tentata, label: 'Tentata Vendita' },
          { page: 'piano', icon: NAV_ICONS.piano, label: 'Piano Carico' },
        ],
      },
      {
        section: 'Anagrafiche',
        items: [
          { page: 'clienti', icon: NAV_ICONS.clienti, label: 'Clienti' },
          { page: 'crm', icon: NAV_ICONS.crm, label: 'CRM' },
          { page: 'prodotti', icon: NAV_ICONS.prodotti, label: 'Prodotti' },
          { page: 'utenti', icon: NAV_ICONS.utenti, label: 'Utenti' },
          { page: 'ferie', icon: NAV_ICONS.ferie, label: 'Calendario' },
          { page: 'messaggi', icon: NAV_ICONS.messaggi, label: 'Messaggi' },
        ],
      },
      {
        section: 'Statistiche',
        items: [
          { page: 'report', icon: NAV_ICONS.report, label: 'Report' },
        ],
      },
      {
        section: 'Utility',
        items: [
          { page: 'listini', icon: NAV_ICONS.listini, label: 'Listini' },
          { page: 'rese', icon: NAV_ICONS.rese, label: 'Gestione Rese' },
          { page: 'sperimentale', icon: NAV_ICONS.sperimentale, label: 'CLAL' },
          { page: 'documenti', icon: NAV_ICONS.documenti, label: 'Documenti' },
          { page: 'impostazioni', icon: NAV_ICONS.impostazioni, label: 'Impostazioni' },
        ],
      },
      {
        section: 'Profilo',
        items: [
          { page: 'profilo', icon: NAV_ICONS.profilo, label: 'Il mio profilo' },
        ],
      },
    ],
    amministrazione: [
      { page: 'dashboard', icon: NAV_ICONS.dashboard, label: 'Dashboard' },
      { page: 'clienti', icon: NAV_ICONS.clienti, label: 'Clienti' },
      { page: 'crm', icon: NAV_ICONS.crm, label: 'CRM' },
      { page: 'ferie', icon: NAV_ICONS.ferie, label: 'Calendario' },
      { page: 'documenti', icon: NAV_ICONS.documenti, label: 'Documenti' },
      { page: 'listini', icon: NAV_ICONS.listini, label: 'Listini' },
      { page: 'ordini', icon: NAV_ICONS.ordini, label: 'Ordini' },
      { page: 'report', icon: NAV_ICONS.report, label: 'Report' },
      { page: 'messaggi', icon: NAV_ICONS.messaggi, label: 'Messaggi' },
      { page: 'profilo', icon: NAV_ICONS.profilo, label: 'Il mio profilo' },
    ],
    autista: [
      { page: 'dashboard', icon: NAV_ICONS.dashboard, label: 'Dashboard' },
      { page: 'autista', icon: NAV_ICONS.autista, label: 'Il mio giro' },
      { page: 'ferie', icon: NAV_ICONS.ferie, label: 'Calendario' },
      { page: 'tentata', icon: NAV_ICONS.tentata, label: 'Tentata Vendita' },
      { page: 'documenti', icon: NAV_ICONS.documenti, label: 'Documenti' },
      { page: 'piano', icon: NAV_ICONS.piano, label: 'Piano Carico' },
      { page: 'ordini', icon: NAV_ICONS.ordini, label: 'Tutti gli ordini' },
      { page: 'messaggi', icon: NAV_ICONS.messaggi, label: 'Messaggi' },
      { page: 'profilo', icon: NAV_ICONS.profilo, label: 'Il mio profilo' },
    ],
    magazzino: [
      { page: 'dashboard', icon: NAV_ICONS.dashboard, label: 'Dashboard' },
      { page: 'magazzino', icon: NAV_ICONS.magazzino, label: 'Da preparare' },
      { page: 'ferie', icon: NAV_ICONS.ferie, label: 'Calendario' },
      { page: 'giacenze', icon: NAV_ICONS.giacenze, label: 'Giacenze' },
      { page: 'tentata', icon: NAV_ICONS.tentata, label: 'Tentata Vendita' },
      { page: 'documenti', icon: NAV_ICONS.documenti, label: 'Documenti' },
      { page: 'piano', icon: NAV_ICONS.piano, label: 'Piano Carico' },
      { page: 'ordini', icon: NAV_ICONS.ordini, label: 'Ordini' },
      { page: 'messaggi', icon: NAV_ICONS.messaggi, label: 'Messaggi' },
      { page: 'report', icon: NAV_ICONS.report, label: 'PDF Ordini' },
      { page: 'profilo', icon: NAV_ICONS.profilo, label: 'Il mio profilo' },
    ],
    direzione: [
      { page: 'dashboard', icon: NAV_ICONS.dashboard, label: 'Dashboard' },
      { page: 'ordini', icon: NAV_ICONS.ordini, label: 'Ordini' },
      { page: 'giacenze', icon: NAV_ICONS.giacenze, label: 'Giacenze' },
      { page: 'clienti', icon: NAV_ICONS.clienti, label: 'Clienti' },
      { page: 'crm', icon: NAV_ICONS.crm, label: 'CRM' },
      { page: 'prodotti', icon: NAV_ICONS.prodotti, label: 'Prodotti' },
      { page: 'ferie', icon: NAV_ICONS.ferie, label: 'Calendario' },
      { page: 'messaggi', icon: NAV_ICONS.messaggi, label: 'Messaggi' },
      { page: 'report', icon: NAV_ICONS.report, label: 'Report' },
      { page: 'listini', icon: NAV_ICONS.listini, label: 'Listini' },
      { page: 'rese', icon: NAV_ICONS.rese, label: 'Gestione Rese' },
      { page: 'sperimentale', icon: NAV_ICONS.sperimentale, label: 'CLAL' },
      { page: 'documenti', icon: NAV_ICONS.documenti, label: 'Documenti' },
      { page: 'profilo', icon: NAV_ICONS.profilo, label: 'Il mio profilo' },
    ],
  };

  const mobileNavConfigs = {
    direzione: ['dashboard', 'ordini', 'giacenze', 'clienti'],
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

  function getMobileNavItems(role, items) {
    const preferredPages = mobileNavConfigs[role];
    if (!preferredPages?.length) return items.slice(0, 4);
    const mobileItems = preferredPages
      .map(page => items.find(item => item.page === page))
      .filter(Boolean);
    return mobileItems.length ? mobileItems : items.slice(0, 4);
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
        return clienti.filter(c => (typeof window.isClienteAnagrafico === 'function' ? window.isClienteAnagrafico(c) : true) && ['bozza', 'in_attesa', 'in_verifica', 'sospeso'].includes(c.onboardingStato)).length;
      }
      const today = typeof window.today === 'function' ? window.today() : '';
      return Object.values(crmSummary).filter(c => c?.followup_date && String(c.followup_date).slice(0, 10) <= today).length;
    }
    if (page === 'crm') {
      const today = typeof window.today === 'function' ? window.today() : '';
      return clienti
        .filter(c => typeof window.isCrmProspectCliente === 'function' && window.isCrmProspectCliente(c))
        .filter(c => {
          const item = crmSummary[c.id];
          return item?.followup_date && String(item.followup_date).slice(0, 10) <= today;
        }).length;
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
    if (typeof window.stopFerieSyncPolling === 'function') window.stopFerieSyncPolling();
    if (typeof window.stopOrdersSyncPolling === 'function') window.stopOrdersSyncPolling();
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
    window.state.messagesDetail = null;
    window.state.messagesFilters = { q: '', stato: '', priorita: '', onlyUnread: false, assignedToMe: false };
    window.state.messagesLoaded = false;
    window.state.messagesPoller = null;
    window.state.topbarNotifications = [];
    window.state.orderNotificationSeenId = 0;
    window.state.orderNotificationPoller = null;
    window.state.ferieSyncPoller = null;
    window.state.ordersSyncPoller = null;
    window.state.ordersLastSyncAt = '';
    window.state.ordersLastSyncId = 0;
    window.state.ordersSyncPendingRender = false;
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
    if (role === 'admin') {
      navOpenSections.add(getSectionKey('Magazzino'));
    }
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
      const mobileItems = getMobileNavItems(role, items);
      mobileNav.innerHTML = mobileItems.map(i => `
      <button class="mobile-nav-item" id="mnav-${i.page}" onclick="goTo('${i.page}')">
        <span class="mn-icon">${i.icon}</span>${i.label}
      </button>
    `).join('');
    }

    syncCollapsibleNav();
    refreshNavBadges();
    if (typeof window.scheduleResponsiveTablesRefresh === 'function') window.scheduleResponsiveTablesRefresh();
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
    if (page === 'crm' && typeof window.renderCrmPage === 'function') window.renderCrmPage();
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
    if (typeof window.scheduleResponsiveTablesRefresh === 'function') window.scheduleResponsiveTablesRefresh();
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
    if (typeof window.initGlobalUppercaseEnforcer === 'function') window.initGlobalUppercaseEnforcer();
    if (typeof window.initEntitySelectAutocomplete === 'function') window.initEntitySelectAutocomplete();
    tryRestoreSession();
  });
})();
