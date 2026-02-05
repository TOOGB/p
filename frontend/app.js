// ============ VARIABLES GLOBALES ============
let currentToken = null;
let currentUser = null;
let treeData = {};
let currentTreePage = 1;
let treePageSize = 50;
let currentParentDN = null;
const API_BASE_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin;

console.log('🔧 Configuration:');
console.log('🔧 API_BASE_URL:', API_BASE_URL);

// ============ FONCTIONS D'AUTHENTIFICATION ============
function toggleAuth() {
    if (currentToken) {
        logout();
    } else {
        showModal('loginModal');
    }
}

async function performLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showToast('Veuillez remplir tous les champs', 'error');
        return;
    }

    const loginEndpoint = `${API_BASE_URL}/api/auth/login`;
    console.log('🔐 Connexion vers:', loginEndpoint);

    try {
        const response = await fetch(loginEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Erreur ${response.status}`;
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {}
            showToast(errorMessage, 'error');
            return;
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
        console.error('🔥 Erreur de fetch:', error);
        showToast('Impossible de contacter le serveur: ' + error.message, 'error');
    }
}

function logout() {
    currentToken = null;
    currentUser = null;
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
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers
    };

    if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
    }

    let fullEndpoint = endpoint.startsWith('/api') ? endpoint : '/api' + endpoint;

    console.log(`📡 API Request: ${API_BASE_URL}${fullEndpoint}`);

    try {
        const response = await fetch(`${API_BASE_URL}${fullEndpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            logout();
            showToast('Session expirée, veuillez vous reconnecter', 'error');
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        return data;
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
        case 'dashboard':
            loadDashboardData();
            break;
        case 'browse':
            currentTreePage = 1;
            currentParentDN = null;
            loadLDAPTree();
            break;
        case 'users':
            loadUsers();
            break;
        case 'groups':
            loadGroups();
            break;
        case 'logs':
            loadLogs();
            break;
    }
}

function showModal(id) {
    if (!currentToken && id !== 'loginModal') {
        showToast('Veuillez vous connecter d\'abord', 'error');
        showModal('loginModal');
        return;
    }
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = type === 'error' ? '#ef4444' : 
                           type === 'success' ? '#10b981' : 
                           '#3b82f6';
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ============ FONCTIONS DU DASHBOARD ============
async function loadDashboardData() {
    if (!currentToken) {
        document.getElementById('statsGrid').innerHTML = '<p>Connectez-vous pour voir les statistiques</p>';
        document.getElementById('recentActivity').innerHTML = '<p>Connectez-vous pour voir l\'activité</p>';
        return;
    }

    try {
        const stats = await apiRequest('/stats');
        renderStats(stats);

        const logs = await apiRequest('/logs?limit=5');
        renderRecentActivity(logs.logs);
    } catch (error) {
        console.error('❌ Dashboard load error:', error);
        document.getElementById('statsGrid').innerHTML = '<p>Erreur de chargement</p>';
    }
}

function renderStats(stats) {
    const statsGrid = document.getElementById('statsGrid');
    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${stats.users || 0}</div>
            <div class="stat-label">Utilisateurs</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
            <div class="stat-value">${stats.groups || 0}</div>
            <div class="stat-label">Groupes</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
            <div class="stat-value">${stats.ous || 0}</div>
            <div class="stat-label">Unités org.</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);">
            <div class="stat-value">${stats.totalEntries || 0}</div>
            <div class="stat-label">Entrées LDAP</div>
        </div>
    `;
}

function renderRecentActivity(logs) {
    const container = document.getElementById('recentActivity');
    if (!logs || logs.length === 0) {
        container.innerHTML = '<p>Aucune activité récente</p>';
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Action</th>
                <th>Utilisateur</th>
                <th>Date</th>
                <th>Statut</th>
            </tr>
        </thead>
        <tbody>
            ${logs.map(log => `
                <tr>
                    <td>${log.action}</td>
                    <td>${log.user_id || 'Système'}</td>
                    <td>${new Date(log.created_at).toLocaleString()}</td>
                    <td><span class="badge ${log.status === 'success' ? 'badge-success' : 'badge-warning'}">${log.status}</span></td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
}

// ============ FONCTIONS LDAP TREE AVEC PAGINATION ============

async function loadLDAPTree(parentDN = null, page = 1) {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    const treeContainer = document.getElementById('ldapTree');
    const refreshBtn = document.getElementById('refreshTreeBtn');
    
    if (refreshBtn) refreshBtn.disabled = true;
    
    treeContainer.innerHTML = '<div class="loading-text"><div class="spinner"></div>Chargement de l\'arborescence...</div>';

    try {
        currentParentDN = parentDN;
        currentTreePage = page;
        
        const params = new URLSearchParams({
            page: page,
            pageSize: treePageSize
        });
        
        if (parentDN) {
            params.append('parentDN', parentDN);
        }
        
        const data = await apiRequest(`/ldap/children?${params.toString()}`);
        console.log('📊 Données de l\'arborescence:', data);
        console.log('📊 Pagination détaillée:', {
            currentPage: data.pagination?.currentPage,
            totalPages: data.pagination?.totalPages,
            totalCount: data.pagination?.totalCount,
            hasNextPage: data.pagination?.hasNextPage,
            hasPreviousPage: data.pagination?.hasPreviousPage,
            entriesCount: data.entries?.length
        });
        
        treeData.root = data;
        renderTreeWithPagination(data);
        
        const contextMsg = currentParentDN ? 'enfants chargés' : 'entrées racine chargées';
        showToast(`${data.entries.length} ${contextMsg} (page ${page}/${data.pagination.totalPages})`, 'success');
    } catch (error) {
        console.error('Tree load error:', error);
        treeContainer.innerHTML = '<p style="color: #ef4444;">Erreur lors du chargement de l\'arborescence</p>';
        showToast('Erreur lors du chargement de l\'arborescence', 'error');
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

function renderTreeWithPagination(data) {
    const treeContainer = document.getElementById('ldapTree');
    treeContainer.innerHTML = '';
    
    console.log('📊 Pagination data:', data.pagination);
    
    // Afficher le breadcrumb si on n'est pas à la racine
    if (currentParentDN) {
        const breadcrumb = document.createElement('div');
        breadcrumb.style.cssText = 'background: #f1f5f9; padding: 10px; border-radius: 8px; margin-bottom: 12px; font-family: monospace; font-size: 13px; display: flex; align-items: center; gap: 8px;';
        breadcrumb.innerHTML = `
            <strong>📍 Niveau actuel :</strong>
            <span style="color: #475569;">${currentParentDN}</span>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-left: auto;" onclick="loadLDAPTree(null, 1)">
                ← Retour à la racine
            </button>
        `;
        treeContainer.appendChild(breadcrumb);
    }
    
    // Afficher les informations de pagination en haut
    const paginationInfo = document.createElement('div');
    paginationInfo.style.cssText = 'background: #e0e7ff; padding: 12px; border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;';
    
    const infoDiv = document.createElement('div');
    const levelText = currentParentDN ? 'à ce niveau' : 'à la racine';
    infoDiv.innerHTML = `
        <strong>${data.pagination.totalCount}</strong> entrée(s) ${levelText} | 
        Page <strong>${data.pagination.currentPage}</strong> sur <strong>${data.pagination.totalPages}</strong> |
        Affichage de <strong>${data.pagination.startIndex + 1}</strong> à <strong>${data.pagination.endIndex}</strong>
    `;
    paginationInfo.appendChild(infoDiv);
    
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    
    // Bouton Page précédente
    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-secondary';
    prevBtn.style.padding = '6px 12px';
    prevBtn.style.fontSize = '12px';
    prevBtn.textContent = '← Précédent';
    prevBtn.disabled = !data.pagination.hasPreviousPage;
    prevBtn.onclick = () => loadLDAPTree(currentParentDN, currentTreePage - 1);
    controls.appendChild(prevBtn);
    
    // Sélecteur de taille de page
    const pageSizeSelect = document.createElement('select');
    pageSizeSelect.style.cssText = 'padding: 6px; border-radius: 4px; border: 1px solid #ccc;';
    pageSizeSelect.innerHTML = `
        <option value="25" ${treePageSize === 25 ? 'selected' : ''}>25/page</option>
        <option value="50" ${treePageSize === 50 ? 'selected' : ''}>50/page</option>
        <option value="100" ${treePageSize === 100 ? 'selected' : ''}>100/page</option>
        <option value="200" ${treePageSize === 200 ? 'selected' : ''}>200/page</option>
    `;
    pageSizeSelect.onchange = (e) => {
        treePageSize = parseInt(e.target.value);
        loadLDAPTree(currentParentDN, 1);
    };
    controls.appendChild(pageSizeSelect);
    
    // Bouton Page suivante
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-secondary';
    nextBtn.style.padding = '6px 12px';
    nextBtn.style.fontSize = '12px';
    nextBtn.textContent = 'Suivant →';
    nextBtn.disabled = !data.pagination.hasNextPage;
    nextBtn.onclick = () => loadLDAPTree(currentParentDN, currentTreePage + 1);
    controls.appendChild(nextBtn);
    
    paginationInfo.appendChild(controls);
    treeContainer.appendChild(paginationInfo);
    
    // Afficher les entrées
    if (!data.entries || data.entries.length === 0) {
        const noData = document.createElement('p');
        noData.className = 'no-data';
        noData.textContent = 'Aucune entrée trouvée';
        treeContainer.appendChild(noData);
        return;
    }
    
    const entriesContainer = document.createElement('div');
    data.entries.forEach((entry, index) => {
        const nodeWrapper = createTreeNode(entry, index, 0);
        entriesContainer.appendChild(nodeWrapper);
    });
    
    treeContainer.appendChild(entriesContainer);
    
    // Afficher les contrôles de pagination en bas aussi
    const bottomPaginationInfo = document.createElement('div');
    bottomPaginationInfo.style.cssText = 'background: #e0e7ff; padding: 12px; border-radius: 8px; margin-top: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;';
    
    const bottomInfoDiv = document.createElement('div');
    const bottomLevelText = currentParentDN ? 'à ce niveau' : 'à la racine';
    bottomInfoDiv.innerHTML = `
        <strong>${data.pagination.totalCount}</strong> entrée(s) ${bottomLevelText} | 
        Page <strong>${data.pagination.currentPage}</strong> sur <strong>${data.pagination.totalPages}</strong> |
        Affichage de <strong>${data.pagination.startIndex + 1}</strong> à <strong>${data.pagination.endIndex}</strong>
    `;
    bottomPaginationInfo.appendChild(bottomInfoDiv);
    
    const bottomControls = document.createElement('div');
    bottomControls.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    
    // Bouton Page précédente (bas)
    if (data.pagination.hasPreviousPage) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-secondary';
        prevBtn.style.padding = '6px 12px';
        prevBtn.style.fontSize = '12px';
        prevBtn.textContent = '← Précédent';
        prevBtn.onclick = () => loadLDAPTree(currentParentDN, currentTreePage - 1);
        bottomControls.appendChild(prevBtn);
    }
    
    // Sélecteur de taille de page (bas)
    const bottomPageSizeSelect = document.createElement('select');
    bottomPageSizeSelect.style.cssText = 'padding: 6px; border-radius: 4px; border: 1px solid #ccc;';
    bottomPageSizeSelect.innerHTML = `
        <option value="25" ${treePageSize === 25 ? 'selected' : ''}>25/page</option>
        <option value="50" ${treePageSize === 50 ? 'selected' : ''}>50/page</option>
        <option value="100" ${treePageSize === 100 ? 'selected' : ''}>100/page</option>
        <option value="200" ${treePageSize === 200 ? 'selected' : ''}>200/page</option>
    `;
    bottomPageSizeSelect.onchange = (e) => {
        treePageSize = parseInt(e.target.value);
        loadLDAPTree(currentParentDN, 1);
    };
    bottomControls.appendChild(bottomPageSizeSelect);
    
    // Bouton Page suivante (bas)
    if (data.pagination.hasNextPage) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-secondary';
        nextBtn.style.padding = '6px 12px';
        nextBtn.style.fontSize = '12px';
        nextBtn.textContent = 'Suivant →';
        nextBtn.onclick = () => loadLDAPTree(currentParentDN, currentTreePage + 1);
        bottomControls.appendChild(nextBtn);
    }
    
    bottomPaginationInfo.innerHTML = bottomInfo;
    bottomPaginationInfo.appendChild(bottomControls);
    treeContainer.appendChild(bottomPaginationInfo);
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
    
    let childCountBadge = '';
    if (hasChildren && childCount > 0) {
        const badgeColor = childCount > 100 ? '#ef4444' : childCount > 50 ? '#f59e0b' : '#3b82f6';
        childCountBadge = `<span style="background: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px; font-weight: 600;">${childCount} enfant${childCount > 1 ? 's' : ''}</span>`;
    } else if (hasChildren) {
        childCountBadge = `<span style="background: #64748b; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px;">...</span>`;
    }
    
    node.innerHTML = `
        ${hasChildren ? 
            `<span class="tree-toggle collapsed" onclick="toggleLazyNode('${nodeId}', '${entry.dn}', this)">▶</span>` : 
            '<span class="tree-toggle"></span>'
        }
        <span class="tree-icon">${icon}</span>
        <div class="tree-label">
            <div><strong>${label}</strong>${childCountBadge}</div>
            <div class="tree-dn">${entry.dn}</div>
        </div>
        ${hasChildren ? '<span class="tree-loading" style="display:none;">⌛</span>' : ''}
    `;
    
    node.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tree-toggle') && 
            !e.target.classList.contains('tree-loading')) {
            selectNode(node, entry);
        }
    });
    
    nodeWrapper.appendChild(node);
    
    // Ajouter un conteneur pour les enfants
    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children collapsed';
        childrenContainer.id = `children_${nodeId}`;
        nodeWrapper.appendChild(childrenContainer);
    }
    
    treeData[nodeId] = entry;
    return nodeWrapper;
}

