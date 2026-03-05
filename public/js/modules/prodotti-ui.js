function renderProdottiTable() {
  const q = (document.getElementById('search-prodotti')?.value || '').toLowerCase();
  const filterCat = document.getElementById('filter-cat-prodotti')?.value || '';
  let list = state.prodotti;
  if (q) list = list.filter(p => p.nome.toLowerCase().includes(q) || p.codice.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
  if (filterCat) list = list.filter(p => p.categoria === filterCat);

  const tbody = document.getElementById('prodotti-table');
  tbody.innerHTML = list.map(p => `
    <tr>
      <td><span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3);">${p.codice}</span></td>
      <td><b>${p.nome}</b></td>
      <td><span class="badge badge-gray">${p.categoria}</span></td>
      <td style="font-family:'DM Mono',monospace;">${p.um}</td>
      <td style="font-size:12px;color:var(--text2);">${p.packaging}</td>
      <td><span class="badge ${p.pesoFisso ? 'badge-blue' : 'badge-orange'}">${p.pesoFisso ? 'Fisso' : 'Variabile'}</span></td>
      <td style="font-family:'DM Mono',monospace;">${eur(getListinoBaseProdotto(p.id))}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="openEditProdotto(${p.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProdotto(${p.id})">🗑️</button>
      </td>
    </tr>
  `).join('');
}





function openNewProdotto() {
  state.editingId = null;
  document.getElementById('modal-prodotto-title').textContent = 'Nuovo Prodotto';
  ['pr-codice','pr-nome','pr-packaging','pr-note'].forEach(id => document.getElementById(id).value = '');
  openModal('modal-prodotto');
}

function openEditProdotto(id) {
  const p = state.prodotti.find(x => x.id === id);
  state.editingId = id;
  document.getElementById('modal-prodotto-title').textContent = 'Modifica Prodotto';
  document.getElementById('pr-codice').value = p.codice;
  document.getElementById('pr-nome').value = p.nome;
  document.getElementById('pr-cat').value = p.categoria;
  document.getElementById('pr-um').value = p.um;
  document.getElementById('pr-peso').value = p.pesoFisso ? 'F' : 'V';
  document.getElementById('pr-packaging').value = p.packaging;
  document.getElementById('pr-note').value = p.note || '';
  openModal('modal-prodotto');
}

async function saveProdotto() {
  const codice    = document.getElementById('pr-codice').value.trim().toUpperCase();
  const nome      = document.getElementById('pr-nome').value.trim();
  const categoria = document.getElementById('pr-cat').value;
  const um        = document.getElementById('pr-um').value.trim();
  if (!codice||!nome||!categoria||!um) { showToast('Compila tutti i campi obbligatori', 'warning'); return; }
  const body = {
    codice, nome, categoria, um,
    packaging:  document.getElementById('pr-packaging').value.trim(),
    peso_fisso: (document.getElementById('pr-peso').value === 'F'),
    note:       document.getElementById('pr-note').value.trim(),
  };
  try {
    if (state.editingId) {
      await api('PUT', `/api/prodotti/${state.editingId}`, body);
      const i2 = state.prodotti.findIndex(p => p.id === state.editingId);
      if (i2 !== -1) state.prodotti[i2] = normalizeProdotto({...body, id: state.editingId, peso_fisso: body.peso_fisso?1:0});
    } else {
      const saved = await api('POST', '/api/prodotti', body);
      state.prodotti.push(normalizeProdotto({...body, id: saved.id, peso_fisso: body.peso_fisso?1:0}));
    }
    closeModal('modal-prodotto');
    showToast(state.editingId ? 'Prodotto aggiornato ✅' : 'Prodotto salvato ✅', 'success');
    state.editingId = null;
    renderProdottiTable();
    renderListiniPage();
  } catch(e) { showToast(e.message, 'warning'); }
}



async function deleteProdotto(id) {
  id = parseInt(id);
  if (!await customConfirm('Eliminare questo prodotto?')) return;
  try {
    await api('DELETE', `/api/prodotti/${id}`);
    state.prodotti = state.prodotti.filter(x => x.id !== id);
    showToast('Prodotto eliminato');
    renderProdottiTable();
    renderListiniPage();
  } catch(e) { showToast(e.message, 'warning'); }
}

// ═══════════════════════════════════════════════
// UTENTI
// ═══════════════════════════════════════════════

