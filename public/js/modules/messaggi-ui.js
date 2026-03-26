(function () {
  const roleLabels = {
    admin: 'Admin / Ufficio',
    amministrazione: 'Amministrazione',
    autista: 'Autista / Agente',
    magazzino: 'Magazzino',
    direzione: 'Direzione',
  };

  const priorityLabels = {
    bassa: 'Bassa',
    media: 'Media',
    alta: 'Alta',
    urgente: 'Urgente',
  };

  const priorityBadges = {
    bassa: 'badge-gray',
    media: 'badge-blue',
    alta: 'badge-orange',
    urgente: 'badge-red',
  };

  const statusLabels = {
    nuovo: 'Nuovo',
    preso_in_carico: 'Preso in carico',
    in_attesa: 'In attesa',
    chiuso: 'Chiuso',
  };

  const statusBadges = {
    nuovo: 'badge-orange',
    preso_in_carico: 'badge-blue',
    in_attesa: 'badge-soft',
    chiuso: 'badge-gray',
  };

  const MESSAGE_POLL_INTERVAL_DEFAULT_MS = 15000;
  const MESSAGE_POLL_INTERVAL_ACTIVE_MS = 3000;

  const presets = {
    problema_ordine: {
      subject: 'Problema ordine',
      priority: 'alta',
      role: 'amministrazione',
      body: 'Segnalo una criticita su ordine collegato. Dettaglio problema:\n',
    },
    followup_cliente: {
      subject: 'Follow-up cliente',
      priority: 'media',
      role: 'direzione',
      body: 'Aggiornamento cliente / azione richiesta:\n',
    },
    richiesta_magazzino: {
      subject: 'Richiesta magazzino',
      priority: 'media',
      role: 'magazzino',
      body: 'Serve verifica / supporto magazzino per:\n',
    },
    avviso_direzione: {
      subject: 'Avviso direzione',
      priority: 'alta',
      role: 'direzione',
      body: 'Porto alla tua attenzione il seguente punto:\n',
    },
  };

  function ensureMessaggiState() {
    if (!window.state.messagesFilters) {
      window.state.messagesFilters = { q: '', stato: '', priorita: '', onlyUnread: false, assignedToMe: false };
    }
    if (!window.state.messagesDetail) window.state.messagesDetail = null;
    if (typeof window.state.messagesSummaryInitialized !== 'boolean') window.state.messagesSummaryInitialized = false;
    if (!('messagesLastToastConversationId' in window.state)) window.state.messagesLastToastConversationId = 0;
    if (typeof window.state.messagesPollingBound !== 'boolean') window.state.messagesPollingBound = false;
    if (typeof window.state.messagesPollInFlight !== 'boolean') window.state.messagesPollInFlight = false;
  }

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
    ensureMessaggiState();
    const prevUnread = Number(window.state.messagesUnreadCount || 0);
    const data = await window.api('GET', '/api/messaggi/summary').catch(() => ({ unread_count: 0, recent: [] }));
    window.state.messagesUnreadCount = Number(data.unread_count || 0);
    window.state.messagesRecent = Array.isArray(data.recent) ? data.recent : [];
    const newest = window.state.messagesRecent[0] || null;
    const newestId = Number(newest?.id || 0);
    if (
      window.state.messagesSummaryInitialized
      && window.state.currentPage !== 'messaggi'
      && Number(window.state.messagesUnreadCount || 0) > prevUnread
      && newestId
      && newestId !== Number(window.state.messagesLastToastConversationId || 0)
      && newest?.unread
    ) {
      window.state.messagesLastToastConversationId = newestId;
      window.showToast(`Nuovo messaggio da ${getConversationCounterpart(newest, true)}`, 'info');
    }
    window.state.messagesSummaryInitialized = true;
    renderMessaggiTopbarBadge();
    if (window.state.currentPage === 'dashboard' && typeof window.renderDashboard === 'function') window.renderDashboard();
  }

  function stopMessaggiPolling() {
    if (window.state.messagesPoller) {
      clearTimeout(window.state.messagesPoller);
      window.state.messagesPoller = null;
    }
  }

  function getMessaggiPollInterval() {
    const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    return isVisible && window.state.currentPage === 'messaggi'
      ? MESSAGE_POLL_INTERVAL_ACTIVE_MS
      : MESSAGE_POLL_INTERVAL_DEFAULT_MS;
  }

  async function runMessaggiPollingCycle() {
    if (!window.state.token) return;
    ensureMessaggiState();
    if (window.state.messagesPollInFlight) return;
    window.state.messagesPollInFlight = true;
    try {
      await loadMessaggiSummary();
      if (window.state.currentPage === 'messaggi') await loadMessaggiPageData(true);
    } finally {
      window.state.messagesPollInFlight = false;
      if (window.state.token) {
        window.state.messagesPoller = setTimeout(() => {
          runMessaggiPollingCycle().catch(() => {});
        }, getMessaggiPollInterval());
      }
    }
  }

  function bindMessaggiRealtimeRefresh() {
    ensureMessaggiState();
    if (window.state.messagesPollingBound || typeof document === 'undefined') return;
    const refreshNow = () => {
      if (!window.state.token || document.visibilityState !== 'visible') return;
      runMessaggiPollingCycle().catch(() => {});
    };
    document.addEventListener('visibilitychange', refreshNow);
    window.addEventListener('focus', refreshNow);
    window.state.messagesPollingBound = true;
  }

  function startMessaggiPolling() {
    stopMessaggiPolling();
    if (!window.state.token) return;
    bindMessaggiRealtimeRefresh();
    runMessaggiPollingCycle().catch(() => {});
  }

  function getMessaggiListForCurrentBox() {
    return window.state.messagesCurrentBox === 'sent'
      ? (window.state.messagesSent || [])
      : (window.state.messagesInbox || []);
  }

  function getConversationCounterpart(conv, isInbox) {
    const kind = String(conv.conversation_kind || '').toLowerCase();
    const participantIds = Array.isArray(conv.partecipanti_user_ids) ? conv.partecipanti_user_ids.map(v => Number(v)) : [];
    const participantNames = Array.isArray(conv.partecipanti_nomi) ? conv.partecipanti_nomi.filter(Boolean) : [];
    const currentUserId = Number(window.state.currentUser?.id || 0);
    if (kind === 'self') return 'Note personali';
    if (kind === 'group') return conv.nome_chat || participantNames.join(', ') || 'Gruppo';
    if (kind === 'direct') {
      const otherId = participantIds.find(id => Number(id) !== currentUserId);
      const otherUser = (window.state.utenti || []).find(u => Number(u.id) === Number(otherId));
      if (otherUser) return `${otherUser.nome} ${otherUser.cognome || ''}`.trim();
      const otherName = participantNames.find(name => name && name !== `${window.state.currentUser?.nome || ''} ${window.state.currentUser?.cognome || ''}`.trim());
      if (otherName) return otherName;
    }
    if (isInbox) return conv.created_by_name || 'Utente';
    if (conv.destinatario_tipo === 'role') return roleLabels[conv.destinatario_ruolo] || conv.destinatario_ruolo || 'Ruolo';
    return conv.destinatario_nome || 'Utente';
  }

  function getConversationSearchText(conv) {
    return [
      conv.nome_chat,
      conv.oggetto,
      conv.last_message_text,
      conv.cliente_nome,
      ...(Array.isArray(conv.partecipanti_nomi) ? conv.partecipanti_nomi : []),
      conv.created_by_name,
      conv.destinatario_nome,
      conv.destinatario_ruolo,
      conv.assegnato_nome,
      conv.ordine_id ? `ordine ${conv.ordine_id}` : '',
    ].join(' ').toLowerCase();
  }

  function syncFiltersFromDom() {
    ensureMessaggiState();
    const filters = window.state.messagesFilters;
    filters.q = (document.getElementById('msg-search')?.value || '').trim().toLowerCase();
    filters.stato = document.getElementById('msg-filter-status')?.value || '';
    filters.priorita = document.getElementById('msg-filter-priority')?.value || '';
    filters.onlyUnread = !!document.getElementById('msg-filter-unread')?.checked;
    filters.assignedToMe = !!document.getElementById('msg-filter-mine')?.checked;
    return filters;
  }

  function applyMessaggiFilters(rows) {
    const filters = syncFiltersFromDom();
    return rows.filter(conv => {
      if (filters.q && !getConversationSearchText(conv).includes(filters.q)) return false;
      if (filters.stato && conv.stato !== filters.stato) return false;
      if (filters.priorita && conv.priorita !== filters.priorita) return false;
      if (filters.onlyUnread && !conv.unread) return false;
      if (filters.assignedToMe && Number(conv.assegnato_user_id || 0) !== Number(window.state.currentUser?.id || 0)) return false;
      return true;
    });
  }

  function renderMessaggiComposeDestinations() {
    const typeEl = document.getElementById('msg-dest-type');
    const userWrap = document.getElementById('msg-dest-user-wrap');
    const groupWrap = document.getElementById('msg-dest-group-wrap');
    const roleWrap = document.getElementById('msg-dest-role-wrap');
    const groupNameWrap = document.getElementById('msg-group-name-wrap');
    const userSel = document.getElementById('msg-dest-user');
    const groupSel = document.getElementById('msg-dest-group');
    const roleSel = document.getElementById('msg-dest-role');
    if (!typeEl || !userWrap || !groupWrap || !roleWrap || !groupNameWrap || !userSel || !groupSel || !roleSel) return;

    const keepUser = userSel.value;
    const keepGroup = new Set([...(groupSel.selectedOptions || [])].map(opt => opt.value));
    const keepRole = roleSel.value;

    const users = [...(window.state.utenti || [])]
      .filter(u => Number(u.id) !== Number(window.state.currentUser?.id))
      .sort((a, b) => `${a.nome} ${a.cognome || ''}`.localeCompare(`${b.nome} ${b.cognome || ''}`, 'it', { sensitivity: 'base' }));
    userSel.innerHTML = users.length
      ? users.map(u => `<option value="${u.id}">${window.escapeHtml((u.nome + ' ' + (u.cognome || '')).trim())} - ${window.escapeHtml(roleLabels[u.ruolo] || u.ruolo)}</option>`).join('')
      : '<option value="">Nessun utente disponibile</option>';
    if (keepUser) userSel.value = keepUser;

    groupSel.innerHTML = users.length
      ? users.map(u => `<option value="${u.id}">${window.escapeHtml((u.nome + ' ' + (u.cognome || '')).trim())} - ${window.escapeHtml(roleLabels[u.ruolo] || u.ruolo)}</option>`).join('')
      : '<option value="">Nessun utente disponibile</option>';
    [...groupSel.options].forEach(opt => { if (keepGroup.has(opt.value)) opt.selected = true; });

    roleSel.innerHTML = Object.entries(roleLabels).map(([key, label]) => `<option value="${key}">${window.escapeHtml(label)}</option>`).join('');
    if (keepRole) roleSel.value = keepRole;

    const mode = typeEl.value;
    const isRole = mode === 'role';
    const isGroup = mode === 'group';
    const isSelf = mode === 'self';
    userWrap.style.display = (!isRole && !isGroup && !isSelf) ? 'block' : 'none';
    groupWrap.style.display = isGroup ? 'block' : 'none';
    roleWrap.style.display = isRole ? 'block' : 'none';
    groupNameWrap.style.display = isGroup ? 'block' : 'none';
  }

  function applyMessaggioPreset() {
    const presetKey = document.getElementById('msg-preset')?.value || '';
    const preset = presets[presetKey];
    if (!preset) return;
    const subject = document.getElementById('msg-subject');
    const priority = document.getElementById('msg-priority');
    const destType = document.getElementById('msg-dest-type');
    const destRole = document.getElementById('msg-dest-role');
    const body = document.getElementById('msg-body');
    if (subject && !subject.value.trim()) subject.value = preset.subject;
    if (priority) priority.value = preset.priority;
    if (destType && destRole && preset.role) {
      destType.value = 'role';
      renderMessaggiComposeDestinations();
      destRole.value = preset.role;
    }
    if (body && !body.value.trim()) body.value = preset.body;
  }

  function normalizeMessageToken(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getUserMentionToken(user) {
    return `@${normalizeMessageToken(user?.username || `${user?.nome || ''} ${user?.cognome || ''}`)}`;
  }

  function getClientReferenceToken(cliente) {
    return `*${normalizeMessageToken(cliente?.nome || '')}`;
  }

  function getComposerTriggerMatch(text, caretPos) {
    const uptoCaret = String(text || '').slice(0, Math.max(0, Number(caretPos || 0)));
    const match = uptoCaret.match(/(^|\s)([@*])([^\s@*#]*)$/);
    if (!match) return null;
    return {
      trigger: match[2],
      query: match[3] || '',
      start: uptoCaret.length - (match[2].length + (match[3] || '').length),
      end: uptoCaret.length,
    };
  }

  function buildComposerSuggestions(trigger, query) {
    const q = normalizeMessageToken(query);
    if (trigger === '@') {
      return [...(window.state.utenti || [])]
        .filter(u => Number(u.id) !== Number(window.state.currentUser?.id || 0))
        .map(u => ({
          kind: 'user',
          id: Number(u.id),
          label: `${u.nome} ${u.cognome || ''}`.trim(),
          meta: roleLabels[u.ruolo] || u.ruolo,
          token: `${getUserMentionToken(u)} `,
          search: `${u.username || ''} ${u.nome || ''} ${u.cognome || ''} ${u.ruolo || ''}`,
        }))
        .filter(item => !q || normalizeMessageToken(item.search).includes(q))
        .slice(0, 8);
    }
    if (trigger === '*') {
      return [...(window.state.clienti || [])]
        .map(c => ({
          kind: 'client',
          id: Number(c.id),
          label: String(c.nome || '').trim() || `Cliente #${c.id}`,
          meta: c.localita || c.citta || '',
          token: `${getClientReferenceToken(c)} `,
          search: `${c.nome || ''} ${c.localita || ''} ${c.citta || ''}`,
        }))
        .filter(item => !q || normalizeMessageToken(item.search).includes(q))
        .slice(0, 8);
    }
    return [];
  }

  function hideComposerPicker(pickerId) {
    const picker = document.getElementById(pickerId);
    if (!picker) return;
    picker.style.display = 'none';
    picker.innerHTML = '';
    picker.dataset.activeIndex = '0';
    picker.dataset.trigger = '';
    picker.dataset.start = '';
    picker.dataset.end = '';
  }

  function applyComposerSuggestion(textarea, pickerId, index) {
    const picker = document.getElementById(pickerId);
    if (!textarea || !picker) return false;
    const suggestions = Array.isArray(window.state.messageComposerSuggestions?.[pickerId]) ? window.state.messageComposerSuggestions[pickerId] : [];
    const item = suggestions[index];
    if (!item) return false;
    const start = Number(picker.dataset.start || 0);
    const end = Number(picker.dataset.end || 0);
    const value = textarea.value || '';
    textarea.value = `${value.slice(0, start)}${item.token}${value.slice(end)}`;
    const nextPos = start + item.token.length;
    textarea.focus();
    textarea.setSelectionRange(nextPos, nextPos);
    hideComposerPicker(pickerId);
    return true;
  }

  function renderComposerPicker(textarea, pickerId, suggestions, match) {
    const picker = document.getElementById(pickerId);
    if (!picker) return;
    window.state.messageComposerSuggestions = window.state.messageComposerSuggestions || {};
    window.state.messageComposerSuggestions[pickerId] = suggestions;
    if (!suggestions.length || !match) {
      hideComposerPicker(pickerId);
      return;
    }
    picker.dataset.activeIndex = '0';
    picker.dataset.trigger = match.trigger;
    picker.dataset.start = String(match.start);
    picker.dataset.end = String(match.end);
    picker.innerHTML = suggestions.map((item, index) => `
      <button type="button" class="btn btn-outline btn-sm" style="width:100%;justify-content:flex-start;border:none;border-radius:0;padding:10px 12px;background:${index === 0 ? 'var(--surface2)' : 'transparent'};" onmousedown="event.preventDefault()" onclick="applyMessageComposerSuggestion('${pickerId}', ${index})">
        <span style="display:block;text-align:left;">
          <strong>${window.escapeHtml(item.label)}</strong><br>
          <span style="font-size:11px;color:var(--text3);">${window.escapeHtml(item.meta || item.token.trim())}</span>
        </span>
      </button>
    `).join('');
    picker.style.display = 'block';
  }

  function handleMessageComposerInput(textarea, pickerId) {
    if (!textarea) return;
    const match = getComposerTriggerMatch(textarea.value, textarea.selectionStart);
    const suggestions = match ? buildComposerSuggestions(match.trigger, match.query) : [];
    renderComposerPicker(textarea, pickerId, suggestions, match);
  }

  function handleMessageComposerKeydown(event, textarea, pickerId, mode = 'reply') {
    const picker = document.getElementById(pickerId);
    const hasPicker = !!picker && picker.style.display !== 'none' && picker.children.length > 0;
    const maxIndex = hasPicker ? picker.children.length - 1 : -1;
    let activeIndex = Number(picker?.dataset.activeIndex || 0);
    if (hasPicker && event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(maxIndex, activeIndex + 1);
      picker.dataset.activeIndex = String(activeIndex);
      [...picker.children].forEach((child, idx) => { child.style.background = idx === activeIndex ? 'var(--surface2)' : 'transparent'; });
      return;
    }
    if (hasPicker && event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      picker.dataset.activeIndex = String(activeIndex);
      [...picker.children].forEach((child, idx) => { child.style.background = idx === activeIndex ? 'var(--surface2)' : 'transparent'; });
      return;
    }
    if (hasPicker && (event.key === 'Tab' || event.key === 'Enter')) {
      event.preventDefault();
      applyComposerSuggestion(textarea, pickerId, activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      hideComposerPicker(pickerId);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (mode === 'new') sendInternalMessage().catch(e => window.showToast(e.message || 'Errore invio chat', 'warning'));
      else replyToConversation().catch(e => window.showToast(e.message || 'Errore invio messaggio', 'warning'));
    }
  }

  function openMessaggiComposeModal() {
    const body = document.getElementById('msg-body');
    const destType = document.getElementById('msg-dest-type');
    if (destType) destType.value = 'user';
    renderMessaggiComposeDestinations();
    if (body) body.value = '';
    const groupName = document.getElementById('msg-group-name');
    if (groupName) groupName.value = '';
    hideComposerPicker('msg-body-picker');
    if (typeof window.openModal === 'function') window.openModal('modal-messaggi-compose');
    window.setTimeout(() => body?.focus(), 30);
  }

  function applyMessageComposerSuggestion(pickerId, index) {
    const textarea = pickerId === 'msg-body-picker'
      ? document.getElementById('msg-body')
      : document.getElementById('msg-reply-body');
    return applyComposerSuggestion(textarea, pickerId, index);
  }

  function renderMessageRichText(rawText) {
    const text = String(rawText || '');
    const regex = /(#ordine\d+|@[a-z0-9._-]+|\*[a-z0-9._-]+)/gi;
    let lastIndex = 0;
    const parts = [];
    for (const match of text.matchAll(regex)) {
      const token = match[0];
      const index = match.index || 0;
      if (index > lastIndex) parts.push(window.escapeHtml(text.slice(lastIndex, index)));
      if (/^#ordine\d+$/i.test(token)) {
        const orderId = Number(token.replace(/[^0-9]/g, ''));
        parts.push(`<button class="btn btn-outline btn-sm" style="margin:0 2px;vertical-align:middle;" onclick="openMessaggioOrdine(${orderId})">${window.escapeHtml(token)}</button>`);
      } else if (token.startsWith('@')) {
        const slug = normalizeMessageToken(token.slice(1));
        const user = (window.state.utenti || []).find(u => normalizeMessageToken(u.username || `${u.nome || ''} ${u.cognome || ''}`) === slug);
        parts.push(`<span class="badge badge-blue" title="${window.escapeHtml(user ? `${user.nome} ${user.cognome || ''}`.trim() : token)}">${window.escapeHtml(`@${user ? `${user.nome} ${user.cognome || ''}`.trim() : token.slice(1)}`)}</span>`);
      } else if (token.startsWith('*')) {
        const slug = normalizeMessageToken(token.slice(1));
        const cliente = (window.state.clienti || []).find(c => normalizeMessageToken(c.nome || '') === slug);
        if (cliente) {
          parts.push(`<button class="btn btn-outline btn-sm" style="margin:0 2px;vertical-align:middle;" onclick="openMessaggioCliente(${Number(cliente.id)})">${window.escapeHtml(`*${cliente.nome}`)}</button>`);
        } else {
          parts.push(`<span class="badge badge-soft">${window.escapeHtml(token)}</span>`);
        }
      }
      lastIndex = index + token.length;
    }
    if (lastIndex < text.length) parts.push(window.escapeHtml(text.slice(lastIndex)));
    return parts.join('').replace(/\n/g, '<br>');
  }

  function renderMessaggiList() {
    const listEl = document.getElementById('messaggi-list');
    if (!listEl) return;
    const rows = applyMessaggiFilters(getMessaggiListForCurrentBox());
    const selectedId = Number(window.state.messagesSelectedId || 0);
    if (!rows.length) {
      listEl.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--text3);font-size:13px;">Nessuna conversazione.</div>';
      return;
    }
    listEl.innerHTML = rows.map(conv => {
      const isInbox = window.state.messagesCurrentBox !== 'sent';
      const unread = isInbox && !!conv.unread;
      const active = Number(conv.id) === selectedId;
      const counterpart = getConversationCounterpart(conv, isInbox);
      const initials = String(counterpart || '?').trim().split(/\s+/).slice(0, 2).map(v => v.charAt(0)).join('').toUpperCase() || '?';
      const preview = String(conv.last_message_text || conv.oggetto || '').slice(0, 70);
      const timeStr = window.escapeHtml(window.formatNotificationDateTime(conv.last_message_at) || '');
      const unreadCount = unread ? (Number(conv.unread_count || 0) || 1) : 0;
      const avatarBg = unread ? 'var(--accent)' : 'var(--surface2)';
      const avatarColor = unread ? '#fff' : 'var(--accent)';
      const priorityBadge = conv.priorita && conv.priorita !== 'media'
        ? `<span class="badge ${priorityBadges[conv.priorita] || 'badge-gray'}" style="font-size:10px;">${window.escapeHtml(priorityLabels[conv.priorita] || conv.priorita)}</span>`
        : '';
      const statusBadge = conv.stato && conv.stato !== 'nuovo'
        ? `<span class="badge ${statusBadges[conv.stato] || 'badge-gray'}" style="font-size:10px;">${window.escapeHtml(statusLabels[conv.stato] || conv.stato)}</span>`
        : '';
      return `
        <div class="msg-conv-item${active ? ' active' : ''}${unread ? ' unread' : ''}" onclick="openMessaggioDettaglio(${conv.id})">
          <div class="msg-conv-avatar" style="background:${avatarBg};color:${avatarColor};">${window.escapeHtml(initials)}</div>
          <div class="msg-conv-body">
            <div class="msg-conv-row1">
              <div class="msg-conv-name">${window.escapeHtml(counterpart)}</div>
              <div class="msg-conv-time${unread ? ' unread' : ''}">${timeStr}</div>
            </div>
            <div class="msg-conv-row2">
              <div class="msg-conv-preview">${window.escapeHtml(preview)}${preview.length >= 70 ? '…' : ''}</div>
              ${unreadCount > 0 ? `<div class="msg-conv-unread-dot">${unreadCount > 9 ? '9+' : unreadCount}</div>` : ''}
            </div>
            ${priorityBadge || statusBadge ? `<div class="msg-conv-badges">${priorityBadge}${statusBadge}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function buildAssigneeOptions(selectedId) {
    const users = [...(window.state.utenti || [])]
      .sort((a, b) => `${a.nome} ${a.cognome || ''}`.localeCompare(`${b.nome} ${b.cognome || ''}`, 'it', { sensitivity: 'base' }));
    return `<option value="">Non assegnata</option>` + users.map(u => `<option value="${u.id}" ${Number(u.id) === Number(selectedId || 0) ? 'selected' : ''}>${window.escapeHtml((u.nome + ' ' + (u.cognome || '')).trim())}</option>`).join('');
  }

  function renderMessaggiDetail() {
    const detailEl = document.getElementById('messaggi-detail');
    if (!detailEl) return;
    const detail = window.state.messagesDetail;
    const conv = detail?.conversation;
    if (!conv || Number(conv.id || 0) !== Number(window.state.messagesSelectedId || 0)) {
      detailEl.innerHTML = `
        <div style="text-align:center;color:var(--text3);padding:40px 20px;">
          <div style="font-size:48px;margin-bottom:12px;">💬</div>
          <div style="font-size:15px;font-weight:700;color:var(--text2);margin-bottom:6px;">Apri una conversazione</div>
          <div style="font-size:13px;">Seleziona una chat dalla colonna sinistra.</div>
        </div>`;
      return;
    }
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    const isInbox = window.state.messagesCurrentBox !== 'sent';
    const counterpart = getConversationCounterpart(conv, isInbox);
    const counterpartInitials = String(counterpart || '?').trim().split(/\s+/).slice(0, 2).map(v => v.charAt(0)).join('').toUpperCase() || '?';
    const metaOpen = !!window.state.messagesMetaOpen;

    // Override placeholder styles so content fills the shell correctly
    detailEl.style.display = 'flex';
    detailEl.style.flexDirection = 'column';
    detailEl.style.alignItems = 'stretch';
    detailEl.style.justifyContent = 'flex-start';
    detailEl.style.height = '100%';
    detailEl.style.minHeight = '0';

    detailEl.innerHTML = `
      <!-- Header -->
      <div class="msg-thread-header">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--surface2);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;">${window.escapeHtml(counterpartInitials)}</div>
        <div class="msg-thread-header-info">
          <div class="msg-thread-header-name">${window.escapeHtml(counterpart)}</div>
          <div class="msg-thread-header-meta">
            ${window.escapeHtml(conv.oggetto || '')}
            ${conv.ordine_id ? `· <button class="btn btn-outline btn-sm" style="padding:1px 7px;font-size:11px;" onclick="openMessaggioOrdine(${conv.ordine_id})">Ordine #${conv.ordine_id}</button>` : ''}
            ${conv.cliente_id ? `· <button class="btn btn-outline btn-sm" style="padding:1px 7px;font-size:11px;" onclick="openMessaggioCliente(${conv.cliente_id})">${window.escapeHtml(conv.cliente_nome || 'Cliente')}</button>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">
          <span class="badge ${priorityBadges[conv.priorita] || 'badge-gray'}" style="font-size:11px;">${window.escapeHtml(priorityLabels[conv.priorita] || conv.priorita || 'Media')}</span>
          <span class="badge ${statusBadges[conv.stato] || 'badge-gray'}" style="font-size:11px;">${window.escapeHtml(statusLabels[conv.stato] || conv.stato || 'Nuovo')}</span>
          ${isInbox ? '<button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="takeConversationInCharge()">Prendi in carico</button>' : ''}
          <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="toggleMessaggiMeta()">⚙</button>
        </div>
      </div>

      <!-- Meta panel (collapsible) -->
      <div class="msg-meta-panel" id="msg-meta-panel" style="${metaOpen ? '' : 'display:none;'}">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;align-items:end;">
          <div class="field" style="margin:0;">
            <label>Stato</label>
            <select id="msg-detail-status">
              <option value="nuovo" ${conv.stato === 'nuovo' ? 'selected' : ''}>Nuovo</option>
              <option value="preso_in_carico" ${conv.stato === 'preso_in_carico' ? 'selected' : ''}>Preso in carico</option>
              <option value="in_attesa" ${conv.stato === 'in_attesa' ? 'selected' : ''}>In attesa</option>
              <option value="chiuso" ${conv.stato === 'chiuso' ? 'selected' : ''}>Chiuso</option>
            </select>
          </div>
          <div class="field" style="margin:0;">
            <label>Priorita</label>
            <select id="msg-detail-priority">
              <option value="bassa" ${conv.priorita === 'bassa' ? 'selected' : ''}>Bassa</option>
              <option value="media" ${conv.priorita === 'media' ? 'selected' : ''}>Media</option>
              <option value="alta" ${conv.priorita === 'alta' ? 'selected' : ''}>Alta</option>
              <option value="urgente" ${conv.priorita === 'urgente' ? 'selected' : ''}>Urgente</option>
            </select>
          </div>
          <div class="field" style="margin:0;">
            <label>Assegnazione</label>
            <select id="msg-detail-assignee">${buildAssigneeOptions(conv.assegnato_user_id)}</select>
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button class="btn btn-green btn-sm" onclick="saveConversationMeta()">Salva</button>
          </div>
        </div>
      </div>

      <!-- Messages -->
      <div class="msg-thread-messages" id="msg-thread-scroll">
        ${messages.length ? messages.map(msg => {
          const mine = Number(msg.mittente_id || 0) === Number(window.state.currentUser?.id || 0);
          const side = mine ? 'mine' : 'theirs';
          return `
            <div class="msg-bubble-wrap ${side}">
              <div class="msg-bubble ${side}">
                ${!mine ? `<div class="msg-bubble-sender">${window.escapeHtml(msg.mittente_nome || 'Utente')}</div>` : ''}
                <div>${renderMessageRichText(msg.testo || '')}</div>
                <div class="msg-bubble-footer">
                  <span class="msg-bubble-time">${window.escapeHtml(window.formatNotificationDateTime(msg.created_at) || '')}</span>
                  ${mine ? '<span style="color:#53bdeb;font-size:13px;">✓✓</span>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('') : '<div style="text-align:center;color:var(--text3);font-size:13px;padding:24px;">Nessun messaggio nel thread.</div>'}
      </div>

      <!-- Reply bar -->
      <div class="msg-reply-bar">
        <div class="msg-reply-bar-wrap">
          <textarea id="msg-reply-body" class="msg-reply-textarea" rows="1" placeholder="Scrivi un messaggio… (@utente, *cliente, #ordine123)" oninput="handleMessageComposerInput(this,'msg-reply-picker');autoResizeReplyBar(this)" onkeydown="handleMessageComposerKeydown(event,this,'msg-reply-picker','reply')"></textarea>
          <div id="msg-reply-picker" style="display:none;position:absolute;bottom:100%;left:0;right:0;margin-bottom:4px;border:1px solid var(--border);border-radius:12px;background:var(--surface);max-height:220px;overflow:auto;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:10;"></div>
        </div>
        <button class="msg-reply-send" onclick="replyToConversation()" title="Invia (Enter)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    // scroll to bottom
    window.requestAnimationFrame(() => {
      const scroller = document.getElementById('msg-thread-scroll');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  function renderMessaggiPage() {
    ensureMessaggiState();
    renderMessaggiComposeDestinations();
    const sub = document.getElementById('messaggi-sub');
    const currentRows = getMessaggiListForCurrentBox();
    const unread = Number(window.state.messagesUnreadCount || 0);
    if (sub) sub.textContent = `Inbox personale - non lette: ${unread} · conversazioni ${currentRows.length}`;
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

  function updateConversationCollection(collectionKey, conversation) {
    if (!conversation) return;
    const list = Array.isArray(window.state[collectionKey]) ? window.state[collectionKey] : [];
    const idx = list.findIndex(item => Number(item.id) === Number(conversation.id));
    if (idx < 0) return;
    list[idx] = { ...list[idx], ...conversation };
    list.sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')) || Number(b.id || 0) - Number(a.id || 0));
    window.state[collectionKey] = list;
  }

  function syncConversationInState(conversation) {
    updateConversationCollection('messagesInbox', conversation);
    updateConversationCollection('messagesSent', conversation);
    if (window.state.messagesDetail?.conversation && Number(window.state.messagesDetail.conversation.id) === Number(conversation.id)) {
      window.state.messagesDetail.conversation = { ...window.state.messagesDetail.conversation, ...conversation };
    }
  }

  function markConversationReadLocal(id) {
    const targetId = Number(id || 0);
    if (!targetId) return false;
    const list = Array.isArray(window.state.messagesInbox) ? window.state.messagesInbox : [];
    const item = list.find(msg => Number(msg.id) === targetId);
    let changed = false;
    if (item?.unread) {
      item.unread = false;
      window.state.messagesUnreadCount = Math.max(0, Number(window.state.messagesUnreadCount || 0) - 1);
      changed = true;
    }
    if (window.state.messagesDetail?.conversation && Number(window.state.messagesDetail.conversation.id) === targetId && window.state.messagesDetail.conversation.unread) {
      window.state.messagesDetail.conversation.unread = false;
      changed = true;
    }
    if (changed) renderMessaggiTopbarBadge();
    return changed;
  }

  async function loadMessaggioDetail(id, options = {}) {
    const markRead = options.markRead !== false;
    if (!id) return;
    const data = await window.api('GET', `/api/messaggi/${id}`);
    window.state.messagesDetail = {
      conversation: data?.conversation || null,
      messages: Array.isArray(data?.messages) ? data.messages : [],
    };
    if (data?.conversation) syncConversationInState(data.conversation);
    if (markRead && window.state.messagesCurrentBox !== 'sent' && data?.conversation?.unread) {
      await markMessaggioRead(id, true);
    }
    renderMessaggiPage();
  }

  async function loadMessaggiPageData(silent = false) {
    const data = await window.api('GET', '/api/messaggi');
    window.state.messagesInbox = Array.isArray(data.inbox) ? data.inbox : [];
    window.state.messagesSent = Array.isArray(data.sent) ? data.sent : [];
    window.state.messagesUnreadCount = Number(data.unread_count || 0);
    window.state.messagesLoaded = true;
    renderMessaggiTopbarBadge();
    const rows = getMessaggiListForCurrentBox();
    if (!rows.find(item => Number(item.id) === Number(window.state.messagesSelectedId || 0))) {
      window.state.messagesSelectedId = rows[0]?.id || null;
      window.state.messagesDetail = null;
    }
    if (window.state.messagesSelectedId) {
      await loadMessaggioDetail(window.state.messagesSelectedId, { markRead: !silent });
      return;
    }
    renderMessaggiPage();
  }

  function setMessaggiBox(box) {
    window.state.messagesCurrentBox = box === 'sent' ? 'sent' : 'inbox';
    const rows = getMessaggiListForCurrentBox();
    window.state.messagesSelectedId = rows[0]?.id || null;
    window.state.messagesDetail = null;
    renderMessaggiPage();
    if (window.state.messagesSelectedId) {
      loadMessaggioDetail(window.state.messagesSelectedId).catch(() => {});
    }
  }

  async function markMessaggioRead(id, silent = false) {
    await window.api('POST', `/api/messaggi/${id}/read`, {});
    markConversationReadLocal(id);
    if (!silent) renderMessaggiPage();
  }

  async function openMessaggioDettaglio(id) {
    const targetId = Number(id) || null;
    window.state.messagesSelectedId = targetId;
    const changed = window.state.messagesCurrentBox !== 'sent' ? markConversationReadLocal(targetId) : false;
    window.state.messagesDetail = null;
    renderMessaggiPage();
    try {
      await loadMessaggioDetail(targetId, { markRead: !changed });
    } catch (e) {
      window.showToast(e.message, 'warning');
    }
  }

  async function sendInternalMessage() {
    const destType = document.getElementById('msg-dest-type')?.value || 'user';
    const body = {
      destinatario_tipo: destType,
      destinatario_user_id: Number(document.getElementById('msg-dest-user')?.value || 0) || null,
      destinatario_user_ids: [...(document.getElementById('msg-dest-group')?.selectedOptions || [])].map(opt => Number(opt.value)).filter(v => Number.isInteger(v) && v > 0),
      destinatario_ruolo: document.getElementById('msg-dest-role')?.value || '',
      nome_chat: (document.getElementById('msg-group-name')?.value || '').trim(),
      oggetto: (document.getElementById('msg-subject')?.value || '').trim(),
      testo: (document.getElementById('msg-body')?.value || '').trim(),
      ordine_id: Number(document.getElementById('msg-order-id')?.value || 0) || null,
      cliente_id: Number(document.getElementById('msg-client-id')?.value || 0) || null,
      priorita: document.getElementById('msg-priority')?.value || 'media',
    };
    if (!body.testo) {
      window.showToast('Scrivi un messaggio', 'warning');
      return;
    }
    if (destType === 'group' && !body.destinatario_user_ids.length) {
      window.showToast('Seleziona almeno un altro partecipante', 'warning');
      return;
    }
    const saved = await window.api('POST', '/api/messaggi', body);
    const destTypeEl = document.getElementById('msg-dest-type');
    if (destTypeEl) destTypeEl.value = 'user';
    const subjectEl = document.getElementById('msg-subject');
    if (subjectEl) subjectEl.value = '';
    const bodyEl = document.getElementById('msg-body');
    if (bodyEl) bodyEl.value = '';
    const orderEl = document.getElementById('msg-order-id');
    if (orderEl) orderEl.value = '';
    const clientEl = document.getElementById('msg-client-id');
    if (clientEl) clientEl.value = '';
    const groupName = document.getElementById('msg-group-name');
    if (groupName) groupName.value = '';
    const groupSel = document.getElementById('msg-dest-group');
    if (groupSel) [...groupSel.options].forEach(opt => { opt.selected = false; });
    const priorityEl = document.getElementById('msg-priority');
    if (priorityEl) priorityEl.value = 'media';
    renderMessaggiComposeDestinations();
    hideComposerPicker('msg-body-picker');
    if (typeof window.closeModal === 'function') window.closeModal('modal-messaggi-compose');
    window.showToast('Conversazione aperta', 'success');
    await loadMessaggiSummary();
    window.state.messagesCurrentBox = 'sent';
    await loadMessaggiPageData(true);
    if (saved?.id) await openMessaggioDettaglio(saved.id);
  }

  async function saveConversationMeta() {
    const id = Number(window.state.messagesSelectedId || 0);
    if (!id) return;
    const body = {
      stato: document.getElementById('msg-detail-status')?.value || undefined,
      priorita: document.getElementById('msg-detail-priority')?.value || undefined,
      assegnato_user_id: Number(document.getElementById('msg-detail-assignee')?.value || 0) || null,
    };
    const updated = await window.api('PATCH', `/api/messaggi/${id}`, body);
    syncConversationInState(updated);
    if (window.state.messagesDetail?.conversation) window.state.messagesDetail.conversation = updated;
    window.showToast('Conversazione aggiornata', 'success');
    renderMessaggiPage();
  }

  async function takeConversationInCharge() {
    const id = Number(window.state.messagesSelectedId || 0);
    if (!id) return;
    const updated = await window.api('POST', `/api/messaggi/${id}/take`, {});
    syncConversationInState(updated);
    if (window.state.messagesDetail?.conversation) window.state.messagesDetail.conversation = updated;
    window.showToast('Conversazione presa in carico', 'success');
    renderMessaggiPage();
  }

  async function replyToConversation() {
    const id = Number(window.state.messagesSelectedId || 0);
    const textarea = document.getElementById('msg-reply-body');
    const testo = (textarea?.value || '').trim();
    if (!id) return;
    if (!testo) {
      window.showToast('Scrivi una risposta', 'warning');
      return;
    }
    const updated = await window.api('POST', `/api/messaggi/${id}/reply`, { testo });
    if (textarea) { textarea.value = ''; autoResizeReplyBar(textarea); }
    syncConversationInState(updated);
    await loadMessaggiSummary();
    await loadMessaggioDetail(id, { markRead: false });
    window.showToast('Risposta inviata', 'success');
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

  function toggleMessaggiMeta() {
    window.state.messagesMetaOpen = !window.state.messagesMetaOpen;
    const panel = document.getElementById('msg-meta-panel');
    if (panel) panel.style.display = window.state.messagesMetaOpen ? '' : 'none';
  }

  function autoResizeReplyBar(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  window.loadMessaggiSummary = loadMessaggiSummary;
  window.startMessaggiPolling = startMessaggiPolling;
  window.stopMessaggiPolling = stopMessaggiPolling;
  window.renderMessaggiPage = renderMessaggiPage;
  window.loadMessaggiPageData = loadMessaggiPageData;
  window.renderMessaggiComposeDestinations = renderMessaggiComposeDestinations;
  window.openMessaggiComposeModal = openMessaggiComposeModal;
  window.handleMessageComposerInput = handleMessageComposerInput;
  window.handleMessageComposerKeydown = handleMessageComposerKeydown;
  window.applyMessageComposerSuggestion = applyMessageComposerSuggestion;
  window.setMessaggiBox = setMessaggiBox;
  window.openMessaggioDettaglio = openMessaggioDettaglio;
  window.sendInternalMessage = sendInternalMessage;
  window.openMessaggioOrdine = openMessaggioOrdine;
  window.openMessaggioCliente = openMessaggioCliente;
  window.markMessaggioRead = markMessaggioRead;
  window.applyMessaggioPreset = applyMessaggioPreset;
  window.saveConversationMeta = saveConversationMeta;
  window.takeConversationInCharge = takeConversationInCharge;
  window.replyToConversation = replyToConversation;
  window.toggleMessaggiMeta = toggleMessaggiMeta;
  window.autoResizeReplyBar = autoResizeReplyBar;
})();
