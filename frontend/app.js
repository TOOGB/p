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

// ============ ARBORESCENCE LDAP (Navigation style explorateur) ============
let expandedNodes = new Set(); // Track expanded nodes

async function loadLDAPTree(parentDN = null, page = 1) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }
    const treeContainer = document.getElementById('ldapTree');
    const refreshBtn = document.getElementById('refreshTreeBtn');
    if (refreshBtn) refreshBtn.disabled = true;
    
    if (!parentDN) {
        // Initial load - show root
        treeContainer.innerHTML = '<div class="loading-text"><div class="spinner"></div>Chargement de la racine...</div>';
        expandedNodes.clear();
    }
    
    try {
        currentParentDN = parentDN;
        currentTreePage = page;
        const params = new URLSearchParams({ page, pageSize: treePageSize });
        if (parentDN) params.append('parentDN', parentDN);
        const data = await apiRequest(`/ldap/children?${params.toString()}`);
        treeData.root = data;
        
        if (!parentDN) {
            renderTreeRoot(data);
        } else {
            // This is for pagination of expanded node
            renderTreeWithPagination(data);
        }
    } catch (error) {
        treeContainer.innerHTML = '<p style="color: #ef4444;">Erreur lors du chargement</p>';
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

function renderTreeRoot(data) {
    const treeContainer = document.getElementById('ldapTree');
    treeContainer.innerHTML = '';
    
    if (!data.entries || data.entries.length === 0) {
        treeContainer.innerHTML = '<p class="no-data">Aucune entrée trouvée</p>';
        return;
    }
    
    const rootList = document.createElement('div');
    rootList.className = 'tree-root-list';
    rootList.id = 'treeRootList';
    
    data.entries.forEach((entry, index) => {
        const nodeElement = createTreeNodeExpandable(entry, 0, `root_${index}`);
        rootList.appendChild(nodeElement);
    });
    
    treeContainer.appendChild(rootList);
}

function renderTreeWithPagination(data) {
    // This function is called when viewing a specific parent DN with pagination
    // For now, we'll just render it as a simple list
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
    entriesContainer.className = 'tree-root-list';
    data.entries.forEach((entry, index) => {
        entriesContainer.appendChild(createTreeNodeExpandable(entry, 0, `paged_${index}`));
    });
    treeContainer.appendChild(entriesContainer);

    const bottomBar = createPaginationBar(
        data.pagination,
        (p) => loadLDAPTree(currentParentDN, p),
        (s) => { treePageSize = s; loadLDAPTree(currentParentDN, 1); }
    );
    treeContainer.appendChild(bottomBar);
}

function createTreeNodeExpandable(entry, level, nodeId) {
    const nodeWrapper = document.createElement('div');
    nodeWrapper.className = 'tree-node-wrapper';
    nodeWrapper.dataset.nodeId = nodeId;
    nodeWrapper.dataset.dn = entry.dn;
    nodeWrapper.dataset.level = level;
    
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.style.paddingLeft = `${level * 20 + 8}px`;
    
    const icon = getIcon(entry);
    const label = getLabel(entry);
    const hasChildren = entry.hasChildren || false;
    const isExpanded = expandedNodes.has(entry.dn);
    
    // Déterminer le type d'entrée
    const objectClasses = entry.attributes?.objectClass;
    const classes = Array.isArray(objectClasses) ? objectClasses : [objectClasses];
    const isUser = classes.includes('inetOrgPerson') || classes.includes('person');
    const isGroup = classes.includes('groupOfNames') || classes.includes('groupOfUniqueNames');
    const supannAliasLogin = entry.attributes?.supannAliasLogin || '';
    
    // Construire le contenu du nœud
    let nodeContent = `
        <div class="tree-node-main">
            <div class="tree-node-left">
                ${hasChildren 
                    ? `<span class="tree-toggle ${isExpanded ? 'expanded' : 'collapsed'}" data-dn="${entry.dn.replace(/"/g, '&quot;')}">
                        ${isExpanded ? '▼' : '▶'}
                       </span>` 
                    : '<span class="tree-toggle-spacer"></span>'}
                <span class="tree-icon">${icon}</span>
                <div class="tree-label">
                    <div class="tree-name">${label}</div>
                    <div class="tree-dn">${entry.dn}</div>
                </div>
            </div>
            <div class="tree-node-actions">
    `;
    
    // Actions spécifiques selon le type
    if (isUser && supannAliasLogin) {
        nodeContent += `
            <button class="tree-action-btn tree-btn-copy" title="Copier le login" 
                onclick='event.stopPropagation(); copySupann("${supannAliasLogin.replace(/"/g, '&quot;')}")'>
                📋 ${supannAliasLogin}
            </button>
        `;
    }
    
    if (isUser) {
        const dnEscaped = entry.dn.replace(/"/g, '&quot;').replace(/`/g, '\\`');
        const nameEscaped = label.replace(/"/g, '&quot;');
        nodeContent += `
            <button class="tree-action-btn tree-btn-groups" title="Gérer les groupes" 
                onclick='event.stopPropagation(); manageUserGroups(\`${dnEscaped}\`, "${nameEscaped}")'>
                👥 Groupes
            </button>
        `;
    }
    
    nodeContent += `
                <button class="tree-action-btn tree-btn-info" title="Voir les détails" 
                    onclick='event.stopPropagation(); showEntryDetailsInline(${JSON.stringify(entry).replace(/'/g, "&#39;")})'>
                    ℹ️
                </button>
            </div>
        </div>
    `;
    
    node.innerHTML = nodeContent;
    
    // Event listeners
    const toggleBtn = node.querySelector('.tree-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await toggleNode(entry.dn, nodeWrapper, toggleBtn);
        });
    }
    
    // Click sur le nœud principal pour le sélectionner
    const mainDiv = node.querySelector('.tree-node-main');
    mainDiv.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tree-action-btn') && 
            !e.target.closest('.tree-action-btn')) {
            selectTreeNode(node, entry);
        }
    });
    
    nodeWrapper.appendChild(node);
    
    // Conteneur pour les enfants
    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = `tree-children ${isExpanded ? '' : 'collapsed'}`;
        childrenContainer.id = `children_${nodeId}`;
        nodeWrapper.appendChild(childrenContainer);
        
        // Si déjà expandé, charger les enfants
        if (isExpanded) {
            loadNodeChildren(entry.dn, childrenContainer, level + 1, nodeId);
        }
    }
    
    treeData[nodeId] = entry;
    return nodeWrapper;
}

