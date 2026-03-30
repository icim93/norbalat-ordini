(function () {
  function normalizeUtente(u) {
    return {
      id: u.id,
      nome: u.nome || '',
      cognome: u.cognome || '',
      username: u.username || '',
      ruolo: u.ruolo || '',
      tipoUtente: u.tipo_utente || '',
      giriConsegna: Array.isArray(u.giri_consegna) ? u.giri_consegna : (u.giri_consegna ? JSON.parse(u.giri_consegna) : []),
      isAgente: !!u.is_agente,
      password: '••••',
    };
  }

  function normalizeCliente(c) {
    return {
      id: c.id,
      nome: c.nome || '',
      crmTipo: c.crm_tipo || 'cliente',
      alias: c.alias || '',
      localita: c.localita || '',
      giro: c.giro || '',
      agenteId: c.agente_id || null,
      autistaDiGiro: c.autista_di_giro || null,
      note: c.note || '',
      piva: c.piva || '',
      codiceFiscale: c.codice_fiscale || c.codiceFiscale || '',
      codiceUnivoco: c.codice_univoco || c.codiceUnivoco || '',
      pec: c.pec || '',
      classificazione: c.classificazione || '',
      condPagamento: c.cond_pagamento || '',
      contattoNome: c.contatto_nome || c.contattoNome || '',
      telefono: c.telefono || '',
      eFornitore: !!c.e_fornitore,
      onboardingStato: c.onboarding_stato || 'in_attesa',
      onboardingChecklist: (c.onboarding_checklist && typeof c.onboarding_checklist === 'object') ? c.onboarding_checklist : {},
      fido: Number(c.fido || 0),
      sbloccato: !!c.sbloccato,
      onboardingApprovatoDa: c.onboarding_approvato_da || '',
      onboardingApprovatoAt: c.onboarding_approvato_at || null,
      createdAt: c.created_at || null,
      crmConvertitoAt: c.crm_convertito_at || null,
    };
  }

  function normalizeProdotto(p) {
    return {
      id: p.id,
      codice: p.codice || '',
      nome: p.nome || '',
      categoria: p.categoria || '',
      um: p.um || '',
      packaging: p.packaging || '',
      pesoFisso: !!p.peso_fisso,
      gestioneGiacenza: p.gestione_giacenza !== undefined ? !!p.gestione_giacenza : true,
      puntoRiordino: (p.punto_riordino !== undefined && p.punto_riordino !== null) ? Number(p.punto_riordino) : null,
      cartoniAttivi: !!p.cartoni_attivi,
      pesoMedioPezzoKg: (p.peso_medio_pezzo_kg !== undefined && p.peso_medio_pezzo_kg !== null) ? Number(p.peso_medio_pezzo_kg) : null,
      pezziPerCartone: (p.pezzi_per_cartone !== undefined && p.pezzi_per_cartone !== null) ? Number(p.pezzi_per_cartone) : null,
      unitaPerCartone: (p.unita_per_cartone !== undefined && p.unita_per_cartone !== null) ? Number(p.unita_per_cartone) : null,
      pedaneAttive: !!p.pedane_attive,
      cartoniPerPedana: (p.cartoni_per_pedana !== undefined && p.cartoni_per_pedana !== null) ? Number(p.cartoni_per_pedana) : null,
      pesoCartoneKg: (p.peso_cartone_kg !== undefined && p.peso_cartone_kg !== null) ? Number(p.peso_cartone_kg) : null,
      assortimentoStato: p.assortimento_stato || 'attivo',
      ultimoRiordinoQta: (p.ultimo_riordino_qta !== undefined && p.ultimo_riordino_qta !== null) ? Number(p.ultimo_riordino_qta) : null,
      ultimoRiordinoAt: p.ultimo_riordino_at || null,
      ultimoRiordinoUtenteId: p.ultimo_riordino_utente_id || null,
      ultimoRiordinoUtenteNome: p.ultimo_riordino_utente_nome || '',
      autoAnagrafato: !!p.auto_anagrafato,
      autoAnagrafatoAt: p.auto_anagrafato_at || null,
      note: p.note || '',
      schedaTecnicaNome: p.scheda_tecnica_nome || '',
      schedaTecnicaMime: p.scheda_tecnica_mime || '',
      schedaTecnicaUploadedAt: p.scheda_tecnica_uploaded_at || null,
      hasSchedaTecnica: !!p.has_scheda_tecnica,
    };
  }

  function normalizeListino(l) {
    return {
      id: l.id,
      prodottoId: l.prodotto_id,
      clienteId: l.cliente_id || null,
      giro: l.giro || '',
      scope: l.scope || 'all',
      mode: l.mode || 'final_price',
      prezzo: (l.prezzo !== undefined && l.prezzo !== null) ? Number(l.prezzo) : null,
      basePrice: (l.base_price !== undefined && l.base_price !== null) ? Number(l.base_price) : null,
      markupPct: (l.markup_pct !== undefined && l.markup_pct !== null) ? Number(l.markup_pct) : 0,
      discountPct: (l.discount_pct !== undefined && l.discount_pct !== null) ? Number(l.discount_pct) : 0,
      finalPrice: (l.final_price !== undefined && l.final_price !== null) ? Number(l.final_price) : null,
      validoDal: (l.valido_dal || '').substring(0, 10),
      validoAl: l.valido_al ? String(l.valido_al).substring(0, 10) : '',
      note: l.note || '',
      excludedClientIds: Array.isArray(l.excluded_client_ids) ? l.excluded_client_ids.map(x => Number(x)).filter(Number.isFinite) : [],
      prodottoNome: l.prodotto_nome || '',
      clienteNome: l.cliente_nome || '',
    };
  }

  function normalizeResa(r) {
    return {
      id: r.id,
      fornitoreId: r.fornitore_id || null,
      fornitoreNome: r.fornitore_nome || '',
      clalValue: (r.clal_value !== undefined && r.clal_value !== null) ? Number(r.clal_value) : null,
      buyerCode: r.buyer_code || 'viga',
      quantita: (r.quantita !== undefined && r.quantita !== null) ? Number(r.quantita) : 0,
      prezzoPagato: (r.prezzo_pagato !== undefined && r.prezzo_pagato !== null) ? Number(r.prezzo_pagato) : 0,
      lotto: r.lotto || '',
      resaPct: (r.resa_pct !== undefined && r.resa_pct !== null) ? Number(r.resa_pct) : 0,
      prezzoVenduto: (r.prezzo_venduto !== undefined && r.prezzo_venduto !== null) ? Number(r.prezzo_venduto) : null,
      createdBy: r.created_by || null,
      createdAt: r.created_at || null,
      updatedAt: r.updated_at || null,
    };
  }

  function normalizeOrdine(o) {
    return {
      id: o.id,
      clienteId: o.cliente_id,
      agenteId: o.agente_id || null,
      autistaDiGiro: o.autista_di_giro || null,
      insertedBy: o.inserted_by || null,
      insertedAt: o.inserted_at || null,
      updatedAt: o.updated_at || o.inserted_at || null,
      data: (o.data || '').substring(0, 10),
      stato: o.stato || 'attesa',
      note: o.note || '',
      dataNonCerta: !!o.data_non_certa,
      stef: !!o.stef,
      altroVettore: !!o.altro_vettore,
      giroOverride: o.giro_override || '',
      linee: (o.linee || []).map(l => ({
        id: l.id,
        prodId: l.prodotto_id || null,
        prodottoNomeLibero: l.prodotto_nome_libero || '',
        qty: l.qty,
        qtyBase: (l.qty_base !== undefined && l.qty_base !== null) ? Number(l.qty_base) : null,
        colliEffettivi: (l.colli_effettivi !== undefined && l.colli_effettivi !== null) ? Number(l.colli_effettivi) : null,
        prezzoUnitario: (l.prezzo_unitario !== undefined && l.prezzo_unitario !== null) ? Number(l.prezzo_unitario) : null,
        pesoEffettivo: l.peso_effettivo || null,
        isPedana: !!l.is_pedana,
        notaRiga: l.nota_riga || '',
        unitaMisura: l.unita_misura || 'pezzi',
        preparato: !!l.preparato,
        lotto: l.lotto || '',
      })),
    };
  }

  function normalizeCamion(c) {
    return {
      id: c.id,
      targa: c.targa || '',
      nome: c.nome || '',
      layout: c.layout || 'asym8',
      autistaInUso: c.autista_in_uso || null,
      confermato: !!c.confermato,
      confermatoDa: c.confermato_da || null,
      confermatoAt: c.confermato_at || null,
      lastUpdate: c.last_update || null,
      pianoData: (c.piano_data || '').substring(0, 10),
      pedane: (c.pedane || []).map(p => ({ n: p.numero, nota: p.nota || '' })),
    };
  }

  window.normalizeUtente = normalizeUtente;
  window.normalizeCliente = normalizeCliente;
  window.normalizeProdotto = normalizeProdotto;
  window.normalizeListino = normalizeListino;
  window.normalizeResa = normalizeResa;
  window.normalizeOrdine = normalizeOrdine;
  window.normalizeCamion = normalizeCamion;
})();
