(function () {
  function exportListiniPdf() {
    const rows = [...window.state.listini].sort((a, b) => {
      const pa = window.getProdotto(a.prodottoId).nome || '';
      const pb = window.getProdotto(b.prodottoId).nome || '';
      if (pa !== pb) return pa.localeCompare(pb);
      return (a.validoDal || '').localeCompare(b.validoDal || '');
    });
    const tableRows = rows.map(l => {
      const p = window.getProdotto(l.prodottoId);
      return `<tr>
        <td>${p.codice || ''}</td>
        <td>${p.nome || ''}</td>
        <td>${window.listinoScopeLabel(l)}${window.listinoExcludedLabel(l)}</td>
        <td>${window.listinoRuleLabel(l)}</td>
        <td>${window.listinoPreviewPrezzo(l)}</td>
        <td>${l.validoDal || '-'}</td>
        <td>${l.validoAl || '-'}</td>
      </tr>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Listino Norbalat</title>
      <style>
        body{font-family:Arial,sans-serif;color:#102a43;margin:24px}
        h1{margin:0 0 4px;font-size:24px} .sub{color:#486581;font-size:12px;margin-bottom:18px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #d9e2ec;padding:6px 8px;vertical-align:top}
        th{background:#f0f4f8;text-align:left}
      </style></head><body>
      <h1>Listino commerciale</h1><div class="sub">Generato il ${new Date().toLocaleString('it-IT')}</div>
      <table><thead><tr><th>Codice</th><th>Prodotto</th><th>Ambito</th><th>Regola</th><th>Prezzo</th><th>Dal</th><th>Al</th></tr></thead>
      <tbody>${tableRows || '<tr><td colspan="7">Nessun dato</td></tr>'}</tbody></table>
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
