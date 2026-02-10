// ============ VARIABLES GLOBALES ============
let currentToken = null;
let currentUser = null;
let treeData = {};
let currentTreePage = 1;
let treePageSize = 50;
let currentParentDN = null;

// États de pagination par section
const paginationState = {
    users:  { page: 1, pageSize: 25, query: '', totalCount: 0, totalPages: 0 },
    groups: { page: 1, pageSize: 25, query: '', totalCount: 0, totalPages: 0 },
    search: { page: 1, pageSize: 25, lastParams: null, totalCount: 0, totalPages: 0 },
    logs:   { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }
};

const API_BASE_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin;

// ============ FONCTIONS D'AUTHENTIFICATION ============
function toggleAuth() {
    if (currentToken) logout();
    else showModal('loginModal');
}

async function performLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) { showToast('Veuillez remplir tous les champs', 'error'); return; }
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Erreur ${response.status}`;
            try { const errorData = JSON.parse(errorText); errorMessage = errorData.error || errorMessage; } catch (e) {}
            showToast(errorMessage, 'error'); return;
        }
        const data = await response.json();
        if (data.success || data.token) {
            currentToken = data.token;
            currentUser = data.user;
            localStorage.setItem('token', currentToken);
            updateStatus(true);
            closeModal('loginModal');
            showToast('Connexion réussie !', 'success');
            loadDashboardData();
        } else {
            showToast(data.error || 'Échec de la connexion', 'error');
        }
    } catch (error) {
        showToast('Impossible de contacter le serveur: ' + error.message, 'error');
    }
}

function logout() {
    currentToken = null; currentUser = null;
    localStorage.removeItem('token');
    updateStatus(false);
    showToast('Déconnexion réussie', 'info');
    showSection('dashboard');
}

function updateStatus(connected) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    if (connected) {
        statusDot.style.background = '#4ade80';
        statusText.textContent = `Connecté (${currentUser?.username || 'Utilisateur'})`;
        statusDot.style.animation = 'pulse 2s infinite';
    } else {
        statusDot.style.background = '#ef4444';
        statusText.textContent = 'Déconnecté';
        statusDot.style.animation = 'none';
    }
}

// ============ FONCTIONS D'API ============
async function apiRequest(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...options.headers };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
    let fullEndpoint = endpoint.startsWith('/api') ? endpoint : '/api' + endpoint;
    try {
        const response = await fetch(`${API_BASE_URL}${fullEndpoint}`, { ...options, headers });
        if (response.status === 401) { logout(); showToast('Session expirée, veuillez vous reconnecter', 'error'); throw new Error('Unauthorized'); }
        if (!response.ok) { const errorText = await response.text(); throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`); }
        return await response.json();
    } catch (error) {
        console.error('❌ API request error:', error);
        showToast('Erreur API: ' + error.message, 'error');
        throw error;
    }
}

// ============ FONCTIONS D'AFFICHAGE ============
function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`[onclick="showSection('${id}')"]`);
    if (navItem) navItem.classList.add('active');
    switch(id) {
        case 'dashboard': loadDashboardData(); break;
        case 'browse': currentTreePage = 1; currentParentDN = null; loadLDAPTree(); break;
        case 'users': paginationState.users.page = 1; loadUsers(); break;
        case 'groups': paginationState.groups.page = 1; loadGroups(); break;
        case 'logs': paginationState.logs.page = 1; loadLogs(); break;
    }
}

