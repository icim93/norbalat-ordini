function renderProdottiSchedaStatus(prodotto) {
  const status = document.getElementById('pr-scheda-status');
  const dlBtn = document.getElementById('pr-scheda-download-btn');
  const delBtn = document.getElementById('pr-scheda-delete-btn');
  const hasScheda = !!prodotto?.hasSchedaTecnica;
  if (status) {
    status.textContent = hasScheda
      ? `Allegato: ${prodotto.schedaTecnicaNome || 'scheda tecnica'}${prodotto.schedaTecnicaUploadedAt ? ` · caricato il ${formatDateTime(prodotto.schedaTecnicaUploadedAt)}` : ''}`
      : 'Nessun allegato caricato.';
  }
  if (dlBtn) dlBtn.style.display = hasScheda ? '' : 'none';
  if (delBtn) delBtn.style.display = (hasScheda && state.editingId) ? '' : 'none';
}

function renderProdottiTable() {
  const q = (document.getElementById('search-prodotti')?.value || '').toLowerCase();
  const filterCat = document.getElementById('filter-cat-prodotti')?.value || '';
  let list = state.prodotti;
  if (q) list = list.filter(p =>
    p.nome.toLowerCase().includes(q) ||
    p.codice.toLowerCase().includes(q) ||
    p.categoria.toLowerCase().includes(q)
  );
  if (filterCat) list = list.filter(p => p.categoria === filterCat);

  const tbody = document.getElementById('prodotti-table');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">-</div><p>Nessun prodotto trovato</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(p => `
    <tr>
      <td><span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3);">${escapeHtml(p.codice)}</span></td>
      <td><b>${escapeHtml(p.nome)}</b></td>
      <td><span class="badge badge-gray">${escapeHtml(p.categoria)}</span></td>
      <td style="font-family:'DM Mono',monospace;">${escapeHtml(p.um)}</td>
      <td style="font-size:12px;color:var(--text2);">${escapeHtml(p.packaging || '')}</td>
      <td><span class="badge ${p.pesoFisso ? 'badge-blue' : 'badge-orange'}">${p.pesoFisso ? 'Fisso' : 'Variabile'}</span></td>
      <td>${p.hasSchedaTecnica ? `<button class="btn btn-outline btn-sm" onclick="downloadProdottoScheda(${p.id})">Apri</button>` : '<span style="color:var(--text3);font-size:12px;">-</span>'}</td>
      <td style="font-family:'DM Mono',monospace;">${eur(getListinoBaseProdotto(p.id))}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-outline btn-sm" title="Modifica prodotto" aria-label="Modifica prodotto" onclick="openEditProdotto(${p.id})">Mod</button>
          <button class="btn btn-outline btn-sm" title="Carica scheda tecnica" aria-label="Carica scheda tecnica" onclick="promptProdottoSchedaUpload(${p.id})">Scheda</button>
          <button class="btn btn-danger btn-sm" title="Elimina prodotto" aria-label="Elimina prodotto" onclick="deleteProdotto(${p.id})">Del</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openNewProdotto() {
  state.editingId = null;
  document.getElementById('modal-prodotto-title').textContent = 'Nuovo Prodotto';
  ['pr-codice', 'pr-nome', 'pr-packaging', 'pr-note'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pr-cat').value = 'FORMAGGI';
  document.getElementById('pr-um').value = 'kg';
  document.getElementById('pr-peso').value = 'F';
  const fileInput = document.getElementById('pr-scheda-file');
  if (fileInput) fileInput.value = '';
  renderProdottiSchedaStatus(null);
  openModal('modal-prodotto');
}

function openEditProdotto(id) {
  const p = state.prodotti.find(x => x.id === id);
  if (!p) return;
  state.editingId = id;
  document.getElementById('modal-prodotto-title').textContent = 'Modifica Prodotto';
  document.getElementById('pr-codice').value = p.codice;
  document.getElementById('pr-nome').value = p.nome;
  document.getElementById('pr-cat').value = p.categoria;
  document.getElementById('pr-um').value = p.um;
  document.getElementById('pr-peso').value = p.pesoFisso ? 'F' : 'V';
  document.getElementById('pr-packaging').value = p.packaging;
  document.getElementById('pr-note').value = p.note || '';
  const fileInput = document.getElementById('pr-scheda-file');
  if (fileInput) fileInput.value = '';
  renderProdottiSchedaStatus(p);
  openModal('modal-prodotto');
}

async function saveProdotto() {
  const codice = document.getElementById('pr-codice').value.trim().toUpperCase();
  const nome = document.getElementById('pr-nome').value.trim();
  const categoria = document.getElementById('pr-cat').value;
  const um = document.getElementById('pr-um').value.trim();
  if (!codice || !nome || !categoria || !um) {
    showToast('Compila tutti i campi obbligatori', 'warning');
    return;
  }
  const body = {
    codice,
    nome,
    categoria,
    um,
    packaging: document.getElementById('pr-packaging').value.trim(),
    peso_fisso: (document.getElementById('pr-peso').value === 'F'),
    note: document.getElementById('pr-note').value.trim(),
  };
  try {
    if (state.editingId) {
      await api('PUT', `/api/prodotti/${state.editingId}`, body);
      const idx = state.prodotti.findIndex(p => p.id === state.editingId);
      if (idx !== -1) {
        state.prodotti[idx] = normalizeProdotto({
          ...state.prodotti[idx],
          ...body,
          id: state.editingId,
          peso_fisso: body.peso_fisso ? 1 : 0,
          has_scheda_tecnica: state.prodotti[idx].hasSchedaTecnica,
          scheda_tecnica_nome: state.prodotti[idx].schedaTecnicaNome,
          scheda_tecnica_mime: state.prodotti[idx].schedaTecnicaMime,
          scheda_tecnica_uploaded_at: state.prodotti[idx].schedaTecnicaUploadedAt,
        });
      }
    } else {
      const saved = await api('POST', '/api/prodotti', body);
      state.prodotti.push(normalizeProdotto({ ...body, id: saved.id, peso_fisso: body.peso_fisso ? 1 : 0 }));
    }
    closeModal('modal-prodotto');
    showToast(state.editingId ? 'Prodotto aggiornato' : 'Prodotto salvato', 'success');
    state.editingId = null;
    renderProdottiTable();
    renderListiniPage();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}

function readProdottoSchedaFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Lettura file non riuscita'));
    reader.readAsDataURL(file);
  });
}