let loadedNodes = new Set();

async function toggleLazyNode(nodeId, dn, toggleBtn) {
    const nodeWrapper = toggleBtn.closest('.tree-node-wrapper');
    const childrenContainer = nodeWrapper.querySelector('.tree-children');
    const loadingSpan = nodeWrapper.querySelector('.tree-loading');
    
    if (childrenContainer.classList.contains('collapsed')) {
        // Si les enfants ne sont pas encore chargés
        if (!childrenContainer.hasChildNodes() || childrenContainer.innerHTML.trim() === '') {
            toggleBtn.style.display = 'none';
            if (loadingSpan) loadingSpan.style.display = 'inline';
            
            try {
                const params = new URLSearchParams({
                    parentDN: dn,
                    page: 1,
                    pageSize: 100 // Charger plus d'enfants directs
                });
                
                const data = await apiRequest(`/ldap/children?${params.toString()}`);
                
                if (data.success && data.entries && data.entries.length > 0) {
                    childrenContainer.innerHTML = '';
                    
                    // Ajouter info de pagination si nécessaire
                    if (data.pagination.totalPages > 1) {
                        const paginationInfo = document.createElement('div');
                        paginationInfo.style.cssText = 'background: #f0f0f0; padding: 6px; margin: 4px 0; border-radius: 4px; font-size: 11px;';
                        paginationInfo.textContent = `${data.pagination.totalCount} enfants (page 1/${data.pagination.totalPages})`;
                        childrenContainer.appendChild(paginationInfo);
                    }
                    
                    // Ajouter les nœuds enfants
                    const level = parseInt(nodeId.split('_').length - 1);
                    data.entries.forEach((child, idx) => {
                        const childNode = createTreeNode(child, idx, level + 1, nodeId);
                        childrenContainer.appendChild(childNode);
                    });
                    
                    loadedNodes.add(dn);
                } else {
                    childrenContainer.innerHTML = '<p class="no-children" style="padding: 8px; color: #64748b; font-size: 12px;">Aucun enfant</p>';
                }
            } catch (error) {
                console.error('Erreur lors du chargement des enfants:', error);
                childrenContainer.innerHTML = '<p class="error-children" style="padding: 8px; color: #ef4444; font-size: 12px;">Erreur de chargement</p>';
            }
            
            if (loadingSpan) loadingSpan.style.display = 'none';
            toggleBtn.style.display = 'inline';
        }
        
        // Développer le nœud
        childrenContainer.classList.remove('collapsed');
        toggleBtn.textContent = '▼';
    } else {
        // Replier le nœud
        childrenContainer.classList.add('collapsed');
        toggleBtn.textContent = '▶';
    }
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
    return entry.attributes?.cn || 
           entry.attributes?.ou || 
           entry.attributes?.dc || 
           entry.attributes?.uid || 
           entry.dn.split(',')[0].split('=')[1];
}