function showModal(id) {
    if (!currentToken && id !== 'loginModal') { showToast('Veuillez vous connecter d\'abord', 'error'); showModal('loginModal'); return; }
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============ COMPOSANT PAGINATION RÉUTILISABLE ============
function createPaginationBar(pagination, onPageChange, onPageSizeChange) {
    const bar = document.createElement('div');
    bar.className = 'pagination-bar';

    const info = document.createElement('div');
    info.className = 'pagination-info-text';
    if (pagination.totalCount > 0) {
        info.innerHTML = `
            Affichage <strong>${pagination.startIndex + 1}–${pagination.endIndex}</strong>
            sur <strong>${pagination.totalCount}</strong> résultat(s)
            &nbsp;|&nbsp; Page <strong>${pagination.currentPage}</strong>/<strong>${pagination.totalPages}</strong>
        `;
    } else {
        info.textContent = 'Aucun résultat';
    }

    const controls = document.createElement('div');
    controls.className = 'pagination-controls';

    // Bouton Première page
    const firstBtn = document.createElement('button');
    firstBtn.className = 'btn btn-page';
    firstBtn.innerHTML = '«';
    firstBtn.title = 'Première page';
    firstBtn.disabled = !pagination.hasPreviousPage;
    firstBtn.onclick = () => onPageChange(1);
    controls.appendChild(firstBtn);

    // Bouton Précédent
    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-page';
    prevBtn.innerHTML = '‹';
    prevBtn.title = 'Page précédente';
    prevBtn.disabled = !pagination.hasPreviousPage;
    prevBtn.onclick = () => onPageChange(pagination.currentPage - 1);
    controls.appendChild(prevBtn);

    // Numéros de pages
    const pagesDiv = document.createElement('div');
    pagesDiv.className = 'page-numbers';
    const totalPages = pagination.totalPages;
    const currentPage = pagination.currentPage;
    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages = [1];
        if (currentPage > 3) pages.push('...');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
    }
    pages.forEach(p => {
        if (p === '...') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-ellipsis';
            ellipsis.textContent = '…';
            pagesDiv.appendChild(ellipsis);
        } else {
            const btn = document.createElement('button');
            btn.className = 'btn btn-page' + (p === currentPage ? ' btn-page-active' : '');
            btn.textContent = p;
            btn.onclick = () => onPageChange(p);
            pagesDiv.appendChild(btn);
        }
    });
    controls.appendChild(pagesDiv);

    // Bouton Suivant
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-page';
    nextBtn.innerHTML = '›';
    nextBtn.title = 'Page suivante';
    nextBtn.disabled = !pagination.hasNextPage;
    nextBtn.onclick = () => onPageChange(pagination.currentPage + 1);
    controls.appendChild(nextBtn);

    // Bouton Dernière page
    const lastBtn = document.createElement('button');
    lastBtn.className = 'btn btn-page';
    lastBtn.innerHTML = '»';
    lastBtn.title = 'Dernière page';
    lastBtn.disabled = !pagination.hasNextPage;
    lastBtn.onclick = () => onPageChange(pagination.totalPages);
    controls.appendChild(lastBtn);

    // Sélecteur taille de page
    const sizeDiv = document.createElement('div');
    sizeDiv.className = 'page-size-selector';
    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = 'Lignes : ';
    const sizeSelect = document.createElement('select');
    [10, 25, 50, 100].forEach(size => {
        const opt = document.createElement('option');
        opt.value = size;
        opt.textContent = size;
        opt.selected = size === pagination.pageSize;
        sizeSelect.appendChild(opt);
    });
    sizeSelect.onchange = (e) => onPageSizeChange(parseInt(e.target.value));
    sizeDiv.appendChild(sizeLabel);
    sizeDiv.appendChild(sizeSelect);
    controls.appendChild(sizeDiv);

    bar.appendChild(info);
    bar.appendChild(controls);
    return bar;
}

// ============ DASHBOARD ============
async function loadDashboardData() {
    if (!currentToken) {
        document.getElementById('statsGrid').innerHTML = '<p>Connectez-vous pour voir les statistiques</p>';
        document.getElementById('recentActivity').innerHTML = '<p>Connectez-vous pour voir l\'activité</p>';
        return;
    }
    try {
        const stats = await apiRequest('/stats');
        renderStats(stats);
        const logs = await apiRequest('/logs?pageSize=5');
        renderRecentActivity(logs.logs);
    } catch (error) {
        document.getElementById('statsGrid').innerHTML = '<p>Erreur de chargement</p>';
    }
}

