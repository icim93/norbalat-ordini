(function () {
  const ROLE_LABELS = {
    admin: 'Admin',
    amministrazione: 'Amministrazione',
    direzione: 'Direzione',
    autista: 'Autista',
    magazzino: 'Magazzino',
  };

  function ensureDocsState() {
    if (!Array.isArray(window.state.docFolders)) window.state.docFolders = [];
    if (!Array.isArray(window.state.docCurrentFiles)) window.state.docCurrentFiles = [];
    if (typeof window.state.docCanManage !== 'boolean') window.state.docCanManage = false;
    if (!('docCurrentFolderId' in window.state)) window.state.docCurrentFolderId = null;
  }

  function isDocsManager() {
    const ruolo = window.state.currentUser?.ruolo;
    return ruolo === 'admin' || ruolo === 'amministrazione' || ruolo === 'direzione';
  }

  function roleOptions() {
    return ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'];
  }

  function formatBytes(n) {
    const v = Number(n || 0);
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  }

  function getFolderById(id) {
    return window.state.docFolders.find(f => f.id === id) || null;
  }

  function getSelectedRolesFromUI() {
    return [...document.querySelectorAll('.doc-role-check:checked')].map(el => el.value);
  }

  function renderRoleChecks(selectedRoles = []) {
    const box = document.getElementById('doc-role-checks');
    if (!box) return;
    box.innerHTML = roleOptions().map(role => {
      const checked = selectedRoles.includes(role) ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" class="doc-role-check" value="${role}" ${checked}>${ROLE_LABELS[role]}</label>`;
    }).join('');
  }

  function buildFolderTree() {
    const byParent = new Map();
    window.state.docFolders.forEach(f => {
      const key = f.parent_id || 0;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(f);
    });
    byParent.forEach(arr => arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));

    function renderNode(parentId, depth) {
      const children = byParent.get(parentId || 0) || [];
      return children.map(f => {
        const active = f.id === window.state.docCurrentFolderId;
        const roles = Array.isArray(f.allowed_roles) ? f.allowed_roles : [];
        const roleShort = roles.map(r => ROLE_LABELS[r] || r).join(', ');
        return `
          <div style="margin-left:${depth * 14}px;">
            <button class="btn btn-outline btn-sm" style="width:100%;justify-content:flex-start;text-align:left;${active ? 'border-color:var(--accent);color:var(--accent);' : ''}" onclick="selectDocFolder(${f.id})" title="${roleShort || 'Visibile a tutti'}">
              ${active ? '[*]' : '[ ]'} ${f.name}
            </button>
            ${renderNode(f.id, depth + 1)}
          </div>
        `;
      }).join('');
    }

    return renderNode(0, 0);
  }

  async function loadDocFolders() {
    ensureDocsState();
    const r = await window.api('GET', '/api/documenti/folders');
    window.state.docFolders = Array.isArray(r?.folders) ? r.folders : [];
    window.state.docCanManage = !!r?.can_manage;

    const currentExists = window.state.docFolders.some(f => f.id === window.state.docCurrentFolderId);
    if (!currentExists) window.state.docCurrentFolderId = window.state.docFolders[0]?.id || null;
  }

  async function loadDocFiles() {
    ensureDocsState();
    if (!window.state.docCurrentFolderId) {
      window.state.docCurrentFiles = [];
      return;
    }
    const rows = await window.api('GET', `/api/documenti/files?folder_id=${window.state.docCurrentFolderId}`);
    window.state.docCurrentFiles = Array.isArray(rows) ? rows : [];
  }

  function renderDocFilesTable() {
    const tbody = document.getElementById('doc-files-body');
    if (!tbody) return;
    const canManage = window.state.docCanManage && isDocsManager();
    const files = window.state.docCurrentFiles || [];
    if (!files.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text3);padding:14px;">Nessun file in questa cartella</td></tr>';
      return;
    }
    tbody.innerHTML = files.map(f => `
      <tr>
        <td><b>${f.file_name}</b></td>
        <td style="font-family:'DM Mono',monospace;">${formatBytes(f.size_bytes)}</td>
        <td style="font-size:12px;color:var(--text2);">${window.formatDateTime(f.created_at)}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-sm" title="Scarica file" onclick="downloadDocFile(${f.id})">Download</button>
          ${canManage ? `<button class="btn btn-danger btn-sm" title="Elimina file" onclick="deleteDocFile(${f.id})">Elimina</button>` : ''}
        </td>
      </tr>
    `).join('');
  }

  function renderDocFolderHeader() {
    const folder = getFolderById(window.state.docCurrentFolderId);
    const nameEl = document.getElementById('doc-current-folder-name');
    const visEl = document.getElementById('doc-current-folder-roles');
    if (nameEl) nameEl.textContent = folder ? folder.name : 'Nessuna cartella selezionata';
    if (visEl) {
      const roles = folder?.allowed_roles || [];
      visEl.textContent = roles.length ? `Visibile a: ${roles.map(r => ROLE_LABELS[r] || r).join(', ')}` : 'Visibile a tutti';
    }
  }

  function renderDocFolderTree() {
    const tree = document.getElementById('doc-folder-tree');
    if (!tree) return;
    tree.innerHTML = window.state.docFolders.length
      ? buildFolderTree()
      : '<div style="font-size:13px;color:var(--text3);padding:8px 0;">Nessuna cartella. Creane una nuova.</div>';
  }

  function fillParentSelect() {
    const sel = document.getElementById('doc-parent-folder');
    if (!sel) return;
    sel.innerHTML = '<option value="">Radice</option>' +
      window.state.docFolders
        .map(f => `<option value="${f.id}" ${window.state.docCurrentFolderId === f.id ? 'selected' : ''}>${f.name}</option>`)
        .join('');
  }

  function renderDocManagerPanel() {
    const panel = document.getElementById('doc-manager-panel');
    if (!panel) return;
    const canManage = window.state.docCanManage && isDocsManager();
    panel.style.display = canManage ? '' : 'none';
    if (!canManage) return;

    const selected = getFolderById(window.state.docCurrentFolderId);
    const selectedRoles = selected?.allowed_roles?.length ? selected.allowed_roles : ['admin', 'amministrazione', 'direzione', 'autista', 'magazzino'];
    renderRoleChecks(selectedRoles);
    fillParentSelect();
  }

  async function renderDocumentiPage() {
    ensureDocsState();
    try {
      await loadDocFolders();
      await loadDocFiles();
      renderDocFolderTree();
      renderDocFolderHeader();
      renderDocManagerPanel();
      renderDocFilesTable();
    } catch (e) {
      window.showToast(e.message || 'Errore caricamento documenti', 'warning');
    }
  }

  async function selectDocFolder(id) {
    window.state.docCurrentFolderId = Number(id) || null;
    await loadDocFiles();
    renderDocFolderTree();
    renderDocFolderHeader();
    renderDocManagerPanel();
    renderDocFilesTable();
  }

  async function createDocFolder() {
    if (!(window.state.docCanManage && isDocsManager())) return;
    const name = (document.getElementById('doc-folder-name')?.value || '').trim();
    const parentIdRaw = document.getElementById('doc-parent-folder')?.value || '';
    const allowedRoles = getSelectedRolesFromUI();
    if (!name) {
      window.showToast('Inserisci il nome della cartella', 'warning');
      return;
    }
    if (!allowedRoles.length) {
      window.showToast('Seleziona almeno un ruolo visibile', 'warning');
      return;
    }
    await window.api('POST', '/api/documenti/folders', {
      name,
      parent_id: parentIdRaw ? Number(parentIdRaw) : null,
      allowed_roles: allowedRoles,
    });
    document.getElementById('doc-folder-name').value = '';
    await renderDocumentiPage();
    window.showToast('Cartella creata', 'success');
  }

  async function updateDocFolderAcl() {
    if (!(window.state.docCanManage && isDocsManager())) return;
    const folder = getFolderById(window.state.docCurrentFolderId);
    if (!folder) {
      window.showToast('Seleziona una cartella', 'warning');
      return;
    }
    const allowedRoles = getSelectedRolesFromUI();
    if (!allowedRoles.length) {
      window.showToast('Seleziona almeno un ruolo visibile', 'warning');
      return;
    }
    await window.api('PUT', `/api/documenti/folders/${folder.id}`, {
      name: folder.name,
      allowed_roles: allowedRoles,
    });
    await renderDocumentiPage();
    window.showToast('Permessi cartella aggiornati', 'success');
  }

  async function deleteDocFolder() {
    if (!(window.state.docCanManage && isDocsManager())) return;
    const folder = getFolderById(window.state.docCurrentFolderId);
    if (!folder) {
      window.showToast('Seleziona una cartella', 'warning');
      return;
    }
    const ok = await window.customConfirm(`Eliminare la cartella "${folder.name}" e tutto il contenuto?`, 'Elimina', 'Elimina cartella');
    if (!ok) return;
    await window.api('DELETE', `/api/documenti/folders/${folder.id}`);
    window.state.docCurrentFolderId = null;
    await renderDocumentiPage();
    window.showToast('Cartella eliminata', 'success');
  }

  async function uploadDocFile() {
    if (!(window.state.docCanManage && isDocsManager())) return;
    const folder = getFolderById(window.state.docCurrentFolderId);
    if (!folder) {
      window.showToast('Seleziona una cartella', 'warning');
      return;
    }
    const input = document.getElementById('doc-file-input');
    const file = input?.files?.[0];
    if (!file) {
      window.showToast('Seleziona un file', 'warning');
      return;
    }

    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Lettura file non riuscita'));
      reader.readAsDataURL(file);
    });

    await window.api('POST', '/api/documenti/files', {
      folder_id: folder.id,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      content_base64: base64,
    });

    if (input) input.value = '';
    await loadDocFiles();
    renderDocFilesTable();
    window.showToast('File caricato', 'success');
  }

  async function downloadDocFile(id) {
    try {
      const res = await fetch(`${window.BASE_URL}/api/documenti/files/${id}/download`, {
        headers: {
          Authorization: `Bearer ${window.state.token}`,
        },
      });
      if (res.status === 401) {
        window.doLogout();
        return;
      }
      const contentType = res.headers.get('content-type') || 'application/octet-stream';
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Download non riuscito');
      }
      const blob = await res.blob();
      const disp = res.headers.get('content-disposition') || '';
      const matched = disp.match(/filename=\"?([^\";]+)\"?/i);
      const fallbackName = matched?.[1] || 'documento';
      const url = URL.createObjectURL(new Blob([blob], { type: contentType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fallbackName || 'documento';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.showToast(e.message || 'Errore download', 'warning');
    }
  }

  async function deleteDocFile(id) {
    if (!(window.state.docCanManage && isDocsManager())) return;
    const ok = await window.customConfirm('Eliminare questo file?', 'Elimina', 'Elimina file');
    if (!ok) return;
    await window.api('DELETE', `/api/documenti/files/${id}`);
    await loadDocFiles();
    renderDocFilesTable();
    window.showToast('File eliminato', 'success');
  }

  window.renderDocumentiPage = renderDocumentiPage;
  window.selectDocFolder = selectDocFolder;
  window.createDocFolder = createDocFolder;
  window.updateDocFolderAcl = updateDocFolderAcl;
  window.deleteDocFolder = deleteDocFolder;
  window.uploadDocFile = uploadDocFile;
  window.downloadDocFile = downloadDocFile;
  window.deleteDocFile = deleteDocFile;
})();
