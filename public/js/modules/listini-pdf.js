(function () {
  function esc(v) {
    return String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function exportListiniPdf() {
    const clientiSorted = [...window.state.clienti].sort((a, b) => a.nome.localeCompare(b.nome));
    const raw = prompt(
      `PDF listino cliente: inserisci ID cliente oppure lascia vuoto per listino generale.\n${clientiSorted.slice(0, 20).map(c => `${c.id} - ${c.nome}`).join('\n')}`,
      ''
    );
    const clienteId = raw && String(raw).trim() ? Number(String(raw).trim()) : null;
    const cliente = Number.isFinite(clienteId) ? window.getCliente(clienteId) : null;
    const refDate = window.today();
    const rows = [...window.state.listini].filter(l => !clienteId || (window.getListinoPrezzo(l.prodottoId, clienteId, refDate) !== null)).sort((a, b) => {
      const pa = window.getProdotto(a.prodottoId).nome || '';
      const pb = window.getProdotto(b.prodottoId).nome || '';
      if (pa !== pb) return pa.localeCompare(pb);
      return (a.validoDal || '').localeCompare(b.validoDal || '');
    });
    const tableRows = rows.map(l => {
      const p = window.getProdotto(l.prodottoId);
      const eff = clienteId ? window.getListinoPrezzo(l.prodottoId, clienteId, refDate) : null;
      return `<tr>
        <td>${esc(p.codice || '')}</td>
        <td>${esc(p.nome || '')}</td>
        <td>${esc(window.listinoScopeLabel(l))}${esc(window.listinoExcludedLabel(l))}</td>
        <td>${esc(window.listinoRuleLabel(l))}</td>
        <td>${esc(window.listinoPreviewPrezzo(l))}</td>
        <td>${eff !== null ? esc(window.eur(eff)) : '-'}</td>
        <td>${esc(l.validoDal || '-')}</td>
        <td>${esc(l.validoAl || '-')}</td>
      </tr>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Listino Norbalat</title>
      <style>
        :root { --ink:#13293d; --muted:#61788d; --line:#d5e1ea; --head:#eef4f8; --brand:#1e8bc3; }
        *{box-sizing:border-box}
        body{font-family:"Segoe UI",Arial,sans-serif;color:var(--ink);margin:20px}
        .cover{padding:18px 20px;border:1px solid var(--line);border-radius:10px;background:linear-gradient(160deg,#f7fbff,#edf5fb)}
        .brand{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--brand);font-weight:700}
        h1{margin:8px 0 6px;font-size:28px;line-height:1.15}
        .sub{color:var(--muted);font-size:12px}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
        .meta .box{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fff}
        .meta .k{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
        .meta .v{font-size:13px;font-weight:600;margin-top:2px}
        .section{margin-top:18px}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th,td{border:1px solid var(--line);padding:6px 7px;vertical-align:top}
        th{background:var(--head);text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
        tfoot td{background:#fafcfe;font-weight:700}
        .foot{margin-top:10px;font-size:10px;color:var(--muted)}
        @media print { body{margin:10mm} .cover{break-inside:avoid} }
      </style></head><body>
      <div class="cover">
        <div class="brand">Norbalat · Gestione Ordini</div>
        <h1>Listino commerciale</h1>
        <div class="sub">Documento generato il ${new Date().toLocaleString('it-IT')}</div>
        <div class="meta">
          <div class="box"><div class="k">Cliente</div><div class="v">${esc(cliente?.nome || 'Generale')}</div></div>
          <div class="box"><div class="k">Data validazione prezzi</div><div class="v">${esc(window.formatDate(refDate))}</div></div>
        </div>
      </div>
      <div class="section">
        <table>
          <thead><tr><th>Codice</th><th>Prodotto</th><th>Ambito</th><th>Regola</th><th>Prezzo regola</th><th>Prezzo cliente</th><th>Dal</th><th>Al</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="8">Nessun dato</td></tr>'}</tbody>
          <tfoot><tr><td colspan="8">Totale voci: ${rows.length}</td></tr></tfoot>
        </table>
      </div>
      <div class="foot">Condizioni commerciali soggette a conferma ordine e disponibilità prodotto.</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return window.showToast('Popup bloccato dal browser', 'warning');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }

  window.exportListiniPdf = exportListiniPdf;
})();