async function toggleNode(dn, nodeWrapper, toggleBtn) {
    const childrenContainer = nodeWrapper.querySelector('.tree-children');
    if (!childrenContainer) return;
    
    const isCurrentlyExpanded = expandedNodes.has(dn);
    
    if (isCurrentlyExpanded) {
        // Collapse
        expandedNodes.delete(dn);
        childrenContainer.classList.add('collapsed');
        toggleBtn.textContent = '▶';
        toggleBtn.classList.remove('expanded');
        toggleBtn.classList.add('collapsed');
    } else {
        // Expand
        expandedNodes.add(dn);
        childrenContainer.classList.remove('collapsed');
        toggleBtn.textContent = '▼';
        toggleBtn.classList.remove('collapsed');
        toggleBtn.classList.add('expanded');
        
        // Charger les enfants si pas déjà chargé
        if (!childrenContainer.hasChildNodes() || childrenContainer.innerHTML.trim() === '') {
            const level = parseInt(nodeWrapper.dataset.level);
            const nodeId = nodeWrapper.dataset.nodeId;
            await loadNodeChildren(dn, childrenContainer, level + 1, nodeId);
        }
    }
}

async function loadNodeChildren(parentDN, container, level, parentNodeId, page = 1) {
    container.innerHTML = '<div class="tree-loading"><div class="spinner"></div>Chargement...</div>';
    
    try {
        const pageSize = 50; // Children per page
        const params = new URLSearchParams({ 
            parentDN, 
            page, 
            pageSize
        });
        const data = await apiRequest(`/ldap/children?${params.toString()}`);
        
        container.innerHTML = '';
        
        if (!data.entries || data.entries.length === 0) {
            container.innerHTML = '<div class="tree-no-children">Aucun enfant</div>';
            return;
        }
        
        // Add pagination info at top if multiple pages
        if (data.pagination && data.pagination.totalPages > 1) {
            const topPagination = createTreePaginationBar(
                data.pagination, 
                parentDN, 
                container, 
                level, 
                parentNodeId
            );
            container.appendChild(topPagination);
        }
        
        // Add all child nodes
        data.entries.forEach((child, idx) => {
            const childNode = createTreeNodeExpandable(child, level, `${parentNodeId}_${idx}`);
            container.appendChild(childNode);
        });
        
        // Add pagination at bottom if multiple pages
        if (data.pagination && data.pagination.totalPages > 1) {
            const bottomPagination = createTreePaginationBar(
                data.pagination, 
                parentDN, 
                container, 
                level, 
                parentNodeId
            );
            container.appendChild(bottomPagination);
        }
        
    } catch (error) {
        console.error('Error loading children:', error);
        container.innerHTML = '<div class="tree-error">Erreur de chargement</div>';
    }
}

