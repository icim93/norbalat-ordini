(function () {
  let selectedRole = 'admin';

  const navConfigs = {
    admin: [
      { page: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { page: 'ordini', icon: '📋', label: 'Ordini' },
      { page: 'magazzino', icon: '📦', label: 'Magazzino' },
      { page: 'autista', icon: '🚚', label: 'Vista Autista' },
      { page: 'clienti', icon: '🏢', label: 'Clienti' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'listini', icon: '💶', label: 'Listini' },
      { page: 'rese', icon: '♻️', label: 'Gestione Rese' },
      { page: 'prodotti', icon: '🧀', label: 'Prodotti' },
      { page: 'utenti', icon: '👥', label: 'Utenti' },
      { page: 'piano', icon: '🚛', label: 'Piano Carico' },
      { page: 'report', icon: '📊', label: 'Report' },
      { page: 'impostazioni', icon: '⚙️', label: 'Impostazioni' },
      { page: 'sperimentale', icon: '🧪', label: 'Sperimentale' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
    amministrazione: [
      { page: 'clienti', icon: '🏢', label: 'Clienti' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'listini', icon: '💶', label: 'Listini' },
      { page: 'ordini', icon: '📋', label: 'Ordini' },
      { page: 'report', icon: '📊', label: 'Report' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
    autista: [
      { page: 'autista', icon: '🚚', label: 'Il mio giro' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'piano', icon: '🚛', label: 'Piano Carico' },
      { page: 'ordini', icon: '📋', label: 'Tutti gli ordini' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
    magazzino: [
      { page: 'magazzino', icon: '📦', label: 'Da preparare' },
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'piano', icon: '🚛', label: 'Piano Carico' },
      { page: 'ordini', icon: '📋', label: 'Ordini' },
      { page: 'report', icon: '📄', label: 'PDF Ordini' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
    direzione: [
      { page: 'documenti', icon: '🗂️', label: 'Documenti' },
      { page: 'listini', icon: '💶', label: 'Listini' },
      { page: 'rese', icon: '♻️', label: 'Gestione Rese' },
      { page: 'report', icon: '📊', label: 'Report' },
      { page: 'sperimentale', icon: '🧪', label: 'Sperimentale' },
      { page: 'ordini', icon: '📋', label: 'Ordini' },
      { page: 'profilo', icon: '👤', label: 'Il mio profilo' },
    ],
  };

  function selectRole(role, el) {
    selectedRole = role;
    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }

  async function doLogin() {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
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

      window.state.token = data.token;
      window.state.currentUser = window.normalizeUtente(data.user);
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
      const defaultPages = { admin: 'dashboard', amministrazione: 'clienti', autista: 'autista', magazzino: 'magazzino', direzione: 'report' };
      goTo(defaultPages[window.state.currentUser.ruolo] || 'dashboard');
      window.startDevMonitor();
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
    window.state.scorte = [];
    window.state.scorteAlertSignature = '';
    window.state.magazzinoHighlightOrderId = null;
    window.state.magazzinoUndoStack = [];
    document.getElementById('screen-app').style.display = 'none';
    document.getElementById('screen-login').style.display = 'flex';
  }

  function setupNav() {
    const role = window.state.currentUser.ruolo;
    const items = navConfigs[role] || navConfigs.admin;
    const u = window.state.currentUser;
    const roleLabels = { admin: 'Admin / Ufficio', amministrazione: 'Amministrazione', autista: 'Autista / Agente', magazzino: 'Magazzino', direzione: 'Direzione' };
    const sidebar = document.getElementById('sidebar-nav');
    sidebar.innerHTML = items.map(i => `
    <button class="nav-item" id="nav-${i.page}" onclick="goTo('${i.page}')">
      <span class="nav-icon">${i.icon}</span> ${i.label}
    </button>
  `).join('');

    const drawerNav = document.getElementById('drawer-nav');
    if (drawerNav) {
      drawerNav.innerHTML = items.map(i => `
      <button class="drawer-nav-item" id="dnav-${i.page}" onclick="goTo('${i.page}');closeDrawer()">
        <span class="drawer-nav-icon">${i.icon}</span>${i.label}
      </button>
    `).join('');
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
    if (page === 'piano') window.renderPianoPage();
    if (page === 'report') window.renderReport();
    if (page === 'impostazioni') window.renderImpostazioni();
    if (page === 'sperimentale') window.renderSperimentale();
    if (page === 'profilo') window.renderProfilo();
  }

  window.selectRole = selectRole;
  window.doLogin = doLogin;
  window.doLogout = doLogout;
  window.setupNav = setupNav;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;
  window.goTo = goTo;
  window.renderPage = renderPage;
})();