function renderStats(stats) {
    document.getElementById('statsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-value">${stats.users || 0}</div><div class="stat-label">Utilisateurs</div></div>
        <div class="stat-card" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);"><div class="stat-value">${stats.groups || 0}</div><div class="stat-label">Groupes</div></div>
        <div class="stat-card" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);"><div class="stat-value">${stats.ous || 0}</div><div class="stat-label">Unités org.</div></div>
        <div class="stat-card" style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);"><div class="stat-value">${stats.totalEntries || 0}</div><div class="stat-label">Entrées LDAP</div></div>
    `;
}

function renderRecentActivity(logs) {
    const container = document.getElementById('recentActivity');
    if (!logs || logs.length === 0) { container.innerHTML = '<p>Aucune activité récente</p>'; return; }
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>Action</th><th>Utilisateur</th><th>Date</th><th>Statut</th></tr></thead>
        <tbody>${logs.map(log => `<tr><td>${log.action}</td><td>${log.user_id || 'Système'}</td><td>${new Date(log.created_at).toLocaleString()}</td><td><span class="badge ${log.status === 'success' ? 'badge-success' : 'badge-warning'}">${log.status}</span></td></tr>`).join('')}</tbody>`;
    container.innerHTML = '';
    container.appendChild(table);
}

// ============ ARBORESCENCE LDAP ============
async function loadLDAPTree(parentDN = null, page = 1) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    const treeContainer = document.getElementById('ldapTree');
    const refreshBtn = document.getElementById('refreshTreeBtn');
    if (refreshBtn) refreshBtn.disabled = true;
    treeContainer.innerHTML = '<div class="loading-text"><div class="spinner"></div>Chargement...</div>';
    try {
        currentParentDN = parentDN;
        currentTreePage = page;
        const params = new URLSearchParams({ page, pageSize: treePageSize });
        if (parentDN) params.append('parentDN', parentDN);
        const data = await apiRequest(`/ldap/children?${params.toString()}`);
        treeData.root = data;
        renderTreeWithPagination(data);
    } catch (error) {
        treeContainer.innerHTML = '<p style="color: #ef4444;">Erreur lors du chargement</p>';
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

function renderTreeWithPagination(data) {
    const treeContainer = document.getElementById('ldapTree');
    treeContainer.innerHTML = '';

    const topBar = createPaginationBar(
        data.pagination,
        (p) => loadLDAPTree(currentParentDN, p),
        (s) => { treePageSize = s; loadLDAPTree(currentParentDN, 1); }
    );
    treeContainer.appendChild(topBar);

    if (!data.entries || data.entries.length === 0) {
        const noData = document.createElement('p');
        noData.className = 'no-data';
        noData.textContent = 'Aucune entrée trouvée';
        treeContainer.appendChild(noData);
        return;
    }
    const entriesContainer = document.createElement('div');
    data.entries.forEach((entry, index) => {
        entriesContainer.appendChild(createTreeNode(entry, index, 0));
    });
    treeContainer.appendChild(entriesContainer);

    const bottomBar = createPaginationBar(
        data.pagination,
        (p) => loadLDAPTree(currentParentDN, p),
        (s) => { treePageSize = s; loadLDAPTree(currentParentDN, 1); }
    );
    treeContainer.appendChild(bottomBar);
}

function createTreeNode(entry, index, level, parentId = 'root') {
    const nodeId = `${parentId}_${index}`;
    const nodeWrapper = document.createElement('div');
    nodeWrapper.className = 'tree-node-wrapper';
    nodeWrapper.dataset.nodeId = nodeId;
    nodeWrapper.dataset.dn = entry.dn;
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.style.marginLeft = `${level * 20}px`;
    const icon = getIcon(entry);
    const label = getLabel(entry);
    const hasChildren = entry.hasChildren || false;
    const childCount = entry.childCount || 0;
    const childCountBadge = hasChildren && childCount > 0
        ? `<span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px; margin-left: 8px;">${childCount}</span>` : '';
    node.innerHTML = `
        ${hasChildren ? `<span class="tree-toggle collapsed">▶</span>` : '<span class="tree-toggle"></span>'}
        <span class="tree-icon">${icon}</span>
        <div class="tree-label">
            <div><strong>${label}</strong>${childCountBadge}</div>
            <div class="tree-dn">${entry.dn}</div>
        </div>
        ${hasChildren ? '<span class="tree-loading" style="display:none;">⌛</span>' : ''}
    `;
    if (hasChildren) {
        const toggle = node.querySelector('.tree-toggle');
        toggle.addEventListener('click', (e) => { e.stopPropagation(); loadLDAPTree(entry.dn, 1); });
    }
    node.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tree-toggle') && !e.target.classList.contains('tree-loading')) selectNode(node, entry);
    });
    nodeWrapper.appendChild(node);
    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children collapsed';
        childrenContainer.id = `children_${nodeId}`;
        nodeWrapper.appendChild(childrenContainer);
    }
    treeData[nodeId] = entry;
    return nodeWrapper;
}