function selectNode(node, entry) {
    document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
    node.classList.add('selected');
    showEntryDetails(entry);
}

function filterTree() {
    const filter = document.getElementById('treeFilter').value.toLowerCase();
    const nodes = document.querySelectorAll('.tree-node');
    
    nodes.forEach(node => {
        const text = node.textContent.toLowerCase();
        const wrapper = node.parentElement;
        
        if (text.includes(filter)) {
            wrapper.style.display = 'block';
        } else {
            wrapper.style.display = 'none';
        }
    });
}

// ============ GESTION DES UTILISATEURS ============
async function loadUsers() {
    if (!currentToken) return;

    try {
        const data = await apiRequest('/ldap/users/search');
        renderUsers(data.users || data.entries);
    } catch (error) {
        console.error('Users load error:', error);
        showToast('Erreur lors du chargement des utilisateurs', 'error');
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Aucun utilisateur trouvé</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => {
        const uid = user.attributes?.uid || user.dn.match(/uid=([^,]+)/)?.[1] || 'N/A';
        const cn = user.attributes?.cn || 'N/A';
        const mail = user.attributes?.mail || 'N/A';
        const dn = user.dn || user.attributes?.dn;
        
        return `
            <tr>
                <td>${cn}</td>
                <td>${mail}</td>
                <td>${uid}</td>
                <td><span class="badge badge-success">Actif</span></td>
                <td>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick='editUser(\`${dn}\`)'>Éditer</button>
                    <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick='deleteUser(\`${dn}\`)'>Supprimer</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function searchUsers() {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    const query = document.getElementById('userSearch').value;
    
    try {
        const endpoint = query ? `/ldap/users/search?query=${encodeURIComponent(query)}` : '/ldap/users/search';
        const data = await apiRequest(endpoint);
        renderUsers(data.users || data.entries);
        showToast(`Recherche effectuée : ${data.count} résultat(s)`, 'success');
    } catch (error) {
        console.error('User search error:', error);
        showToast('Erreur lors de la recherche d\'utilisateurs', 'error');
    }
}

async function createUser() {
    const cn = document.getElementById('newUserCn').value;
    const sn = document.getElementById('newUserSn').value;
    const uid = document.getElementById('newUserUid').value;
    const mail = document.getElementById('newUserMail').value;
    const password = document.getElementById('newUserPassword').value;
    const ou = document.getElementById('newUserOu').value;

    if (!cn || !sn || !uid || !mail || !password) {
        showToast('Veuillez remplir tous les champs obligatoires', 'error');
        return;
    }

    try {
        await apiRequest('/ldap/users', {
            method: 'POST',
            body: JSON.stringify({ cn, sn, uid, mail, userPassword: password, ou })
        });

        showToast('Utilisateur créé avec succès', 'success');
        closeModal('addUserModal');
        loadUsers();
        
        // Réinitialiser le formulaire
        document.getElementById('newUserCn').value = '';
        document.getElementById('newUserSn').value = '';
        document.getElementById('newUserUid').value = '';
        document.getElementById('newUserMail').value = '';
        document.getElementById('newUserPassword').value = '';
    } catch (error) {
        showToast(error.message || 'Erreur lors de la création', 'error');
    }
}

async function editUser(dn) {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    try {
        const data = await apiRequest(`/ldap/users/${encodeURIComponent(dn)}`);
        const user = data.user || data;
        
        const uid = user.attributes?.uid || dn.match(/uid=([^,]+)/)?.[1] || 'unknown';
        
        const modalContent = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Éditer l'utilisateur</h2>
                    <button class="close-btn" onclick="closeModal('editUserModal')">&times;</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Nom complet (CN)*</label>
                        <input type="text" id="editUserCn" value="${user.attributes?.cn || ''}" placeholder="Jean Dupont">
                    </div>
                    <div class="form-group">
                        <label>Nom de famille (SN)*</label>
                        <input type="text" id="editUserSn" value="${user.attributes?.sn || ''}" placeholder="Dupont">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Email*</label>
                        <input type="email" id="editUserMail" value="${user.attributes?.mail || ''}" placeholder="jean.dupont@cnous.fr">
                    </div>
                    <div class="form-group">
                        <label>Unité organisationnelle</label>
                        <input type="text" id="editUserOu" value="${dn.match(/ou=([^,]+)/)?.[1] || 'people'}" placeholder="people">
                    </div>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-success" onclick='updateUser("${uid}", \`${dn}\`)'>Mettre à jour</button>
                    <button class="btn btn-secondary" onclick="closeModal('editUserModal')">Annuler</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'editUserModal';
        modal.innerHTML = modalContent;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    } catch (error) {
        console.error('Error loading user:', error);
        showToast('Erreur lors du chargement des informations utilisateur', 'error');
    }
}

async function updateUser(uid, oldDn) {
    const cn = document.getElementById('editUserCn').value;
    const sn = document.getElementById('editUserSn').value;
    const mail = document.getElementById('editUserMail').value;
    const ou = document.getElementById('editUserOu').value;

    if (!cn || !sn || !mail) {
        showToast('Veuillez remplir tous les champs obligatoires', 'error');
        return;
    }

    try {
        await apiRequest(`/ldap/users/${uid}`, {
            method: 'PUT',
            body: JSON.stringify({ cn, sn, mail, ou })
        });

        showToast('Utilisateur mis à jour avec succès', 'success');
        
        const modal = document.getElementById('editUserModal');
        if (modal) modal.remove();
        
        loadUsers();
    } catch (error) {
        showToast(error.message || 'Erreur lors de la mise à jour', 'error');
    }
}

async function deleteUser(dn) {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    const uid = dn.match(/uid=([^,]+)/)?.[1];
    const ou = dn.match(/ou=([^,]+)/)?.[1];
    
    if (!uid) {
        showToast('Impossible d\'extraire l\'UID du DN', 'error');
        return;
    }

    const confirmDelete = confirm(`Êtes-vous sûr de vouloir supprimer l'utilisateur "${uid}" ?\n\nCette action est irréversible.`);
    
    if (!confirmDelete) return;

    try {
        const queryParams = ou ? `?ou=${encodeURIComponent(ou)}` : '';
        await apiRequest(`/ldap/users/${uid}${queryParams}`, {
            method: 'DELETE'
        });

        showToast('Utilisateur supprimé avec succès', 'success');
        loadUsers();
    } catch (error) {
        console.error('Delete user error:', error);
        showToast(error.message || 'Erreur lors de la suppression', 'error');
    }
}

// ============ GESTION DES GROUPES ============
async function loadGroups() {
    if (!currentToken) return;

    try {
        const data = await apiRequest('/ldap/groups/search');
        renderGroups(data.groups || data.entries);
    } catch (error) {
        console.error('Groups load error:', error);
        showToast('Erreur lors du chargement des groupes', 'error');
    }
}

function renderGroups(groups) {
    const tbody = document.getElementById('groupsTableBody');
    
    if (!groups || groups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">Aucun groupe trouvé</td></tr>';
        return;
    }

    tbody.innerHTML = groups.map(group => {
        const cn = group.attributes?.cn || 'N/A';
        const description = group.attributes?.description || 'N/A';
        const members = group.attributes?.member;
        const memberCount = Array.isArray(members) ? members.length : (members ? 1 : 0);
        const dn = group.dn || group.attributes?.dn;
        
        return `
            <tr>
                <td>${cn}</td>
                <td>${description}</td>
                <td><span class="badge badge-info">${memberCount} membre(s)</span></td>
                <td>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick='editGroup(\`${dn}\`)'>Éditer</button>
                    <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick='deleteGroup(\`${dn}\`)'>Supprimer</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function searchGroups() {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    const query = document.getElementById('groupSearch').value;
    
    try {
        const endpoint = query ? `/ldap/groups/search?query=${encodeURIComponent(query)}` : '/ldap/groups/search';
        const data = await apiRequest(endpoint);
        renderGroups(data.groups || data.entries);
        showToast(`Recherche effectuée : ${data.count} résultat(s)`, 'success');
    } catch (error) {
        console.error('Group search error:', error);
        showToast('Erreur lors de la recherche de groupes', 'error');
    }
}

async function createGroup() {
    const cn = document.getElementById('newGroupCn').value;
    const description = document.getElementById('newGroupDescription').value;
    const members = document.getElementById('newGroupMembers').value
        .split(',')
        .map(m => m.trim())
        .filter(m => m);

    if (!cn) {
        showToast('Le nom du groupe est obligatoire', 'error');
        return;
    }

    try {
        await apiRequest('/ldap/groups', {
            method: 'POST',
            body: JSON.stringify({ 
                cn, 
                description, 
                members: members.length > 0 ? members : undefined 
            })
        });

        showToast('Groupe créé avec succès', 'success');
        closeModal('addGroupModal');
        loadGroups();
        
        // Réinitialiser le formulaire
        document.getElementById('newGroupCn').value = '';
        document.getElementById('newGroupDescription').value = '';
        document.getElementById('newGroupMembers').value = '';
    } catch (error) {
        showToast(error.message || 'Erreur lors de la création', 'error');
    }
}

async function editGroup(dn) {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    try {
        const data = await apiRequest(`/ldap/groups/${encodeURIComponent(dn)}`);
        const group = data.group || data;
        
        const modalContent = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Éditer le groupe</h2>
                    <button class="close-btn" onclick="closeModal('editGroupModal')">&times;</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Description</label>
                        <input type="text" id="editGroupDescription" value="${group.attributes?.description || ''}" placeholder="Description du groupe">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Membres (DN séparés par des virgules)</label>
                        <textarea id="editGroupMembers" rows="4" placeholder="uid=user1,ou=people,dc=cnous,dc=fr">${
                            Array.isArray(group.attributes?.member) 
                                ? group.attributes.member.join(',\n')
                                : group.attributes?.member || ''
                        }</textarea>
                    </div>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-success" onclick='updateGroup(\`${dn}\`)'>Mettre à jour</button>
                    <button class="btn btn-secondary" onclick="closeModal('editGroupModal')">Annuler</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'editGroupModal';
        modal.innerHTML = modalContent;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    } catch (error) {
        console.error('Error loading group:', error);
        showToast('Erreur lors du chargement des informations du groupe', 'error');
    }
}

async function updateGroup(dn) {
    const description = document.getElementById('editGroupDescription').value;
    const members = document.getElementById('editGroupMembers').value
        .split(',')
        .map(m => m.trim())
        .filter(m => m);

    try {
        await apiRequest(`/ldap/groups/${encodeURIComponent(dn)}`, {
            method: 'PUT',
            body: JSON.stringify({ 
                description, 
                members: members.length > 0 ? members : undefined 
            })
        });

        showToast('Groupe mis à jour avec succès', 'success');
        
        const modal = document.getElementById('editGroupModal');
        if (modal) modal.remove();
        
        loadGroups();
    } catch (error) {
        showToast(error.message || 'Erreur lors de la mise à jour', 'error');
    }
}

async function deleteGroup(dn) {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    const groupName = dn.match(/cn=([^,]+)/)?.[1] || 'Inconnu';
    const confirmDelete = confirm(`Êtes-vous sûr de vouloir supprimer le groupe "${groupName}" ?\n\nCette action est irréversible.`);
    
    if (!confirmDelete) return;

    try {
        await apiRequest(`/ldap/groups/${encodeURIComponent(dn)}`, {
            method: 'DELETE'
        });

        showToast('Groupe supprimé avec succès', 'success');
        loadGroups();
    } catch (error) {
        console.error('Delete group error:', error);
        showToast(error.message || 'Erreur lors de la suppression', 'error');
    }
}

// ============ RECHERCHE AVANCÉE ============
async function performSearch() {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    const baseDN = document.getElementById('searchBaseDN').value;
    const filter = document.getElementById('searchFilter').value;
    const scope = document.getElementById('searchScope').value;
    const attributes = document.getElementById('searchAttributes').value
        .split(',')
        .map(a => a.trim())
        .filter(a => a);

    try {
        const data = await apiRequest('/ldap/search', {
            method: 'POST',
            body: JSON.stringify({
                baseDN,
                filter,
                scope,
                attributes: attributes.length > 0 ? attributes : undefined
            })
        });

        renderSearchResults(data.entries);
    } catch (error) {
        console.error('Search error:', error);
        showToast('Erreur lors de la recherche', 'error');
    }
}

function renderSearchResults(entries) {
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '';
    
    if (!entries || entries.length === 0) {
        resultsContainer.innerHTML = '<p class="no-data">Aucun résultat trouvé</p>';
        return;
    }
    
    resultsContainer.innerHTML = `<p><strong>${entries.length}</strong> résultat(s) trouvé(s)</p>`;
    
    const table = document.createElement('table');
    table.style.marginTop = '16px';
    table.innerHTML = `
        <thead>
            <tr>
                <th>DN</th>
                <th>Type</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            ${entries.map(entry => `
                <tr>
                    <td style="font-family: monospace; font-size: 12px;">${entry.dn}</td>
                    <td>${getIcon(entry)} ${getLabel(entry)}</td>
                    <td>
                        <button class="btn btn-primary" style="padding: 4px 8px; font-size: 11px;" onclick='showEntryDetails(${JSON.stringify(entry).replace(/'/g, "&#39;")})'>Détails</button>
                    </td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    resultsContainer.appendChild(table);
}

function resetSearch() {
    document.getElementById('searchBaseDN').value = 'dc=cnous,dc=fr';
    document.getElementById('searchFilter').value = '(objectClass=*)';
    document.getElementById('searchScope').value = 'sub';
    document.getElementById('searchAttributes').value = '';
    document.getElementById('searchResults').innerHTML = '';
}

// ============ GESTION DES LOGS ============
async function loadLogs() {
    if (!currentToken) return;

    try {
        const data = await apiRequest('/logs');
        renderLogs(data.logs);
    } catch (error) {
        console.error('Logs load error:', error);
        showToast('Erreur lors du chargement des logs', 'error');
    }
}

function renderLogs(logs) {
    const container = document.getElementById('logsContainer');
    
    if (!logs || logs.length === 0) {
        container.innerHTML = '<p>Aucun log trouvé</p>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="log-entry">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <strong>${log.action}</strong>
                <span class="badge ${log.status === 'success' ? 'badge-success' : 'badge-warning'}">${log.status}</span>
            </div>
            <div style="font-size: 12px; color: #64748b;">
                Utilisateur: ${log.user_id || 'Système'} | 
                Date: ${new Date(log.created_at).toLocaleString()}
            </div>
            ${log.details ? `<div style="margin-top: 5px; font-size: 11px;">${JSON.stringify(log.details)}</div>` : ''}
        </div>
    `).join('');
}

async function clearLogs() {
    if (!currentToken) {
        showToast('Veuillez vous connecter d\'abord', 'error');
        return;
    }

    const confirmClear = confirm('Êtes-vous sûr de vouloir effacer tous les logs ?\n\nCette action est irréversible.');
    
    if (!confirmClear) return;

    try {
        const confirmation = 'YES_DELETE_ALL_LOGS';
        const data = await apiRequest(`/logs/all?confirmation=${confirmation}`, {
            method: 'DELETE'
        });

        showToast(data.message || 'Logs effacés avec succès', 'success');
        loadLogs();
    } catch (error) {
        console.error('Clear logs error:', error);
        showToast(error.message || 'Erreur lors de l\'effacement des logs', 'error');
    }
}

// ============ DÉTAILS D'ENTRÉE ============
function showEntryDetails(entry) {
    const modalContent = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Détails de l'entrée</h2>
                <button class="close-btn" onclick="closeModal('entryDetails')">&times;</button>
            </div>
            <div style="margin-bottom: 20px;">
                <div style="background: #f1f5f9; padding: 10px; border-radius: 8px; font-family: monospace; word-break: break-all;">
                    <strong>DN:</strong> ${entry.dn}
                </div>
            </div>
            <div class="attribute-list">
                ${Object.entries(entry.attributes || {}).map(([key, value]) => `
                    <div class="attribute-item">
                        <span class="attribute-key">${key}</span>
                        <span class="attribute-value">${Array.isArray(value) ? value.join(', ') : String(value)}</span>
                    </div>
                `).join('')}
            </div>
            <div class="action-buttons" style="margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closeModal('entryDetails')">Fermer</button>
            </div>
        </div>
    `;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'entryDetails';
    modal.innerHTML = modalContent;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// ============ INITIALISATION ============
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Page chargée');
    
    const token = localStorage.getItem('token');
    if (token) {
        console.log('🔍 Token trouvé dans localStorage');
        verifyToken(token);
    } else {
        console.log('🔍 Aucun token dans localStorage');
        updateStatus(false);
    }

    loadDashboardData();
});

async function verifyToken(token) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            currentToken = token;
            currentUser = data.user;
            updateStatus(true);
            console.log('✅ Token valide, utilisateur:', currentUser);
        } else {
            console.log('❌ Token invalide, suppression');
            localStorage.removeItem('token');
            updateStatus(false);
        }
    } catch (error) {
        console.error('❌ Erreur de vérification:', error);
        localStorage.removeItem('token');
        updateStatus(false);
    }
}