function createTreePaginationBar(pagination, parentDN, container, level, parentNodeId) {
    const bar = document.createElement('div');
    bar.className = 'tree-pagination';
    
    const info = document.createElement('div');
    info.className = 'tree-pagination-info';
    info.innerHTML = `
        <span class="tree-pagination-text">
            ${pagination.startIndex + 1}–${pagination.endIndex} sur ${pagination.totalCount}
            &nbsp;·&nbsp; Page ${pagination.currentPage}/${pagination.totalPages}
        </span>
    `;
    
    const controls = document.createElement('div');
    controls.className = 'tree-pagination-controls';
    
    // First page button
    const firstBtn = document.createElement('button');
    firstBtn.className = 'tree-page-btn';
    firstBtn.innerHTML = '«';
    firstBtn.title = 'Première page';
    firstBtn.disabled = !pagination.hasPreviousPage;
    firstBtn.onclick = (e) => {
        e.stopPropagation();
        loadNodeChildren(parentDN, container, level, parentNodeId, 1);
    };
    controls.appendChild(firstBtn);
    
    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'tree-page-btn';
    prevBtn.innerHTML = '‹';
    prevBtn.title = 'Page précédente';
    prevBtn.disabled = !pagination.hasPreviousPage;
    prevBtn.onclick = (e) => {
        e.stopPropagation();
        loadNodeChildren(parentDN, container, level, parentNodeId, pagination.currentPage - 1);
    };
    controls.appendChild(prevBtn);
    
    // Page numbers (simplified for tree view)
    const pagesDiv = document.createElement('div');
    pagesDiv.className = 'tree-page-numbers';
    
    const totalPages = pagination.totalPages;
    const currentPage = pagination.currentPage;
    let pages = [];
    
    if (totalPages <= 5) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages = [1];
        if (currentPage > 3) pages.push('...');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
            pages.push(i);
        }
        if (currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
    }
    
    pages.forEach(p => {
        if (p === '...') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'tree-page-ellipsis';
            ellipsis.textContent = '…';
            pagesDiv.appendChild(ellipsis);
        } else {
            const btn = document.createElement('button');
            btn.className = 'tree-page-btn' + (p === currentPage ? ' tree-page-active' : '');
            btn.textContent = p;
            btn.onclick = (e) => {
                e.stopPropagation();
                loadNodeChildren(parentDN, container, level, parentNodeId, p);
            };
            pagesDiv.appendChild(btn);
        }
    });
    controls.appendChild(pagesDiv);
    
    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'tree-page-btn';
    nextBtn.innerHTML = '›';
    nextBtn.title = 'Page suivante';
    nextBtn.disabled = !pagination.hasNextPage;
    nextBtn.onclick = (e) => {
        e.stopPropagation();
        loadNodeChildren(parentDN, container, level, parentNodeId, pagination.currentPage + 1);
    };
    controls.appendChild(nextBtn);
    
    // Last page button
    const lastBtn = document.createElement('button');
    lastBtn.className = 'tree-page-btn';
    lastBtn.innerHTML = '»';
    lastBtn.title = 'Dernière page';
    lastBtn.disabled = !pagination.hasNextPage;
    lastBtn.onclick = (e) => {
        e.stopPropagation();
        loadNodeChildren(parentDN, container, level, parentNodeId, pagination.totalPages);
    };
    controls.appendChild(lastBtn);
    
    bar.appendChild(info);
    bar.appendChild(controls);
    
    return bar;
}

function selectTreeNode(nodeElement, entry) {
    // Désélectionner tous les nœuds
    document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
    nodeElement.classList.add('selected');
    
    // Optionnel: afficher les détails dans un panneau latéral
    // showEntryDetails(entry);
}