function getIcon(entry) {
    const objectClasses = entry.attributes?.objectClass;
    if (!objectClasses) return '📄';
    const classes = Array.isArray(objectClasses) ? objectClasses : [objectClasses];
    if (classes.includes('inetOrgPerson') || classes.includes('person')) return '👤';
    if (classes.includes('groupOfNames') || classes.includes('groupOfUniqueNames')) return '👥';
    if (classes.includes('organizationalUnit')) return '📂';
    if (classes.includes('organization')) return '🏢';
    if (classes.includes('domain')) return '🌐';
    return '📁';
}

function getLabel(entry) {
    return entry.attributes?.cn || entry.attributes?.ou || entry.attributes?.dc || entry.attributes?.uid || entry.dn.split(',')[0].split('=')[1];
}

function selectNode(node, entry) {
    document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
    node.classList.add('selected');
    showEntryDetails(entry);
}

function filterTree() {
    const filter = document.getElementById('treeFilter').value.toLowerCase();
    document.querySelectorAll('.tree-node').forEach(node => {
        const text = node.textContent.toLowerCase();
        node.parentElement.style.display = text.includes(filter) ? 'block' : 'none';
    });
}

// ============ UTILISATEURS AVEC PAGINATION ============
async function loadUsers(page = null) {
    if (!currentToken) return;
    if (page !== null) paginationState.users.page = page;
    const state = paginationState.users;
    try {
        const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
        if (state.query) params.append('query', state.query);
        const data = await apiRequest(`/ldap/users/search?${params.toString()}`);
        state.totalCount = data.pagination?.totalCount || 0;
        state.totalPages = data.pagination?.totalPages || 0;
        renderUsers(data.users || data.entries, data.pagination);
    } catch (error) {
        showToast('Erreur lors du chargement des utilisateurs', 'error');
    }
}

function renderUsers(users, pagination) {
    const section = document.getElementById('users');
    let tableWrapper = section.querySelector('.table-wrapper');
    if (!tableWrapper) { tableWrapper = document.createElement('div'); tableWrapper.className = 'table-wrapper'; section.querySelector('.card').appendChild(tableWrapper); }

    // Vider et reconstruire la zone table + pagination
    tableWrapper.innerHTML = '';

    if (!users || users.length === 0) {
        tableWrapper.innerHTML = '<p class="no-data">Aucun utilisateur trouvé</p>';
    } else {
        const table = document.createElement('table');
        table.innerHTML = `<thead><tr><th>Nom</th><th>Email</th><th>UID</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>${users.map(user => {
                const uid = user.attributes?.uid || user.dn.match(/uid=([^,]+)/)?.[1] || 'N/A';
                const cn = user.attributes?.cn || 'N/A';
                const mail = user.attributes?.mail || 'N/A';
                const dn = user.dn;
                const dnEscaped = dn.replace(/`/g, '\\`').replace(/'/g, "\\'");
                return `<tr>
                    <td>${cn}</td><td>${mail}</td><td>${uid}</td>
                    <td><span class="badge badge-success">Actif</span></td>
                    <td>
                        <button class="btn btn-primary" style="padding:6px 12px;font-size:12px" onclick='editUser(\`${dnEscaped}\`)'>Éditer</button>
                        <button class="btn btn-danger" style="padding:6px 12px;font-size:12px" onclick='deleteUser(\`${dnEscaped}\`)'>Supprimer</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>`;
        tableWrapper.appendChild(table);
    }

    if (pagination && pagination.totalPages > 1) {
        const bar = createPaginationBar(
            pagination,
            (p) => loadUsers(p),
            (s) => { paginationState.users.pageSize = s; loadUsers(1); }
        );
        tableWrapper.appendChild(bar);
    }

    // Mettre à jour le tbody dans la table HTML statique aussi
    const staticTbody = document.getElementById('usersTableBody');
    if (staticTbody) staticTbody.innerHTML = '';
}

async function searchUsers() {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    const query = document.getElementById('userSearch').value;
    paginationState.users.query = query;
    paginationState.users.page = 1;
    await loadUsers();
    showToast(`Recherche effectuée : ${paginationState.users.totalCount} résultat(s)`, 'success');
}

