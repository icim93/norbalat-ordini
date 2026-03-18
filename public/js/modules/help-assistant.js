(function () {
  const PAGE_LABELS = {
    dashboard: 'Dashboard',
    ordini: 'Ordini',
    clienti: 'Clienti',
    documenti: 'Documenti',
    listini: 'Listini',
    rese: 'Gestione Rese',
    prodotti: 'Prodotti',
    utenti: 'Utenti',
    ferie: 'Ferie',
    autista: 'Vista Autista',
    piano: 'Piano Carico',
    magazzino: 'Preparazione',
    giacenze: 'Giacenze',
    tentata: 'Tentata Vendita',
    report: 'Report',
    impostazioni: 'Impostazioni',
    sperimentale: 'CLAL',
    profilo: 'Profilo',
  };

  const ROLE_LABELS = {
    admin: 'Admin',
    amministrazione: 'Amministrazione',
    autista: 'Autista',
    magazzino: 'Magazzino',
    direzione: 'Direzione',
  };

  const HELP_ITEMS = [
    {
      id: 'ordini-creazione',
      pages: ['ordini'],
      roles: ['admin', 'amministrazione', 'autista', 'magazzino', 'direzione'],
      title: 'Come inserire un nuovo ordine',
      keywords: ['nuovo ordine creare inserire prodotto catalogo cliente riga'],
      tags: ['Ordini', 'Inserimento'],
      body: 'Apri "Nuovo Ordine", seleziona cliente e data, poi aggiungi le righe dal catalogo. Per i prodotti a peso variabile l\'ordine parte normalmente in pezzi; i kg reali vengono completati in preparazione.',
    },
    {
      id: 'ordini-unita',
      pages: ['ordini'],
      roles: ['admin', 'amministrazione', 'autista', 'magazzino', 'direzione'],
      title: 'Come leggere pezzi, cartoni, pedane e kg',
      keywords: ['pezzi cartoni pedane kg unita cagliata ricotta formaggi conversione'],
      tags: ['Ordini', 'Conversioni'],
      body: 'Pezzi e pedane servono per l\'ordine e i colli. I kg servono soprattutto per i prodotti a peso variabile e vengono consolidati dal magazzino. La cagliata puo essere ordinata anche a pedane; sale e acido citrico supportano sacchi o kg; vasconi e vaschette lavorano solo a cartoni.',
    },
    {
      id: 'magazzino-preparazione',
      pages: ['magazzino'],
      roles: ['admin', 'magazzino'],
      title: 'Come confermare una preparazione',
      keywords: ['preparazione magazzino pronto conferma lotto peso colli'],
      tags: ['Magazzino', 'Preparazione'],
      body: 'In preparazione puoi prendere in carico l\'ordine, completare lotti, peso effettivo e colli effettivi, poi segnare la riga come pronta. Il campo colli parte gia compilato con il valore dell\'ordine ma resta modificabile se l\'evasione non e completa.',
    },
    {
      id: 'magazzino-parziale',
      pages: ['magazzino'],
      roles: ['admin', 'magazzino'],
      title: 'Come gestire evasione parziale o lotto insufficiente',
      keywords: ['parziale dividere riga split lotto insufficiente residuo'],
      tags: ['Magazzino', 'Parziale'],
      body: 'Quando il lotto non copre tutta la riga usa il comando di divisione. Il sistema separa la parte residua cosi puoi chiudere la quantita disponibile senza perdere il resto dell\'ordine.',
    },
    {
      id: 'giacenze-scarico',
      pages: ['giacenze'],
      roles: ['admin', 'magazzino'],
      title: 'Come usare lo scarico rapido giacenze',
      keywords: ['scarico rapido giacenze lotto scarico multiplo righe'],
      tags: ['Giacenze', 'Scarico rapido'],
      body: 'Apri "Scarico rapido", aggiungi una riga per ogni movimento, scegli prodotto e lotto e conferma solo le quantita positive. Se devi correggere un singolo lotto puoi usare anche rettifica o storico movimenti.',
    },
    {
      id: 'giacenze-riordino',
      pages: ['giacenze', 'dashboard'],
      roles: ['admin', 'magazzino', 'direzione', 'amministrazione'],
      title: 'Come leggere gli alert di riordino e scadenza',
      keywords: ['alert giacenze sotto soglia scadenza riordino dashboard'],
      tags: ['Giacenze', 'Alert'],
      body: 'Gli alert mostrano prodotti sotto punto di riordino e lotti in scadenza. Dal pulsante "Ordinato" registri che il riordino e stato effettuato, cosi la dashboard e la pagina giacenze restano allineate.',
    },
    {
      id: 'prodotti-anagrafica',
      pages: ['prodotti'],
      roles: ['admin'],
      title: 'Come configurare un prodotto a peso variabile',
      keywords: ['prodotto anagrafica peso variabile pezzo cartone kg medio toscanella'],
      tags: ['Prodotti', 'Anagrafica'],
      body: 'Per formaggi, ricotte e cagliate puoi impostare "1 pezzo circa kg" e, se serve, "1 cartone = pezzi". In questo modo l\'ordine ragiona per pezzi o pedane, mentre i kg reali arrivano dal magazzino in preparazione.',
    },
    {
      id: 'clienti-crm',
      pages: ['clienti'],
      roles: ['admin', 'amministrazione', 'direzione'],
      title: 'Come usare CRM e follow-up cliente',
      keywords: ['crm cliente follow up onboarding contatto piva'],
      tags: ['Clienti', 'CRM'],
      body: 'Dalla scheda cliente puoi gestire stato onboarding, eventi CRM e prossimi follow-up. Il riepilogo clienti evidenzia attese, verifiche e attivita in scadenza in base al ruolo.',
    },
    {
      id: 'report-fatturazione',
      pages: ['report'],
      roles: ['admin', 'amministrazione', 'direzione', 'magazzino'],
      title: 'Come leggere colli e kg nei report',
      keywords: ['report fatturazione colli kg reali peso effettivo'],
      tags: ['Report', 'Fatturazione'],
      body: 'Nei report i colli servono per la parte logistica, mentre i kg reali servono alla valorizzazione dei prodotti a peso variabile. Se vedi differenze tra ordine e preparazione, controlla colli effettivi e peso effettivo della riga.',
    },
    {
      id: 'piano-carico',
      pages: ['piano', 'autista'],
      roles: ['admin', 'magazzino', 'autista', 'direzione'],
      title: 'Come leggere il piano carico e il giro autista',
      keywords: ['piano carico autista giro camion pedane conferma'],
      tags: ['Logistica', 'Giri'],
      body: 'Il piano carico aggrega ordini e pedane per camion e giro. La vista autista mostra il proprio percorso operativo, mentre il magazzino usa il piano per chiudere le uscite in sequenza.',
    },
    {
      id: 'documenti-upload',
      pages: ['documenti'],
      roles: ['admin', 'amministrazione', 'magazzino', 'autista', 'direzione'],
      title: 'Come gestire documenti e permessi cartelle',
      keywords: ['documenti cartelle file permessi upload visibilita'],
      tags: ['Documenti'],
      body: 'Nella sezione Documenti puoi caricare file dentro la cartella selezionata. I permessi di visibilita dipendono dal ruolo e, se sei admin, puoi aggiornare l\'ACL della cartella corrente.',
    },
    {
      id: 'ferie-calendario',
      pages: ['ferie'],
      roles: ['admin', 'amministrazione', 'direzione'],
      title: 'Come registrare e controllare le ferie',
      keywords: ['ferie calendario nuovo periodo filtro settimana mese'],
      tags: ['Ferie'],
      body: 'Puoi registrare un nuovo periodo, filtrare per utente o mese e passare tra vista settimanale e mensile. Le modifiche piu utili passano sempre dal calendario e dalla tabella riepilogativa.',
    },
    {
      id: 'tentata-vendita',
      pages: ['tentata'],
      roles: ['admin', 'autista', 'magazzino'],
      title: 'Come usare tentata vendita e rientri',
      keywords: ['tentata vendita rientro template autista carica lista'],
      tags: ['Tentata Vendita'],
      body: 'La tentata vendita lavora con profili riutilizzabili e consente di registrare il venduto fuori ordine. Al rientro puoi caricare la lista prodotti e confermare le quantita che rientrano in giacenza.',
    },
    {
      id: 'help-ambito',
      pages: ['dashboard', 'ordini', 'clienti', 'documenti', 'listini', 'rese', 'prodotti', 'utenti', 'ferie', 'autista', 'piano', 'magazzino', 'giacenze', 'tentata', 'report', 'impostazioni', 'sperimentale', 'profilo'],
      roles: ['admin', 'amministrazione', 'autista', 'magazzino', 'direzione'],
      title: 'Cosa puo fare questa guida',
      keywords: ['aiuto assistente guida cosa puoi fare'],
      tags: ['Guida'],
      body: 'Questa prima versione spiega i flussi dell\'app in base alla pagina corrente e al ruolo. Non esegue azioni automatiche e non modifica dati: serve per orientare l\'utente e ridurre i dubbi operativi piu frequenti.',
    },
  ];

  function getContext() {
    const page = window.state?.currentPage || 'dashboard';
    const role = window.state?.currentUser?.ruolo || 'admin';
    return {
      page,
      pageLabel: PAGE_LABELS[page] || 'Pagina corrente',
      role,
      roleLabel: ROLE_LABELS[role] || role,
    };
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function matchesRole(item, role) {
    return !Array.isArray(item.roles) || item.roles.includes(role);
  }

  function matchesPage(item, page) {
    return !Array.isArray(item.pages) || item.pages.includes(page);
  }

  function scoreHelpItem(item, query, context) {
    let score = 0;
    if (matchesPage(item, context.page)) score += 40;
    if (matchesRole(item, context.role)) score += 10;

    if (!query) return score;

    const haystack = normalizeText([
      item.title,
      item.body,
      (item.keywords || []).join(' '),
      (item.tags || []).join(' '),
    ].join(' '));

    const terms = normalizeText(query)
      .split(/\s+/)
      .map(part => part.trim())
      .filter(Boolean);

    terms.forEach(term => {
      if (haystack.includes(term)) score += 12;
      if (normalizeText(item.title).includes(term)) score += 10;
      if ((item.keywords || []).some(keyword => normalizeText(keyword).includes(term))) score += 6;
    });

    return score;
  }

  function getSuggestions(context) {
    return HELP_ITEMS
      .filter(item => matchesPage(item, context.page) && matchesRole(item, context.role))
      .slice(0, 4)
      .map(item => item.title);
  }

  function searchHelp(query, context) {
    if (!query) {
      return HELP_ITEMS
        .filter(item => matchesRole(item, context.role) && matchesPage(item, context.page))
        .slice(0, 6);
    }

    return HELP_ITEMS
      .filter(item => matchesRole(item, context.role))
      .map(item => ({ item, score: scoreHelpItem(item, query, context) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
      .slice(0, 6)
      .map(entry => entry.item);
  }

  function renderSuggestions(context) {
    const container = document.getElementById('help-suggestions');
    if (!container) return;
    const suggestions = getSuggestions(context);
    container.innerHTML = suggestions.map(suggestion => `
      <button type="button" class="help-suggestion-chip" onclick="askHelpSuggestion(decodeURIComponent('${encodeURIComponent(suggestion)}'))">${window.escapeHtml(suggestion)}</button>
    `).join('');
  }

  function renderResults(items, context, query) {
    const container = document.getElementById('help-results');
    if (!container) return;

    if (!items.length) {
      container.innerHTML = `
        <div class="help-empty">
          Nessuna guida trovata per "${window.escapeHtml(query)}". Prova con parole come ordine, preparazione, lotto, giacenze, cartoni o pedane.
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => {
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const itemPageLabel = PAGE_LABELS[item.pages?.[0]] || context.pageLabel;
      return `
        <div class="help-card">
          <div class="help-card-title">${window.escapeHtml(item.title)}</div>
          <div class="help-card-body">${window.escapeHtml(item.body)}</div>
          <div class="help-card-tags">
            <span class="help-card-tag">${window.escapeHtml(itemPageLabel)}</span>
            ${tags.map(tag => `<span class="help-card-tag">${window.escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function syncHelpAssistantContext() {
    const context = getContext();
    const pageBadge = document.getElementById('help-page-badge');
    const roleBadge = document.getElementById('help-role-badge');
    const contextLabel = document.getElementById('help-context-label');
    if (pageBadge) pageBadge.textContent = context.pageLabel;
    if (roleBadge) roleBadge.textContent = context.roleLabel;
    if (contextLabel) contextLabel.textContent = `Suggerimenti contestuali per ${context.pageLabel.toLowerCase()} (${context.roleLabel.toLowerCase()})`;
    renderSuggestions(context);

    const queryInput = document.getElementById('help-assistant-query');
    const query = queryInput?.value?.trim() || '';
    renderResults(searchHelp(query, context), context, query);
  }

  function openHelpAssistant() {
    syncHelpAssistantContext();
    if (typeof window.openModal === 'function') window.openModal('modal-help-assistant');
    window.setTimeout(() => {
      const input = document.getElementById('help-assistant-query');
      if (input) input.focus();
    }, 0);
  }

  function closeHelpAssistant() {
    if (typeof window.closeModal === 'function') window.closeModal('modal-help-assistant');
  }

  function submitHelpAssistantQuery() {
    syncHelpAssistantContext();
  }

  function clearHelpAssistantQuery() {
    const input = document.getElementById('help-assistant-query');
    if (input) input.value = '';
    syncHelpAssistantContext();
    if (input) input.focus();
  }

  function askHelpSuggestion(text) {
    const input = document.getElementById('help-assistant-query');
    if (input) input.value = text;
    submitHelpAssistantQuery();
  }

  function installHooks() {
    const originalGoTo = window.goTo;
    if (typeof originalGoTo === 'function' && !originalGoTo.__helpWrapped) {
      const wrappedGoTo = function () {
        const result = originalGoTo.apply(this, arguments);
        syncHelpAssistantContext();
        return result;
      };
      wrappedGoTo.__helpWrapped = true;
      window.goTo = wrappedGoTo;
    }
  }

  window.openHelpAssistant = openHelpAssistant;
  window.closeHelpAssistant = closeHelpAssistant;
  window.submitHelpAssistantQuery = submitHelpAssistantQuery;
  window.clearHelpAssistantQuery = clearHelpAssistantQuery;
  window.askHelpSuggestion = askHelpSuggestion;
  window.syncHelpAssistantContext = syncHelpAssistantContext;

  document.addEventListener('DOMContentLoaded', () => {
    installHooks();
    const input = document.getElementById('help-assistant-query');
    if (input) {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submitHelpAssistantQuery();
        }
      });
    }
    syncHelpAssistantContext();
  });
})();