function showEntryDetailsInline(entry) {
    showEntryDetails(entry);
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

function filterTree() {
    const filter = document.getElementById('treeFilter').value.toLowerCase();
    document.querySelectorAll('.tree-node-wrapper').forEach(wrapper => {
        const text = wrapper.textContent.toLowerCase();
        wrapper.style.display = text.includes(filter) ? 'block' : 'none';
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
    tableWrapper.innerHTML = '';

    if (!users || users.length === 0) {
        tableWrapper.innerHTML = '<p class="no-data">Aucun utilisateur trouvé</p>';
    } else {
        const table = document.createElement('table');
        table.innerHTML = `<thead><tr><th>Nom</th><th>Email</th><th>UID</th><th>Login (supann)</th><th>Actions</th></tr></thead>
            <tbody>${users.map(user => {
                const uid = user.attributes?.uid || user.dn.match(/uid=([^,]+)/)?.[1] || 'N/A';
                const cn = user.attributes?.cn || 'N/A';
                const mail = user.attributes?.mail || 'N/A';
                const supann = user.attributes?.supannAliasLogin || '';
                const dn = user.dn;
                const dnEscaped = dn.replace(/`/g, '\\`').replace(/'/g, "\\'");
                const supannEscaped = supann.replace(/`/g, '\\`').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `<tr>
                    <td>${cn}</td>
                    <td>${mail}</td>
                    <td>${uid}</td>
                    <td>
                        ${supann
                            ? `<span class="supann-login">${supann}</span>
                               <button class="btn-icon" title="Copier le login" onclick='copySupann(\`${supannEscaped}\`)'>📋</button>`
                            : '<span class="text-muted">—</span>'}
                    </td>
                    <td class="actions-cell">
                        <button class="btn btn-group-add" title="Gérer les groupes" onclick='manageUserGroups(\`${dnEscaped}\`, "${cn.replace(/"/g, '&quot;')}")'>👥 Groupes</button>
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

// ============ COPIE SUPANN ALIAS LOGIN ============
function copySupann(value) {
    if (!value) { showToast('Aucun supannAliasLogin disponible', 'error'); return; }
    navigator.clipboard.writeText(value).then(() => {
        showToast(`Login copié : ${value}`, 'success');
    }).catch(() => {
        // Fallback pour les navigateurs sans clipboard API
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast(`Login copié : ${value}`, 'success');
    });
}

// ============ GESTION DES GROUPES D'UN UTILISATEUR ============
async function manageUserGroups(userDN, userName) {
    if (!currentToken) { showToast('Veuillez vous connecter d\'abord', 'error'); return; }

    // Supprimer toute modale existante
    const existing = document.getElementById('manageGroupsModal');
    if (existing) existing.remove();

    // Créer la modale avec un état de chargement
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'manageGroupsModal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:700px">
            <div class="modal-header">
                <h2>👥 Groupes — ${userName}</h2>
                <button class="close-btn" onclick="document.getElementById('manageGroupsModal').remove()">&times;</button>
            </div>
            <div class="groups-manager">
                <div class="groups-columns">
                    <div class="groups-col">
                        <h3 class="groups-col-title">✅ Groupes actuels</h3>
                        <div id="currentGroupsList" class="groups-list"><div class="loading-text"><div class="spinner"></div>Chargement...</div></div>
                    </div>
                    <div class="groups-col">
                        <h3 class="groups-col-title">➕ Ajouter à un groupe</h3>
                        <input type="text" id="groupSearchInput" placeholder="Rechercher un groupe…" oninput="filterAvailableGroups()" class="groups-search-input">
                        <div id="availableGroupsList" class="groups-list"><div class="loading-text"><div class="spinner"></div>Chargement...</div></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Charger en parallèle : groupes actuels de l'utilisateur + tous les groupes
    try {
        const [userGroupsData, allGroupsData] = await Promise.all([
            apiRequest(`/ldap/users/${encodeURIComponent(userDN)}/groups`),
            apiRequest('/ldap/groups/search?pageSize=200')
        ]);

        const userGroups = userGroupsData.groups || [];
        const allGroups = allGroupsData.groups || [];
        const userGroupDNs = new Set(userGroups.map(g => g.dn));

        // Stocker pour le filtre
        modal._userDN = userDN;
        modal._userGroups = userGroups;
        modal._allGroups = allGroups;
        modal._userGroupDNs = userGroupDNs;

        renderCurrentGroups(userGroups, userDN, userGroupDNs, allGroups);
        renderAvailableGroups(allGroups, userGroupDNs, userDN, userGroups);

    } catch (error) {
        console.error('Error loading groups:', error);
        document.getElementById('currentGroupsList').innerHTML = '<p class="text-muted">Erreur de chargement</p>';
        document.getElementById('availableGroupsList').innerHTML = '<p class="text-muted">Erreur de chargement</p>';
    }
}

function renderCurrentGroups(userGroups, userDN, userGroupDNs, allGroups) {
    const container = document.getElementById('currentGroupsList');
    if (!container) return;

    if (userGroups.length === 0) {
        container.innerHTML = '<p class="text-muted groups-empty">Aucun groupe</p>';
        return;
    }

    container.innerHTML = '';
    userGroups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'group-item group-item-current';
        item.dataset.dn = group.dn;
        const cn = group.attributes?.cn || group.dn.match(/cn=([^,]+)/)?.[1] || group.dn;
        const desc = group.attributes?.description || '';
        item.innerHTML = `
            <div class="group-item-info">
                <span class="group-item-name">👥 ${cn}</span>
                ${desc ? `<span class="group-item-desc">${desc}</span>` : ''}
            </div>
            <button class="btn btn-remove-group" title="Retirer du groupe"
                onclick='removeFromGroup(\`${group.dn.replace(/`/g, '\\`')}\`, \`${userDN.replace(/`/g, '\\`')}\`, \`${cn.replace(/`/g, '\\`')}\`)'>
                ✕ Retirer
            </button>
        `;
        container.appendChild(item);
    });
}