async function createUser() {
    const cn = document.getElementById('newUserCn').value;
    const sn = document.getElementById('newUserSn').value;
    const uid = document.getElementById('newUserUid').value;
    const mail = document.getElementById('newUserMail').value;
    const password = document.getElementById('newUserPassword').value;
    const ou = document.getElementById('newUserOu').value;
    if (!cn || !sn || !uid || !mail || !password) { showToast('Veuillez remplir tous les champs obligatoires', 'error'); return; }
    try {
        await apiRequest('/ldap/users', { method: 'POST', body: JSON.stringify({ cn, sn, uid, mail, userPassword: password, ou }) });
        showToast('Utilisateur créé avec succès', 'success');
        closeModal('addUserModal');
        ['newUserCn','newUserSn','newUserUid','newUserMail','newUserPassword'].forEach(id => document.getElementById(id).value = '');
        loadUsers(1);
    } catch (error) {
        showToast(error.message || 'Erreur lors de la création', 'error');
    }
}

async function editUser(dn) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    try {
        const data = await apiRequest(`/ldap/users/${encodeURIComponent(dn)}`);
        const user = data.user || data;
        const uid = user.attributes?.uid || dn.match(/uid=([^,]+)/)?.[1] || 'unknown';
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'editUserModal';
        modal.innerHTML = `<div class="modal-content">
            <div class="modal-header"><h2>Éditer l'utilisateur</h2><button class="close-btn" onclick="closeModal('editUserModal')">&times;</button></div>
            <div class="form-row">
                <div class="form-group"><label>Nom complet (CN)*</label><input type="text" id="editUserCn" value="${user.attributes?.cn || ''}"></div>
                <div class="form-group"><label>Nom de famille (SN)*</label><input type="text" id="editUserSn" value="${user.attributes?.sn || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Email*</label><input type="email" id="editUserMail" value="${user.attributes?.mail || ''}"></div>
                <div class="form-group"><label>Unité organisationnelle</label><input type="text" id="editUserOu" value="${dn.match(/ou=([^,]+)/)?.[1] || 'people'}"></div>
            </div>
            <div class="action-buttons">
                <button class="btn btn-success" onclick='updateUser("${uid}", \`${dn.replace(/`/g, '\\`')}\`)'>Mettre à jour</button>
                <button class="btn btn-secondary" onclick="closeModal('editUserModal')">Annuler</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (error) {
        showToast('Erreur lors du chargement des informations utilisateur', 'error');
    }
}

async function updateUser(uid, oldDn) {
    const cn = document.getElementById('editUserCn').value;
    const sn = document.getElementById('editUserSn').value;
    const mail = document.getElementById('editUserMail').value;
    const ou = document.getElementById('editUserOu').value;
    if (!cn || !sn || !mail) { showToast('Veuillez remplir tous les champs obligatoires', 'error'); return; }
    try {
        await apiRequest(`/ldap/users/${uid}`, { method: 'PUT', body: JSON.stringify({ cn, sn, mail, ou }) });
        showToast('Utilisateur mis à jour avec succès', 'success');
        const modal = document.getElementById('editUserModal');
        if (modal) modal.remove();
        loadUsers();
    } catch (error) {
        showToast(error.message || 'Erreur lors de la mise à jour', 'error');
    }
}

async function deleteUser(dn) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    const uid = dn.match(/uid=([^,]+)/)?.[1];
    const ou = dn.match(/ou=([^,]+)/)?.[1];
    if (!uid) { showToast('Impossible d\'extraire l\'UID du DN', 'error'); return; }
    if (!confirm(`Êtes-vous sûr de vouloir supprimer l'utilisateur "${uid}" ?\n\nCette action est irréversible.`)) return;
    try {
        const queryParams = ou ? `?ou=${encodeURIComponent(ou)}` : '';
        await apiRequest(`/ldap/users/${uid}${queryParams}`, { method: 'DELETE' });
        showToast('Utilisateur supprimé avec succès', 'success');
        loadUsers();
    } catch (error) {
        showToast(error.message || 'Erreur lors de la suppression', 'error');
    }
}

