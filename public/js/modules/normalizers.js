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
      eFornitore: !!c.e_fornitore,
      onboardingStato: c.onboarding_stato || 'in_attesa',
      onboardingChecklist: (c.onboarding_checklist && typeof c.onboarding_checklist === 'object') ? c.onboarding_checklist : {},
      fido: Number(c.fido || 0),
      sbloccato: !!c.sbloccato,
      onboardingApprovatoDa: c.onboarding_approvato_da || '',
      onboardingApprovatoAt: c.onboarding_approvato_at || null,
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
      note: p.note || '',
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

  function normalizeOrdine(o) {
    return {
      id: o.id,
      clienteId: o.cliente_id,
      agenteId: o.agente_id || null,
      autistaDiGiro: o.autista_di_giro || null,
      insertedBy: o.inserted_by || null,
      insertedAt: o.inserted_at || null,
      data: (o.data || '').substring(0, 10),
      stato: o.stato || 'attesa',
      note: o.note || '',
      dataNonCerta: !!o.data_non_certa,
      stef: !!o.stef,
      linee: (o.linee || []).map(l => ({
        id: l.id,
        prodId: l.prodotto_id,
        qty: l.qty,
        prezzoUnitario: (l.prezzo_unitario !== undefined && l.prezzo_unitario !== null) ? Number(l.prezzo_unitario) : null,
        pesoEffettivo: l.peso_effettivo || null,
        isPedana: !!l.is_pedana,
        notaRiga: l.nota_riga || '',
        unitaMisura: l.unita_misura || 'pezzi',
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
      pedane: (c.pedane || []).map(p => ({ n: p.numero, nota: p.nota || '' })),
    };
  }

  window.normalizeUtente = normalizeUtente;
  window.normalizeCliente = normalizeCliente;
  window.normalizeProdotto = normalizeProdotto;
  window.normalizeListino = normalizeListino;
  window.normalizeOrdine = normalizeOrdine;
  window.normalizeCamion = normalizeCamion;
})();