function renderAvailableGroups(allGroups, userGroupDNs, userDN, userGroups) {
    const container = document.getElementById('availableGroupsList');
    if (!container) return;
    const filter = document.getElementById('groupSearchInput')?.value?.toLowerCase() || '';

    const available = allGroups.filter(g => {
        if (userGroupDNs.has(g.dn)) return false;
        if (filter) {
            const cn = (g.attributes?.cn || '').toLowerCase();
            const desc = (g.attributes?.description || '').toLowerCase();
            return cn.includes(filter) || desc.includes(filter);
        }
        return true;
    });

    if (available.length === 0) {
        container.innerHTML = '<p class="text-muted groups-empty">Aucun groupe disponible</p>';
        return;
    }

    container.innerHTML = '';
    available.forEach(group => {
        const item = document.createElement('div');
        item.className = 'group-item group-item-available';
        const cn = group.attributes?.cn || group.dn.match(/cn=([^,]+)/)?.[1] || group.dn;
        const desc = group.attributes?.description || '';
        item.innerHTML = `
            <div class="group-item-info">
                <span class="group-item-name">👥 ${cn}</span>
                ${desc ? `<span class="group-item-desc">${desc}</span>` : ''}
            </div>
            <button class="btn btn-add-group" title="Ajouter au groupe"
                onclick='addToGroup(\`${group.dn.replace(/`/g, '\\`')}\`, \`${userDN.replace(/`/g, '\\`')}\`, \`${cn.replace(/`/g, '\\`')}\`)'>
                + Ajouter
            </button>
        `;
        container.appendChild(item);
    });
}

function filterAvailableGroups() {
    const modal = document.getElementById('manageGroupsModal');
    if (!modal || !modal._allGroups) return;
    renderAvailableGroups(modal._allGroups, modal._userGroupDNs, modal._userDN, modal._userGroups);
}

async function addToGroup(groupDN, userDN, groupName) {
    try {
        await apiRequest(`/ldap/groups/${encodeURIComponent(groupDN)}/members`, {
            method: 'POST',
            body: JSON.stringify({ memberDN: userDN })
        });
        showToast(`Ajouté au groupe « ${groupName} »`, 'success');
        // Rafraîchir la modale
        const modal = document.getElementById('manageGroupsModal');
        if (modal) {
            modal._userGroupDNs.add(groupDN);
            modal._userGroups.push({ dn: groupDN, attributes: { cn: groupName } });
            renderCurrentGroups(modal._userGroups, modal._userDN, modal._userGroupDNs, modal._allGroups);
            renderAvailableGroups(modal._allGroups, modal._userGroupDNs, modal._userDN, modal._userGroups);
        }
    } catch (error) {
        showToast(error.message || 'Erreur lors de l\'ajout au groupe', 'error');
    }
}

async function removeFromGroup(groupDN, userDN, groupName) {
    try {
        await apiRequest(`/ldap/groups/${encodeURIComponent(groupDN)}/members`, {
            method: 'DELETE',
            body: JSON.stringify({ memberDN: userDN })
        });
        showToast(`Retiré du groupe « ${groupName} »`, 'success');
        // Rafraîchir la modale
        const modal = document.getElementById('manageGroupsModal');
        if (modal) {
            modal._userGroupDNs.delete(groupDN);
            modal._userGroups = modal._userGroups.filter(g => g.dn !== groupDN);
            renderCurrentGroups(modal._userGroups, modal._userDN, modal._userGroupDNs, modal._allGroups);
            renderAvailableGroups(modal._allGroups, modal._userGroupDNs, modal._userDN, modal._userGroups);
        }
    } catch (error) {
        showToast(error.message || 'Erreur lors du retrait du groupe', 'error');
    }
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