// ============ GROUPES AVEC PAGINATION ============
async function loadGroups(page = null) {
    if (!currentToken) return;
    if (page !== null) paginationState.groups.page = page;
    const state = paginationState.groups;
    try {
        const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
        if (state.query) params.append('query', state.query);
        const data = await apiRequest(`/ldap/groups/search?${params.toString()}`);
        state.totalCount = data.pagination?.totalCount || 0;
        state.totalPages = data.pagination?.totalPages || 0;
        renderGroups(data.groups || data.entries, data.pagination);
    } catch (error) {
        showToast('Erreur lors du chargement des groupes', 'error');
    }
}

function renderGroups(groups, pagination) {
    const section = document.getElementById('groups');
    let tableWrapper = section.querySelector('.table-wrapper');
    if (!tableWrapper) { tableWrapper = document.createElement('div'); tableWrapper.className = 'table-wrapper'; section.querySelector('.card').appendChild(tableWrapper); }
    tableWrapper.innerHTML = '';

    if (!groups || groups.length === 0) {
        tableWrapper.innerHTML = '<p class="no-data">Aucun groupe trouvé</p>';
    } else {
        const table = document.createElement('table');
        table.innerHTML = `<thead><tr><th>Nom du groupe</th><th>Description</th><th>Membres</th><th>Actions</th></tr></thead>
            <tbody>${groups.map(group => {
                const cn = group.attributes?.cn || 'N/A';
                const description = group.attributes?.description || '—';
                const members = group.attributes?.member;
                const memberCount = Array.isArray(members) ? members.length : (members ? 1 : 0);
                const dn = group.dn;
                const dnEscaped = dn.replace(/`/g, '\\`').replace(/'/g, "\\'");
                return `<tr>
                    <td>${cn}</td><td>${description}</td>
                    <td><span class="badge badge-info">${memberCount} membre(s)</span></td>
                    <td>
                        <button class="btn btn-primary" style="padding:6px 12px;font-size:12px" onclick='editGroup(\`${dnEscaped}\`)'>Éditer</button>
                        <button class="btn btn-danger" style="padding:6px 12px;font-size:12px" onclick='deleteGroup(\`${dnEscaped}\`)'>Supprimer</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>`;
        tableWrapper.appendChild(table);
    }

    if (pagination && pagination.totalPages > 1) {
        const bar = createPaginationBar(
            pagination,
            (p) => loadGroups(p),
            (s) => { paginationState.groups.pageSize = s; loadGroups(1); }
        );
        tableWrapper.appendChild(bar);
    }

    const staticTbody = document.getElementById('groupsTableBody');
    if (staticTbody) staticTbody.innerHTML = '';
}

async function searchGroups() {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    const query = document.getElementById('groupSearch').value;
    paginationState.groups.query = query;
    paginationState.groups.page = 1;
    await loadGroups();
    showToast(`Recherche effectuée : ${paginationState.groups.totalCount} résultat(s)`, 'success');
}

async function createGroup() {
    const cn = document.getElementById('newGroupCn').value;
    const description = document.getElementById('newGroupDescription').value;
    const members = document.getElementById('newGroupMembers').value.split(',').map(m => m.trim()).filter(m => m);
    if (!cn) { showToast('Le nom du groupe est obligatoire', 'error'); return; }
    try {
        await apiRequest('/ldap/groups', { method: 'POST', body: JSON.stringify({ cn, description, members: members.length > 0 ? members : undefined }) });
        showToast('Groupe créé avec succès', 'success');
        closeModal('addGroupModal');
        ['newGroupCn','newGroupDescription','newGroupMembers'].forEach(id => document.getElementById(id).value = '');
        loadGroups(1);
    } catch (error) {
        showToast(error.message || 'Erreur lors de la création', 'error');
    }
}

