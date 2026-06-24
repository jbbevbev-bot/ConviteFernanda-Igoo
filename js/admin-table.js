/* Admin table enhancement: filters, full-edit modal and safe open/view actions */
(function(){
  function waitFor(selector, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('timeout')); }, timeout);
    });
  }

  function createToolbar(tableWrap) {
    const toolbar = document.createElement('div');
    toolbar.className = 'admin-enhance-toolbar';
    toolbar.style.display = 'flex';
    toolbar.style.gap = '8px';
    toolbar.style.marginBottom = '8px';
    toolbar.innerHTML = `
      <input id="adminFilterInput" placeholder="Buscar por nome, código ou mesa" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ccc" />
      <select id="adminStatusFilter" style="padding:6px;border-radius:6px;border:1px solid #ccc">
        <option value="all">Todos</option>
        <option value="pendente">Pendente</option>
        <option value="confirmado">Confirmado</option>
        <option value="recusado">Recusado</option>
      </select>
      <button id="adminRefreshTable" class="btn btn-soft">Atualizar tabela</button>
    `;
    tableWrap.parentNode.insertBefore(toolbar, tableWrap);
    return toolbar;
  }

  // filtros por coluna no cabeçalho
  const columnFilters = {
    inviteCode: '',
    name: '',
    guestCount: '',
    contact: '',
    guestLimit: '',
    tableNumber: '',
    guestNames: '',
    passwords: '',
    confirmation: ''
  };

  function createHeaderFilters(table) {
    if (!table) return;
    const thead = table.querySelector('thead');
    if (!thead) return;
    // remove existente row de filtros se houver
    const existing = thead.querySelector('tr.admin-filter-row');
    if (existing) existing.remove();
    const filterRow = document.createElement('tr');
    filterRow.className = 'admin-filter-row';
    // columns: #, codigo, nome, quantidade, contato, limite, mesa, convidados, senhas, confirmacao, acoes
    const makeEmpty = () => { const th = document.createElement('th'); filterRow.appendChild(th); };
    // #
    makeEmpty();
    // codigo
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Código'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.inviteCode = e.target.value.trim().toLowerCase(); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // nome
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Nome'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.name = e.target.value.trim().toLowerCase(); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // quantidade
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Qtd'; inp.type='number'; inp.min='1'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.guestCount = String(e.target.value||''); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // contato
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Contato'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.contact = e.target.value.trim().toLowerCase(); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // limite
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Limite'; inp.type='number'; inp.min='0'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.guestLimit = String(e.target.value||''); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // mesa
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Mesa'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.tableNumber = e.target.value.trim().toLowerCase(); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // convidados cadastrados
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Convidados'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.guestNames = e.target.value.trim().toLowerCase(); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // senhas
    (function(){ const th = document.createElement('th'); const inp = document.createElement('input'); inp.placeholder='Senha'; inp.style.width='100%'; inp.addEventListener('input', e=>{ columnFilters.passwords = e.target.value.trim().toLowerCase(); renderTable(); }); th.appendChild(inp); filterRow.appendChild(th); })();
    // confirmacao
    (function(){ const th = document.createElement('th'); const sel = document.createElement('select'); sel.style.width='100%'; sel.innerHTML = '<option value="">Todos</option><option value="pendente">Pendente</option><option value="confirmado">Confirmado</option><option value="recusado">Recusado</option>'; sel.addEventListener('change', e=>{ columnFilters.confirmation = e.target.value; renderTable(); }); th.appendChild(sel); filterRow.appendChild(th); })();
    // ações
    makeEmpty();
    thead.appendChild(filterRow);
  }

  function renderRowHtml(row) {
    const passwords = Array.isArray(row.passwords) ? row.passwords.map(p => escapeHtml(p.code || '')).join('<br/>') : '';
    const guestNames = Array.isArray(row.guestNames) ? escapeHtml(row.guestNames.join(', ')) : escapeHtml(row.guestNames || '');
    const inviteCode = escapeHtml(row.inviteCode || '');
    const confirmation = escapeHtml(row.confirmation || 'pendente');
    return `
      <tr data-row-id="${row.id}">
        <td>${row.id}</td>
        <td>${inviteCode}</td>
        <td>${escapeHtml(row.name || '')}</td>
        <td>${escapeHtml(String(row.guestCount || 1))}</td>
        <td>${escapeHtml(row.contact || '')}</td>
        <td>${escapeHtml(String(row.guestLimit || 0))}</td>
        <td>${escapeHtml(row.tableNumber || '')}</td>
        <td title="${guestNames}">${guestNames}</td>
        <td title="${passwords}">${passwords}</td>
        <td>${confirmation}</td>
        <td>
          <button class="btn btn-soft btn-sm" data-action="view-card">Abrir</button>
          <button class="btn btn-soft btn-sm" data-action="edit-invite">Editar</button>
          <button class="btn btn-soft btn-sm" data-action="regen-code">Gerar código</button>
          <button class="btn btn-soft btn-sm" data-action="regen-passwords">Gerar senhas</button>
        </td>
      </tr>
    `;
  }

  function escapeHtml(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function openEditModal(row) {
    let modal = document.getElementById('enhEditInviteModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'enhEditInviteModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-backdrop" data-close-modal></div>
        <div class="modal-dialog glass-card modal-md">
          <button class="modal-close" type="button" data-close-modal aria-label="Fechar">✕</button>
          <h3>Editar convite</h3>
          <form id="enhEditInviteForm">
            <input type="hidden" id="enhEditInviteId" />
            <label>Código interno<br/><input id="enhEditInviteCode" /></label>
            <label>Nome<br/><input id="enhEditInviteName" /></label>
            <label>Quantidade (guestCount)<br/><input id="enhEditInviteGuestCount" type="number" min="1" max="30" /></label>
            <label>Limite (guestLimit)<br/><input id="enhEditInviteGuestLimit" type="number" min="0" max="30" /></label>
            <label>Contato<br/><input id="enhEditInviteContact" /></label>
            <label>Mesa<br/><input id="enhEditInviteTable" /></label>
            <label>Convidados cadastrados (uma por linha)<br/><textarea id="enhEditInviteGuestNames" rows="4"></textarea></label>
            <label>Senhas (uma por linha)<br/><textarea id="enhEditInvitePasswords" rows="4" placeholder="cada linha = uma senha"></textarea></label>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-primary" type="submit">Salvar</button>
              <button class="btn btn-soft" type="button" data-close-modal>Cancelar</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelectorAll('[data-close-modal]').forEach(el=>el.addEventListener('click', ()=> modal.classList.remove('show')));
      document.getElementById('enhEditInviteForm').addEventListener('submit', (ev)=>{
        ev.preventDefault();
        const id = Number(document.getElementById('enhEditInviteId').value);
        const row = state.invites.find(r=>Number(r.id)===id);
        if (!row) { showToast('Convite não encontrado.', 'declined'); modal.classList.remove('show'); return; }
        row.inviteCode = String(document.getElementById('enhEditInviteCode').value||'').trim();
        row.name = String(document.getElementById('enhEditInviteName').value||'').trim();
        row.guestCount = Math.max(1, Math.min(30, Number(document.getElementById('enhEditInviteGuestCount').value||1)));
        // garantir que, se admin alterou guestCount, qualquer attendingCount deixará de prevalecer
        if ('attendingCount' in row) delete row.attendingCount;
        row.guestLimit = Math.max(0, Math.min(30, Number(document.getElementById('enhEditInviteGuestLimit').value||0)));
        row.contact = String(document.getElementById('enhEditInviteContact').value||'').trim();
        row.tableNumber = String(document.getElementById('enhEditInviteTable').value||'').trim();
        row.guestNames = String(document.getElementById('enhEditInviteGuestNames').value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        const passLines = String(document.getElementById('enhEditInvitePasswords').value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        row.passwords = passLines.map(p=>({ code: p }));
        renderTable();
        if (typeof renderInviteTable === 'function') try { renderInviteTable(); } catch(e) {}
        if (typeof renderAdminStats === 'function') try { renderAdminStats(); } catch(e) {}
        showToast('Convite atualizado localmente.', 'confirmed');
        modal.classList.remove('show');
      });
    }
    // fill
    document.getElementById('enhEditInviteId').value = row.id;
    document.getElementById('enhEditInviteCode').value = row.inviteCode || '';
    document.getElementById('enhEditInviteName').value = row.name || '';
    document.getElementById('enhEditInviteGuestCount').value = row.guestCount || 1;
    document.getElementById('enhEditInviteGuestLimit').value = row.guestLimit || 0;
    document.getElementById('enhEditInviteContact').value = row.contact || '';
    document.getElementById('enhEditInviteTable').value = row.tableNumber || '';
    document.getElementById('enhEditInviteGuestNames').value = Array.isArray(row.guestNames)? row.guestNames.join('\n') : (row.guestNames||'');
    document.getElementById('enhEditInvitePasswords').value = Array.isArray(row.passwords)? row.passwords.map(p=>p.code||'').join('\n') : '';
    // ensure guest names textarea has lines matching guestCount-1 (companions)
    const guestCountInput = document.getElementById('enhEditInviteGuestCount');
    const guestNamesArea = document.getElementById('enhEditInviteGuestNames');
    function syncGuestNamesLines() {
      const count = Math.max(1, Math.min(30, Number(guestCountInput.value || 1)));
      const desired = Math.max(0, count - 1);
      const lines = String(guestNamesArea.value || '').split(/\r?\n/).map(s => s.trim());
      while (lines.length < desired) lines.push('');
      while (lines.length > desired) lines.pop();
      guestNamesArea.value = lines.join('\n');
    }
    // attach listener (avoid duplicates)
    if (!guestCountInput._syncAttached) {
      guestCountInput.addEventListener('input', syncGuestNamesLines);
      guestCountInput._syncAttached = true;
    }
    // call once to align textarea
    syncGuestNamesLines();
    modal.classList.add('show');
  }

  function openTicketSafe(row) {
    try {
      if (!row.inviteCode && typeof create_invite_code === 'function') {
        row.inviteCode = create_invite_code(state.invites, row.id);
      } else if (!row.inviteCode && typeof createInviteCode === 'function') {
        row.inviteCode = createInviteCode(state.invites, row.id);
      }
      if ((!row.passwords || !row.passwords.length) && typeof createPasswords === 'function') {
        row.passwords = createPasswords(row.guestCount || 1);
      }
      if (typeof openTicket === 'function') {
        openTicket(row);
      } else {
        showToast('Função de abertura de convite indisponível.', 'declined');
      }
    } catch (err) {
      console.error('Erro ao abrir convite:', err);
      showToast('Não foi possível abrir o convite. Verifique os dados.', 'declined');
    }
  }

  let currentFilter = '';
  let currentStatus = 'all';

  function renderTable() {
    const tbody = document.getElementById('inviteTableBody');
    if (!tbody) return;
    const rows = Array.isArray(state.invites)? state.invites.slice() : [];
    const filtered = rows.filter(r => {
      // status filter from toolbar
      if (currentStatus !== 'all' && String(r.confirmation||'pendente') !== currentStatus) return false;
      // toolbar-wide filter
      if (currentFilter) {
        const f = currentFilter.toLowerCase();
        if (!(String(r.name||'').toLowerCase().includes(f) || String(r.inviteCode||'').toLowerCase().includes(f) || String(r.tableNumber||'').toLowerCase().includes(f) || String(r.contact||'').toLowerCase().includes(f))) return false;
      }
      // per-column filters
      if (columnFilters.inviteCode && !String(r.inviteCode||'').toLowerCase().includes(columnFilters.inviteCode)) return false;
      if (columnFilters.name && !String(r.name||'').toLowerCase().includes(columnFilters.name)) return false;
      if (columnFilters.guestCount) { try { if (Number(r.guestCount||0) !== Number(columnFilters.guestCount)) return false; } catch(e) {} }
      if (columnFilters.contact && !String(r.contact||'').toLowerCase().includes(columnFilters.contact)) return false;
      if (columnFilters.guestLimit) { try { if (Number(r.guestLimit||0) !== Number(columnFilters.guestLimit)) return false; } catch(e) {} }
      if (columnFilters.tableNumber && !String(r.tableNumber||'').toLowerCase().includes(columnFilters.tableNumber)) return false;
      if (columnFilters.guestNames) { const names = Array.isArray(r.guestNames)? r.guestNames.join(' ').toLowerCase() : String(r.guestNames||'').toLowerCase(); if (!names.includes(columnFilters.guestNames)) return false; }
      if (columnFilters.passwords) { const pw = Array.isArray(r.passwords)? r.passwords.map(p=>p.code||'').join(' ').toLowerCase() : ''; if (!pw.includes(columnFilters.passwords)) return false; }
      if (columnFilters.confirmation && String(r.confirmation||'pendente') !== columnFilters.confirmation) return false;
      return true;
    });
    tbody.innerHTML = filtered.map(renderRowHtml).join('\n');
  }

  async function init() {
    try {
      await waitFor('#inviteTableBody', 5000);
    } catch (e) { return; }
    const tableWrap = document.querySelector('.table-wrap');
    if (!tableWrap) return;
    const table = tableWrap.querySelector('table.invite-table');
    createHeaderFilters(table);
    const toolbar = createToolbar(tableWrap);
    const filterInput = toolbar.querySelector('#adminFilterInput');
    const statusSelect = toolbar.querySelector('#adminStatusFilter');
    toolbar.querySelector('#adminRefreshTable').addEventListener('click', ()=>{
      if (typeof loadAdminState === 'function') loadAdminState();
      renderTable();
    });
    filterInput.addEventListener('input', (e)=>{ currentFilter = e.target.value; renderTable(); });
    statusSelect.addEventListener('change', (e)=>{ currentStatus = e.target.value; renderTable(); });

    // delegate actions on tbody
    document.getElementById('inviteTableBody').addEventListener('click', (ev)=>{
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const id = Number(tr.dataset.rowId);
      const row = state.invites.find(r=>Number(r.id)===id);
      if (!row) return;
      const action = btn.dataset.action;
      if (action === 'edit-invite') return openEditModal(row);
      if (action === 'view-card') return openTicketSafe(row);
      if (action === 'regen-code') { if (typeof createInviteCode === 'function') row.inviteCode = createInviteCode(state.invites, row.id); renderTable(); if (typeof renderInviteTable === 'function') try { renderInviteTable(); } catch(e) {} if (typeof renderAdminStats === 'function') try { renderAdminStats(); } catch(e) {} return; }
      if (action === 'regen-passwords') {
        if (typeof createPasswords === 'function') {
          const maxAllowed = row.guestLimit && Number(row.guestLimit) > 0 ? Math.min(Number(row.guestCount || 1), Number(row.guestLimit)) : Number(row.guestCount || 1);
          row.passwords = createPasswords(maxAllowed);
        }
        renderTable();
        if (typeof renderInviteTable === 'function') try { renderInviteTable(); } catch(e) {}
        if (typeof renderAdminStats === 'function') try { renderAdminStats(); } catch(e) {}
        return;
      }
    });

    // initial render
    renderTable();
  }

  // init after DOM
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
