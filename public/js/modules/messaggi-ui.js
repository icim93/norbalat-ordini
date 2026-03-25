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
      clearInterval(window.state.messagesPoller);
      window.state.messagesPoller = null;
    }
  }

  function startMessaggiPolling() {
    stopMessaggiPolling();
    if (!window.state.token) return;
    window.state.messagesPoller = setInterval(() => {
      loadMessaggiSummary().catch(() => {});
      if (window.state.currentPage === 'messaggi') loadMessaggiPageData(true).catch(() => {});
    }, 15000);
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
    const clientSel = document.getElementById('msg-client-id');
    const orderSel = document.getElementById('msg-order-id');
    if (!typeEl || !userWrap || !groupWrap || !roleWrap || !groupNameWrap || !userSel || !groupSel || !roleSel || !clientSel || !orderSel) return;

    const keepUser = userSel.value;
    const keepGroup = new Set([...(groupSel.selectedOptions || [])].map(opt => opt.value));
    const keepRole = roleSel.value;
    const keepClient = clientSel.value;
    const keepOrder = orderSel.value;

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

    clientSel.innerHTML = `<option value="">Nessun cliente</option>` + [...(window.state.clienti || [])]
      .filter(c => !(typeof window.isTentataVenditaCliente === 'function' && window.isTentataVenditaCliente(c)))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' }))
      .map(c => `<option value="${c.id}">${window.escapeHtml(c.nome)}</option>`).join('');
    if (keepClient) clientSel.value = keepClient;

    const orders = [...(window.state.ordini || [])]
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
      .slice(0, 200);
    orderSel.innerHTML = `<option value="">Nessun ordine</option>` + orders.map(o => {
      const cliente = typeof window.getCliente === 'function' ? window.getCliente(o.clienteId) : null;
      const label = `#${o.id} - ${(cliente?.nome || '?')} - ${o.data || ''}`;
      return `<option value="${o.id}">${window.escapeHtml(label)}</option>`;
    }).join('');
    if (keepOrder) orderSel.value = keepOrder;

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

  function renderMessaggiList() {
    const listEl = document.getElementById('messaggi-list');
    if (!listEl) return;
    const rows = applyMessaggiFilters(getMessaggiListForCurrentBox());
    const selectedId = Number(window.state.messagesSelectedId || 0);
    if (!rows.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">M</div><p>Nessuna conversazione per i filtri correnti.</p></div>';
      return;
    }
    listEl.innerHTML = rows.map(conv => {
      const isInbox = window.state.messagesCurrentBox !== 'sent';
      const unread = isInbox && !!conv.unread;
      const active = Number(conv.id) === selectedId;
      const counterpart = getConversationCounterpart(conv, isInbox);
      const initials = String(counterpart || '?').trim().split(/\s+/).slice(0, 2).map(v => v.charAt(0)).join('').toUpperCase() || '?';
      const refs = [
        conv.ordine_id ? `<span class="badge badge-blue">Ordine #${conv.ordine_id}</span>` : '',
        conv.cliente_id ? `<span class="badge badge-soft">${window.escapeHtml(conv.cliente_nome || `Cliente #${conv.cliente_id}`)}</span>` : '',
        conv.assegnato_nome ? `<span class="badge badge-gray">Assegnata a ${window.escapeHtml(conv.assegnato_nome)}</span>` : '',
      ].filter(Boolean).join(' ');
      return `
        <button class="card" onclick="openMessaggioDettaglio(${conv.id})" style="width:100%;text-align:left;margin-top:10px;border:${active ? '1.5px solid var(--accent)' : '1px solid var(--border)'};background:${unread ? '#eef8ff' : 'var(--surface)'};box-shadow:${active ? '0 8px 24px rgba(18,80,120,0.10)' : 'none'};">
          <div style="padding:12px 14px;display:grid;grid-template-columns:44px minmax(0,1fr);gap:12px;align-items:start;">
            <div style="width:44px;height:44px;border-radius:50%;background:${unread ? 'var(--accent)' : 'var(--surface2)'};color:${unread ? '#fff' : 'var(--accent)'};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">${window.escapeHtml(initials)}</div>
            <div>
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                <div style="min-width:0;">
                  <div style="font-size:13px;font-weight:700;color:var(--text1);">${window.escapeHtml(counterpart)}</div>
                  <div style="font-size:11px;color:var(--text3);margin-top:2px;">${window.escapeHtml(conv.oggetto || '(senza oggetto)')}</div>
                </div>
                <div style="font-size:11px;color:${unread ? 'var(--accent)' : 'var(--text3)'};font-weight:${unread ? '700' : '500'};white-space:nowrap;">${window.escapeHtml(window.formatNotificationDateTime(conv.last_message_at) || '')}</div>
              </div>
              <div style="font-size:12px;color:var(--text2);margin-top:8px;line-height:1.45;">${window.escapeHtml(String(conv.last_message_text || '').slice(0, 130))}${String(conv.last_message_text || '').length > 130 ? '...' : ''}</div>
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${unread ? '<span class="badge badge-orange">Nuova</span>' : ''}
                  <span class="badge ${priorityBadges[conv.priorita] || 'badge-gray'}">${window.escapeHtml(priorityLabels[conv.priorita] || conv.priorita || 'Media')}</span>
                  <span class="badge ${statusBadges[conv.stato] || 'badge-gray'}">${window.escapeHtml(statusLabels[conv.stato] || conv.stato || 'Nuovo')}</span>
                  ${refs}
                </div>
                <div style="font-size:11px;color:var(--text3);">${Number(conv.message_count || 0)} msg</div>
              </div>
            </div>
          </div>
        </button>
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
        <div style="width:100%;height:100%;min-height:520px;display:flex;align-items:center;justify-content:center;padding:24px;">
          <div style="max-width:320px;text-align:center;color:var(--text3);">
            <div style="font-size:42px;line-height:1;margin-bottom:12px;">💬</div>
            <div style="font-size:16px;font-weight:800;color:var(--text1);margin-bottom:8px;">Apri una conversazione</div>
            <div style="font-size:13px;line-height:1.6;">Seleziona una chat dalla colonna sinistra per leggere il thread e rispondere.</div>
          </div>
        </div>`;
      return;
    }
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    const isInbox = window.state.messagesCurrentBox !== 'sent';
    const counterpart = getConversationCounterpart(conv, isInbox);
    const counterpartInitials = String(counterpart || '?').trim().split(/\s+/).slice(0, 2).map(v => v.charAt(0)).join('').toUpperCase() || '?';
    detailEl.innerHTML = `
      <div style="height:100%;min-height:520px;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;gap:14px;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:16px 0 0;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <div style="width:44px;height:44px;border-radius:50%;background:var(--surface2);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">${window.escapeHtml(counterpartInitials)}</div>
            <div style="min-width:0;">
              <div style="font-size:16px;font-weight:800;color:var(--text1);">${window.escapeHtml(counterpart)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px;">${isInbox ? 'Da' : 'A'} ${window.escapeHtml(counterpart)} · Ultimo aggiornamento ${window.escapeHtml(window.formatNotificationDateTime(conv.last_message_at) || '')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <span class="badge ${priorityBadges[conv.priorita] || 'badge-gray'}">${window.escapeHtml(priorityLabels[conv.priorita] || conv.priorita || 'Media')}</span>
            <span class="badge ${statusBadges[conv.stato] || 'badge-gray'}">${window.escapeHtml(statusLabels[conv.stato] || conv.stato || 'Nuovo')}</span>
            ${conv.ordine_id ? `<button class="btn btn-outline btn-sm" onclick="openMessaggioOrdine(${conv.ordine_id})">Ordine #${conv.ordine_id}</button>` : ''}
            ${conv.cliente_id ? `<button class="btn btn-outline btn-sm" onclick="openMessaggioCliente(${conv.cliente_id})">${window.escapeHtml(conv.cliente_nome || 'Cliente')}</button>` : ''}
          </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isInbox ? '<button class="btn btn-outline btn-sm" onclick="takeConversationInCharge()">Prendi in carico</button>' : ''}
          ${conv.unread ? '<button class="btn btn-outline btn-sm" onclick="markMessaggioRead(state.messagesSelectedId)">Segna letta</button>' : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end;">
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
        <div style="display:flex;justify-content:flex-end;">
          <button class="btn btn-green btn-sm" onclick="saveConversationMeta()">Salva</button>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;padding:18px 14px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,#fcfdff 0%,#f5f8fb 100%);">
        ${messages.length ? messages.map(msg => {
          const mine = Number(msg.mittente_id || 0) === Number(window.state.currentUser?.id || 0);
          return `
            <div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};">
              <div style="max-width:min(720px,88%);padding:12px 14px;border:1px solid ${mine ? 'rgba(18,80,120,0.18)' : 'var(--border)'};background:${mine ? 'linear-gradient(180deg,#dff1ff 0%,#d4ebff 100%)' : '#ffffff'};border-radius:${mine ? '16px 16px 6px 16px' : '16px 16px 16px 6px'};box-shadow:0 6px 18px rgba(10,30,50,0.05);">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:6px;">
                  <div style="font-size:12px;font-weight:700;color:var(--text1);">${window.escapeHtml(msg.mittente_nome || 'Utente')}</div>
                  <div style="font-size:11px;color:var(--text3);">${window.escapeHtml(window.formatNotificationDateTime(msg.created_at) || '')}</div>
                </div>
                <div style="white-space:pre-wrap;line-height:1.55;color:var(--text1);">${window.escapeHtml(msg.testo || '')}</div>
              </div>
            </div>
          `;
        }).join('') : '<div style="padding:18px;border:1px dashed var(--border);border-radius:12px;color:var(--text3);text-align:center;background:#fff;">Nessun messaggio nel thread.</div>'}
      </div>

      <div style="padding:14px;border:1px solid var(--border);border-radius:16px;background:#fff;">
        <div class="field" style="margin:0;">
          <label>Risposta</label>
          <textarea id="msg-reply-body" rows="4" placeholder="Scrivi una risposta operativa"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;">
          <button class="btn btn-green" onclick="replyToConversation()">Invia risposta</button>
        </div>
      </div>
    `;
    const threadScroller = detailEl.querySelector('div[style*="overflow:auto"]');
    if (threadScroller) {
      window.requestAnimationFrame(() => {
        threadScroller.scrollTop = threadScroller.scrollHeight;
      });
    }
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
    const list = Array.isArray(window.state.messagesInbox) ? window.state.messagesInbox : [];
    const item = list.find(msg => Number(msg.id) === Number(id));
    if (item?.unread) {
      item.unread = false;
      window.state.messagesUnreadCount = Math.max(0, Number(window.state.messagesUnreadCount || 0) - 1);
    }
    if (window.state.messagesDetail?.conversation && Number(window.state.messagesDetail.conversation.id) === Number(id)) {
      window.state.messagesDetail.conversation.unread = false;
    }
    renderMessaggiTopbarBadge();
    if (!silent) renderMessaggiPage();
  }

  async function openMessaggioDettaglio(id) {
    window.state.messagesSelectedId = Number(id) || null;
    window.state.messagesDetail = null;
    renderMessaggiPage();
    try {
      await loadMessaggioDetail(id);
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
    document.getElementById('msg-preset').value = '';
    document.getElementById('msg-dest-type').value = 'user';
    document.getElementById('msg-subject').value = '';
    document.getElementById('msg-body').value = '';
    document.getElementById('msg-order-id').value = '';
    document.getElementById('msg-client-id').value = '';
    const groupName = document.getElementById('msg-group-name');
    if (groupName) groupName.value = '';
    const groupSel = document.getElementById('msg-dest-group');
    if (groupSel) [...groupSel.options].forEach(opt => { opt.selected = false; });
    document.getElementById('msg-priority').value = 'media';
    renderMessaggiComposeDestinations();
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
    if (textarea) textarea.value = '';
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
  window.markMessaggioRead = markMessaggioRead;
  window.applyMessaggioPreset = applyMessaggioPreset;
  window.saveConversationMeta = saveConversationMeta;
  window.takeConversationInCharge = takeConversationInCharge;
  window.replyToConversation = replyToConversation;
})();