async function editGroup(dn) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    try {
        const data = await apiRequest(`/ldap/groups/${encodeURIComponent(dn)}`);
        const group = data.group || data;
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'editGroupModal';
        modal.innerHTML = `<div class="modal-content">
            <div class="modal-header"><h2>Éditer le groupe</h2><button class="close-btn" onclick="closeModal('editGroupModal')">&times;</button></div>
            <div class="form-row"><div class="form-group"><label>Description</label><input type="text" id="editGroupDescription" value="${group.attributes?.description || ''}"></div></div>
            <div class="form-row"><div class="form-group"><label>Membres (DN séparés par des virgules)</label>
                <textarea id="editGroupMembers" rows="4">${Array.isArray(group.attributes?.member) ? group.attributes.member.join(',\n') : group.attributes?.member || ''}</textarea>
            </div></div>
            <div class="action-buttons">
                <button class="btn btn-success" onclick='updateGroup(\`${dn.replace(/`/g, '\\`')}\`)'>Mettre à jour</button>
                <button class="btn btn-secondary" onclick="closeModal('editGroupModal')">Annuler</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (error) {
        showToast('Erreur lors du chargement des informations du groupe', 'error');
    }
}

async function updateGroup(dn) {
    const description = document.getElementById('editGroupDescription').value;
    const members = document.getElementById('editGroupMembers').value.split(',').map(m => m.trim()).filter(m => m);
    try {
        await apiRequest(`/ldap/groups/${encodeURIComponent(dn)}`, { method: 'PUT', body: JSON.stringify({ description, members: members.length > 0 ? members : undefined }) });
        showToast('Groupe mis à jour avec succès', 'success');
        const modal = document.getElementById('editGroupModal');
        if (modal) modal.remove();
        loadGroups();
    } catch (error) {
        showToast(error.message || 'Erreur lors de la mise à jour', 'error');
    }
}

async function deleteGroup(dn) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    const groupName = dn.match(/cn=([^,]+)/)?.[1] || 'Inconnu';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le groupe "${groupName}" ?\n\nCette action est irréversible.`)) return;
    try {
        await apiRequest(`/ldap/groups/${encodeURIComponent(dn)}`, { method: 'DELETE' });
        showToast('Groupe supprimé avec succès', 'success');
        loadGroups();
    } catch (error) {
        showToast(error.message || 'Erreur lors de la suppression', 'error');
    }
}

// ============ RECHERCHE AVANCÉE AVEC PAGINATION ============
async function performSearch(page = 1) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    const baseDN = document.getElementById('searchBaseDN').value;
    const filter = document.getElementById('searchFilter').value;
    const scope = document.getElementById('searchScope').value;
    const attributes = document.getElementById('searchAttributes').value.split(',').map(a => a.trim()).filter(a => a);
    const state = paginationState.search;
    state.page = page;
    state.lastParams = { baseDN, filter, scope, attributes };
    try {
        const data = await apiRequest('/ldap/search', {
            method: 'POST',
            body: JSON.stringify({ baseDN, filter, scope, attributes: attributes.length > 0 ? attributes : undefined, page, pageSize: state.pageSize })
        });
        state.totalCount = data.pagination?.totalCount || 0;
        state.totalPages = data.pagination?.totalPages || 0;
        renderSearchResults(data.entries, data.pagination);
    } catch (error) {
        showToast('Erreur lors de la recherche', 'error');
    }
}

function renderSearchResults(entries, pagination) {
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '';

    if (!entries || entries.length === 0) {
        resultsContainer.innerHTML = '<p class="no-data">Aucun résultat trouvé</p>';
        return;
    }

    const header = document.createElement('p');
    const total = pagination?.totalCount || entries.length;
    header.innerHTML = `<strong>${total}</strong> résultat(s) trouvé(s)`;
    resultsContainer.appendChild(header);

    const table = document.createElement('table');
    table.style.marginTop = '16px';
    table.innerHTML = `<thead><tr><th>DN</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>${entries.map(entry => `<tr>
            <td style="font-family:monospace;font-size:12px">${entry.dn}</td>
            <td>${getIcon(entry)} ${getLabel(entry)}</td>
            <td><button class="btn btn-primary" style="padding:4px 8px;font-size:11px" onclick='showEntryDetails(${JSON.stringify(entry).replace(/'/g, "&#39;")})'>Détails</button></td>
        </tr>`).join('')}</tbody>`;
    resultsContainer.appendChild(table);

    if (pagination && pagination.totalPages > 1) {
        const bar = createPaginationBar(
            pagination,
            (p) => performSearch(p),
            (s) => { paginationState.search.pageSize = s; performSearch(1); }
        );
        resultsContainer.appendChild(bar);
    }
}

function resetSearch() {
    document.getElementById('searchBaseDN').value = 'dc=cnous,dc=fr';
    document.getElementById('searchFilter').value = '(objectClass=*)';
    document.getElementById('searchScope').value = 'sub';
    document.getElementById('searchAttributes').value = '';
    document.getElementById('searchResults').innerHTML = '';
    paginationState.search.page = 1;
    paginationState.search.lastParams = null;
}

