(function () {
  const roleLabels = {
    admin: 'Admin / Ufficio',
    amministrazione: 'Amministrazione',
    autista: 'Autista / Agente',
    magazzino: 'Magazzino',
    direzione: 'Direzione',
  };

  function renderMessaggiTopbarBadge() {
    const badge = document.getElementById('topbar-msg-badge');
    if (!badge) return;
    const unread = Number(window.state.messagesUnreadCount || 0);
    if (unread > 0) {
      badge.style.display = 'inline-flex';
      badge.textContent = String(unread);
    } else {
      badge.style.display = 'none';
      badge.textContent = '';
    }
    if (typeof window.refreshNavBadges === 'function') window.refreshNavBadges();
  }

  async function loadMessaggiSummary() {
    if (!window.state.token) return;
    const data = await window.api('GET', '/api/messaggi/summary').catch(() => ({ unread_count: 0, recent: [] }));
    window.state.messagesUnreadCount = Number(data.unread_count || 0);
    window.state.messagesRecent = Array.isArray(data.recent) ? data.recent : [];
    renderMessaggiTopbarBadge();
  }

  function stopMessaggiPolling() {
    if (window.state.messagesPoller) {
      clearInterval(window.state.messagesPoller);
      window.state.messagesPoller = null;
    }
  }

  function startMessaggiPolling() {
    stopMessaggiPolling();
    if (!window.state.token) return;
    window.state.messagesPoller = setInterval(() => {
      loadMessaggiSummary().catch(() => {});
      if (window.state.currentPage === 'messaggi') loadMessaggiPageData().catch(() => {});
    }, 15000);
  }

  function getMessaggiListForCurrentBox() {
    return window.state.messagesCurrentBox === 'sent'
      ? (window.state.messagesSent || [])
      : (window.state.messagesInbox || []);
  }

  function renderMessaggiComposeDestinations() {
    const typeEl = document.getElementById('msg-dest-type');
    const userWrap = document.getElementById('msg-dest-user-wrap');
    const roleWrap = document.getElementById('msg-dest-role-wrap');
    const userSel = document.getElementById('msg-dest-user');
    const roleSel = document.getElementById('msg-dest-role');
    const clientSel = document.getElementById('msg-client-id');
    if (!typeEl || !userWrap || !roleWrap || !userSel || !roleSel || !clientSel) return;

    const users = [...(window.state.utenti || [])]
      .filter(u => Number(u.id) !== Number(window.state.currentUser?.id))
      .sort((a, b) => `${a.nome} ${a.cognome || ''}`.localeCompare(`${b.nome} ${b.cognome || ''}`, 'it', { sensitivity: 'base' }));
    userSel.innerHTML = users.map(u => `<option value="${u.id}">${window.escapeHtml((u.nome + ' ' + (u.cognome || '')).trim())} - ${window.escapeHtml(roleLabels[u.ruolo] || u.ruolo)}</option>`).join('');
    roleSel.innerHTML = Object.entries(roleLabels).map(([key, label]) => `<option value="${key}">${window.escapeHtml(label)}</option>`).join('');
    clientSel.innerHTML = `<option value="">Nessun cliente</option>` + [...(window.state.clienti || [])]
      .filter(c => !(typeof window.isTentataVenditaCliente === 'function' && window.isTentataVenditaCliente(c)))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' }))
      .map(c => `<option value="${c.id}">${window.escapeHtml(c.nome)}</option>`).join('');

    const isRole = typeEl.value === 'role';
    userWrap.style.display = isRole ? 'none' : 'block';
    roleWrap.style.display = isRole ? 'block' : 'none';
  }

  function renderMessaggiList() {
    const listEl = document.getElementById('messaggi-list');
    if (!listEl) return;
    const rows = getMessaggiListForCurrentBox();
    const selectedId = Number(window.state.messagesSelectedId || 0);
    if (!rows.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">M</div><p>Nessun messaggio in questa casella.</p></div>';
      return;
    }
    listEl.innerHTML = rows.map(msg => {
      const isInbox = window.state.messagesCurrentBox === 'inbox';
      const unread = isInbox && !msg.letto_at;
      const active = Number(msg.id) === selectedId;
      const counterpart = isInbox
        ? (msg.mittente_nome || 'Utente')
        : (msg.destinatario_tipo === 'role' ? (roleLabels[msg.destinatario_ruolo] || msg.destinatario_ruolo) : (msg.destinatario_nome || 'Utente'));
      const refs = [
        msg.ordine_id ? `<span class="badge badge-blue">Ordine #${msg.ordine_id}</span>` : '',
        msg.cliente_id ? `<span class="badge badge-soft">${window.escapeHtml(msg.cliente_nome || `Cliente #${msg.cliente_id}`)}</span>` : '',
      ].filter(Boolean).join(' ');
      const testo = String(msg.testo || '');
      const preview = window.escapeHtml(testo.slice(0, 140)) + (testo.length > 140 ? '...' : '');
      return `
        <button class="card" onclick="openMessaggioDettaglio(${msg.id})" style="width:100%;text-align:left;margin-top:12px;border:${active ? '1.5px solid var(--accent)' : '1px solid var(--border)'};background:${unread ? '#f5fbff' : 'var(--surface)'};">
          <div style="padding:12px 14px;">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
              <div style="font-size:13px;font-weight:700;color:var(--text1);">${window.escapeHtml(msg.oggetto || '(senza oggetto)')}</div>
              ${unread ? '<span class="badge badge-orange">Nuovo</span>' : ''}
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px;">${isInbox ? 'Da' : 'A'} ${window.escapeHtml(counterpart)} - ${window.escapeHtml(window.formatNotificationDateTime(msg.created_at) || '')}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:8px;line-height:1.45;">${preview}</div>
            ${refs ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${refs}</div>` : ''}
          </div>
        </button>
      `;
    }).join('');
  }

  function renderMessaggiDetail() {
    const detailEl = document.getElementById('messaggi-detail');
    if (!detailEl) return;
    const rows = [...(window.state.messagesInbox || []), ...(window.state.messagesSent || [])];
    const msg = rows.find(item => Number(item.id) === Number(window.state.messagesSelectedId || 0));
    if (!msg) {
      detailEl.textContent = 'Seleziona un messaggio per leggere il contenuto.';
      return;
    }
    const isInbox = (window.state.messagesInbox || []).some(item => Number(item.id) === Number(msg.id));
    const counterpart = isInbox
      ? `Da ${msg.mittente_nome || 'Utente'}`
      : `A ${msg.destinatario_tipo === 'role' ? (roleLabels[msg.destinatario_ruolo] || msg.destinatario_ruolo) : (msg.destinatario_nome || 'Utente')}`;
    detailEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px;">
        <div>
          <div style="font-size:15px;font-weight:800;color:var(--text1);">${window.escapeHtml(msg.oggetto || '(senza oggetto)')}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px;">${window.escapeHtml(counterpart)} - ${window.escapeHtml(window.formatNotificationDateTime(msg.created_at) || '')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${msg.ordine_id ? `<button class="btn btn-outline btn-sm" onclick="openMessaggioOrdine(${msg.ordine_id})">Ordine #${msg.ordine_id}</button>` : ''}
          ${msg.cliente_id ? `<button class="btn btn-outline btn-sm" onclick="openMessaggioCliente(${msg.cliente_id})">${window.escapeHtml(msg.cliente_nome || 'Cliente')}</button>` : ''}
        </div>
      </div>
      <div style="white-space:pre-wrap;line-height:1.55;color:var(--text1);padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);">${window.escapeHtml(msg.testo || '')}</div>
    `;
  }

  function renderMessaggiPage() {
    renderMessaggiComposeDestinations();
    const sub = document.getElementById('messaggi-sub');
    if (sub) sub.textContent = `Inbox personale - non letti: ${Number(window.state.messagesUnreadCount || 0)}`;
    const inboxTab = document.getElementById('msg-tab-inbox');
    const sentTab = document.getElementById('msg-tab-sent');
    if (inboxTab) inboxTab.classList.toggle('active', window.state.messagesCurrentBox !== 'sent');
    if (sentTab) sentTab.classList.toggle('active', window.state.messagesCurrentBox === 'sent');
    renderMessaggiList();
    renderMessaggiDetail();
    if (!window.state.messagesLoaded) {
      loadMessaggiPageData().catch(() => {});
    }
  }

  async function loadMessaggiPageData() {
    const data = await window.api('GET', '/api/messaggi');
    window.state.messagesInbox = Array.isArray(data.inbox) ? data.inbox : [];
    window.state.messagesSent = Array.isArray(data.sent) ? data.sent : [];
    window.state.messagesUnreadCount = Number(data.unread_count || 0);
    window.state.messagesLoaded = true;
    renderMessaggiTopbarBadge();
    const rows = getMessaggiListForCurrentBox();
    if (!rows.find(item => Number(item.id) === Number(window.state.messagesSelectedId || 0))) {
      window.state.messagesSelectedId = rows[0]?.id || null;
    }
    renderMessaggiPage();
  }

  function setMessaggiBox(box) {
    window.state.messagesCurrentBox = box === 'sent' ? 'sent' : 'inbox';
    const rows = getMessaggiListForCurrentBox();
    window.state.messagesSelectedId = rows[0]?.id || null;
    renderMessaggiPage();
  }

  async function markMessaggioRead(id) {
    await window.api('POST', `/api/messaggi/${id}/read`, {});
    const item = (window.state.messagesInbox || []).find(msg => Number(msg.id) === Number(id));
    if (item) item.letto_at = new Date().toISOString();
    window.state.messagesUnreadCount = Math.max(0, Number(window.state.messagesUnreadCount || 0) - 1);
    renderMessaggiTopbarBadge();
  }

  async function openMessaggioDettaglio(id) {
    const inboxItem = (window.state.messagesInbox || []).find(msg => Number(msg.id) === Number(id));
    window.state.messagesSelectedId = id;
    if (inboxItem && !inboxItem.letto_at) {
      try {
        await markMessaggioRead(id);
      } catch (_) {
      }
    }
    renderMessaggiPage();
  }

  async function sendInternalMessage() {
    const body = {
      destinatario_tipo: document.getElementById('msg-dest-type')?.value || 'user',
      destinatario_user_id: Number(document.getElementById('msg-dest-user')?.value || 0) || null,
      destinatario_ruolo: document.getElementById('msg-dest-role')?.value || '',
      oggetto: (document.getElementById('msg-subject')?.value || '').trim(),
      testo: (document.getElementById('msg-body')?.value || '').trim(),
      ordine_id: Number(document.getElementById('msg-order-id')?.value || 0) || null,
      cliente_id: Number(document.getElementById('msg-client-id')?.value || 0) || null,
    };
    if (!body.testo) {
      window.showToast('Scrivi un messaggio', 'warning');
      return;
    }
    await window.api('POST', '/api/messaggi', body);
    document.getElementById('msg-subject').value = '';
    document.getElementById('msg-body').value = '';
    document.getElementById('msg-order-id').value = '';
    document.getElementById('msg-client-id').value = '';
    window.showToast('Messaggio inviato', 'success');
    await loadMessaggiPageData();
    await loadMessaggiSummary();
    setMessaggiBox('sent');
  }

  async function openMessaggioOrdine(id) {
    if (!id) return;
    if (typeof window.openOrderNotification === 'function') {
      await window.openOrderNotification(0, id);
      return;
    }
    window.goTo('ordini');
  }

  function openMessaggioCliente(id) {
    if (!id) return;
    const cliente = (window.state.clienti || []).find(c => Number(c.id) === Number(id));
    window.goTo('clienti');
    if (cliente) {
      window.setTimeout(() => {
        const search = document.getElementById('search-clienti');
        if (search) search.value = cliente.nome || '';
        if (typeof window.renderClientiTable === 'function') window.renderClientiTable();
      }, 30);
    }
  }

  window.loadMessaggiSummary = loadMessaggiSummary;
  window.startMessaggiPolling = startMessaggiPolling;
  window.stopMessaggiPolling = stopMessaggiPolling;
  window.renderMessaggiPage = renderMessaggiPage;
  window.loadMessaggiPageData = loadMessaggiPageData;
  window.renderMessaggiComposeDestinations = renderMessaggiComposeDestinations;
  window.setMessaggiBox = setMessaggiBox;
  window.openMessaggioDettaglio = openMessaggioDettaglio;
  window.sendInternalMessage = sendInternalMessage;
  window.openMessaggioOrdine = openMessaggioOrdine;
  window.openMessaggioCliente = openMessaggioCliente;
})();