async function uploadProdottoScheda(prodottoId, file) {
  if (!prodottoId || !file) return;
  const contentBase64 = await readProdottoSchedaFile(file);
  const response = await api('POST', `/api/prodotti/${prodottoId}/scheda`, {
    file_name: file.name,
    mime_type: file.type || 'application/octet-stream',
    content_base64: contentBase64,
  });
  const idx = state.prodotti.findIndex(p => p.id === prodottoId);
  if (idx !== -1) {
    state.prodotti[idx].hasSchedaTecnica = true;
    state.prodotti[idx].schedaTecnicaNome = response.file_name || file.name;
    state.prodotti[idx].schedaTecnicaMime = response.mime_type || file.type || 'application/octet-stream';
    state.prodotti[idx].schedaTecnicaUploadedAt = response.uploaded_at || new Date().toISOString();
  }
  renderProdottiSchedaStatus(state.prodotti.find(p => p.id === prodottoId) || null);
  renderProdottiTable();
}

async function uploadProdottoSchedaFromModal() {
  if (!state.editingId) {
    showToast('Salva prima il prodotto, poi carica la scheda tecnica', 'warning');
    return;
  }
  const input = document.getElementById('pr-scheda-file');
  const file = input?.files?.[0];
  if (!file) {
    showToast('Seleziona un file PDF o DOC', 'warning');
    return;
  }
  try {
    await uploadProdottoScheda(state.editingId, file);
    if (input) input.value = '';
    showToast('Scheda tecnica caricata', 'success');
  } catch (e) {
    showToast(e.message || 'Errore upload scheda tecnica', 'warning');
  }
}

function promptProdottoSchedaUpload(prodottoId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await uploadProdottoScheda(prodottoId, file);
      showToast('Scheda tecnica caricata', 'success');
    } catch (e) {
      showToast(e.message || 'Errore upload scheda tecnica', 'warning');
    }
  };
  input.click();
}

async function downloadProdottoScheda(prodottoId) {
  if (!prodottoId) return;
  try {
    const res = await fetch(`${window.BASE_URL}/api/prodotti/${prodottoId}/scheda`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (res.status === 401) {
      doLogout();
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Download non riuscito');
    }
    const blob = await res.blob();
    const disp = res.headers.get('content-disposition') || '';
    const matched = disp.match(/filename=\"?([^\";]+)\"?/i);
    const fallbackName = matched?.[1] || 'scheda-tecnica';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast(e.message || 'Errore download scheda tecnica', 'warning');
  }
}

async function deleteProdottoScheda(prodottoId) {
  if (!prodottoId) return;
  if (!await customConfirm('Rimuovere la scheda tecnica di questo prodotto?')) return;
  try {
    await api('DELETE', `/api/prodotti/${prodottoId}/scheda`);
    const prodotto = state.prodotti.find(p => p.id === prodottoId);
    if (prodotto) {
      prodotto.hasSchedaTecnica = false;
      prodotto.schedaTecnicaNome = '';
      prodotto.schedaTecnicaMime = '';
      prodotto.schedaTecnicaUploadedAt = null;
    }
    const input = document.getElementById('pr-scheda-file');
    if (input) input.value = '';
    renderProdottiSchedaStatus(prodotto || null);
    renderProdottiTable();
    showToast('Scheda tecnica rimossa', 'success');
  } catch (e) {
    showToast(e.message || 'Errore rimozione scheda tecnica', 'warning');
  }
}

async function deleteProdotto(id) {
  id = parseInt(id, 10);
  if (!await customConfirm('Eliminare questo prodotto?')) return;
  try {
    await api('DELETE', `/api/prodotti/${id}`);
    state.prodotti = state.prodotti.filter(x => x.id !== id);
    showToast('Prodotto eliminato');
    renderProdottiTable();
    renderListiniPage();
  } catch (e) {
    showToast(e.message, 'warning');
  }
}