// ============ JOURNAUX AVEC PAGINATION ============
async function loadLogs(page = null) {
    if (!currentToken) return;
    if (page !== null) paginationState.logs.page = page;
    const state = paginationState.logs;
    try {
        const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
        const data = await apiRequest(`/logs?${params.toString()}`);
        state.totalCount = data.pagination?.totalCount || 0;
        state.totalPages = data.pagination?.totalPages || 0;
        renderLogs(data.logs, data.pagination);
    } catch (error) {
        showToast('Erreur lors du chargement des logs', 'error');
    }
}

function renderLogs(logs, pagination) {
    const container = document.getElementById('logsContainer');
    container.innerHTML = '';

    if (!logs || logs.length === 0) {
        container.innerHTML = '<p class="no-data">Aucun log trouvé</p>';
        return;
    }

    // Barre de pagination en haut
    if (pagination && pagination.totalPages > 1) {
        const topBar = createPaginationBar(
            pagination,
            (p) => loadLogs(p),
            (s) => { paginationState.logs.pageSize = s; loadLogs(1); }
        );
        container.appendChild(topBar);
    }

    const logsDiv = document.createElement('div');
    logsDiv.style.marginTop = '12px';
    logsDiv.innerHTML = logs.map(log => `
        <div class="log-entry">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                <strong>${log.action}</strong>
                <span class="badge ${log.status === 'success' ? 'badge-success' : 'badge-warning'}">${log.status}</span>
            </div>
            <div style="font-size:12px;color:#64748b">
                Utilisateur: ${log.user_id || 'Système'} | Date: ${new Date(log.created_at).toLocaleString()}
            </div>
            ${log.details ? `<div style="margin-top:5px;font-size:11px;color:#94a3b8">${JSON.stringify(log.details)}</div>` : ''}
        </div>
    `).join('');
    container.appendChild(logsDiv);

    // Barre de pagination en bas
    if (pagination && pagination.totalPages > 1) {
        const bottomBar = createPaginationBar(
            pagination,
            (p) => loadLogs(p),
            (s) => { paginationState.logs.pageSize = s; loadLogs(1); }
        );
        container.appendChild(bottomBar);
    }
}

async function clearLogs() {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    if (!confirm('Êtes-vous sûr de vouloir effacer tous les logs ?\n\nCette action est irréversible.')) return;
    try {
        const data = await apiRequest('/logs/all?confirmation=YES_DELETE_ALL_LOGS', { method: 'DELETE' });
        showToast(data.message || 'Logs effacés avec succès', 'success');
        paginationState.logs.page = 1;
        loadLogs();
    } catch (error) {
        showToast(error.message || 'Erreur lors de l\'effacement des logs', 'error');
    }
}

// ============ DÉTAILS D'ENTRÉE ============
function showEntryDetails(entry) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'entryDetails';
    modal.innerHTML = `<div class="modal-content">
        <div class="modal-header"><h2>Détails de l'entrée</h2><button class="close-btn" onclick="closeModal('entryDetails')">&times;</button></div>
        <div style="margin-bottom:20px"><div style="background:#f1f5f9;padding:10px;border-radius:8px;font-family:monospace;word-break:break-all"><strong>DN:</strong> ${entry.dn}</div></div>
        <div class="attribute-list">${Object.entries(entry.attributes || {}).map(([key, value]) => `
            <div class="attribute-item">
                <span class="attribute-key">${key}</span>
                <span class="attribute-value">${Array.isArray(value) ? value.join(', ') : String(value)}</span>
            </div>`).join('')}
        </div>
        <div class="action-buttons" style="margin-top:20px"><button class="btn btn-secondary" onclick="closeModal('entryDetails')">Fermer</button></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ============ INITIALISATION ============
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (token) verifyToken(token);
    else { updateStatus(false); loadDashboardData(); }
});

async function verifyToken(token) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.ok) {
            const data = await response.json();
            currentToken = token;
            currentUser = data.user;
            updateStatus(true);
            loadDashboardData();
        } else {
            localStorage.removeItem('token');
            updateStatus(false);
        }
    } catch (error) {
        localStorage.removeItem('token');
        updateStatus(false);
    }
}