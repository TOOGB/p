// server.js - API LDAP Admin complète avec pagination
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const ldap = require('ldapjs');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============ MIDDLEWARE ============
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Configuration CORS
const corsOptions = {
    origin: [
        'http://localhost',
        'http://localhost:80',
        'http://localhost:3000',
        'http://127.0.0.1',
        'http://nginx:80'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
    credentials: true,
    maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ CONFIGURATION ============
const LDAP_CONFIG = {
    URL: process.env.LDAP_URL || 'ldap://spoutnik2.in.cnous.fr:389',
    BASE_DN: process.env.LDAP_BASE_DN || 'dc=cnous,dc=fr',
    ADMIN_DN: process.env.LDAP_ADMIN_DN || 'cn=read,ou=accounts,dc=cnous,dc=fr',
    ADMIN_PASSWORD: process.env.LDAP_ADMIN_PASSWORD
};

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'ldap_admin',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'admin123',
});

// ============ UTILITAIRES LDAP ============
const createLdapClient = () => {
    return ldap.createClient({
        url: LDAP_CONFIG.URL,
        timeout: 10000,
        connectTimeout: 15000,
    });
};

const ldapBind = (client, dn, password) => {
    return new Promise((resolve, reject) => {
        client.bind(String(dn), String(password), (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

const ldapSearch = (client, baseDN, options) => {
    return new Promise((resolve, reject) => {
        const entries = [];
        
        client.search(baseDN, options, (err, searchRes) => {
            if (err) return reject(err);
            
            searchRes.on('searchEntry', (entry) => {
                const entryData = {
                    dn: entry.objectName.toString(),
                    attributes: {}
                };
                
                entry.attributes.forEach(attr => {
                    entryData.attributes[attr.type] = attr.values.length === 1 ? attr.values[0] : attr.values;
                });
                
                entries.push(entryData);
            });
            
            searchRes.on('error', reject);
            searchRes.on('end', () => resolve(entries));
        });
    });
};

// Nouvelle fonction pour la recherche paginée
const ldapSearchPaginated = (client, baseDN, options, pageSize = 100) => {
    return new Promise((resolve, reject) => {
        const entries = [];
        let totalCount = 0;
        
        const searchOptions = {
            ...options,
            paged: {
                pageSize: pageSize,
                pagePause: false
            }
        };
        
        client.search(baseDN, searchOptions, (err, searchRes) => {
            if (err) return reject(err);
            
            searchRes.on('searchEntry', (entry) => {
                totalCount++;
                const entryData = {
                    dn: entry.objectName.toString(),
                    attributes: {}
                };
                
                entry.attributes.forEach(attr => {
                    entryData.attributes[attr.type] = attr.values.length === 1 ? attr.values[0] : attr.values;
                });
                
                entries.push(entryData);
            });
            
            searchRes.on('page', (result, cb) => {
                // Continuation de la pagination si nécessaire
                if (cb) cb();
            });
            
            searchRes.on('error', reject);
            
            searchRes.on('end', (result) => {
                resolve({ entries, totalCount });
            });
        });
    });
};

// Fonction pour compter rapidement les enfants
const countChildren = async (client, dn) => {
    try {
        const result = await ldapSearchPaginated(client, dn, {
            filter: '(objectClass=*)',
            scope: 'one',
            attributes: ['dn'],
        }, 100);
        
        return result.totalCount;
    } catch (error) {
        console.warn(`Erreur lors du comptage des enfants pour ${dn}:`, error);
        return 0;
    }
};

// ============ LOGGING ============
const logActivity = async (userId, action, details, status = 'success') => {
    try {
        await pool.query(
            'INSERT INTO activity_logs (user_id, action, details, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
            [userId, action, JSON.stringify(details), status]
        );
    } catch (err) {
        console.error('Log error:', err);
    }
};

// ============ MIDDLEWARE JWT ============
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Token manquant' });
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token mal formaté' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide' });
        }
        req.user = user;
        next();
    });
};

// ============ ROUTES PUBLIQUES ============

// Health checks
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT NOW()');
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/health/ldap', async (req, res) => {
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        client.unbind();
        res.json({ 
            status: 'healthy', 
            ldap: 'connected',
            url: LDAP_CONFIG.URL,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        res.status(503).json({ 
            status: 'unhealthy', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ============ AUTHENTIFICATION ============

app.post('/api/auth/login', async (req, res) => {
    console.log('='.repeat(60));
    console.log('🔐 LOGIN REQUEST');
    console.log('Username:', req.body.username);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ 
            success: false,
            error: 'Username et password requis' 
        });
    }
    
    const searchClient = createLdapClient();
    
    try {
        // Bind admin pour la recherche
        await ldapBind(searchClient, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        console.log('✅ Admin bind successful');
        
        // Essayez plusieurs filtres
        const filters = [
            `(uid=${username})`,
            `(cn=${username})`,
            `(&(objectClass=inetOrgPerson)(uid=${username}))`,
            `(&(objectClass=person)(cn=${username}))`,
            `(cn=*${username}*)`
        ];
        
        let users = [];
        let foundFilter = '';
        
        for (const filter of filters) {
            console.log(`🔍 Test filtre: ${filter}`);
            try {
                const results = await ldapSearch(searchClient, LDAP_CONFIG.BASE_DN, {
                    filter: filter,
                    scope: 'sub',
                    attributes: ['dn', 'cn', 'uid', 'mail', 'objectClass']
                });
                
                console.log(`   → ${results.length} résultat(s)`);
                
                if (results.length > 0) {
                    users = results;
                    foundFilter = filter;
                    console.log(`✅ Utilisateur trouvé avec filtre: ${filter}`);
                    break;
                }
            } catch (err) {
                console.log(`   → Erreur: ${err.message}`);
            }
        }
        
        searchClient.unbind();
        
        if (users.length === 0) {
            console.log('❌ Aucun utilisateur trouvé');
            await logActivity(username, 'login_failed', { reason: 'user_not_found' }, 'failure');
            
            return res.status(401).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
        }
        
        const userEntry = users[0];
        console.log('✅ Utilisateur trouvé:', userEntry.dn);
        console.log('📋 Attributs:', userEntry.attributes);
        
        // Authentification
        const authClient = createLdapClient();
        
        try {
            await ldapBind(authClient, userEntry.dn, password);
            authClient.unbind();
            console.log('✅✅✅ Authentification réussie !');
            
            const token = jwt.sign(
                { 
                    username: userEntry.attributes.uid || userEntry.attributes.cn || username,
                    dn: userEntry.dn,
                    attributes: userEntry.attributes,
                    iat: Math.floor(Date.now() / 1000)
                },
                JWT_SECRET,
                { expiresIn: '8h' }
            );
            
            await logActivity(username, 'login', { 
                method: 'ldap', 
                ip: req.ip,
                dn: userEntry.dn 
            });
            
            res.json({
                success: true,
                token,
                user: {
                    username: userEntry.attributes.uid || userEntry.attributes.cn || username,
                    dn: userEntry.dn,
                    ...userEntry.attributes
                },
                expiresIn: '8h'
            });
            
        } catch (authError) {
            authClient.unbind();
            console.error('❌ Erreur auth:', authError.message);
            await logActivity(username, 'login_failed', { reason: 'invalid_password' }, 'failure');
            
            res.status(401).json({
                success: false,
                error: 'Mot de passe invalide'
            });
        }
        
    } catch (error) {
        if (searchClient && typeof searchClient.unbind === 'function') {
            searchClient.unbind();
        }
        
        console.error('🔥 Erreur générale:', error);
        await logActivity(username || 'unknown', 'login_failed', { error: error.message }, 'failure');
        
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de l\'authentification'
        });
    } finally {
        console.log('='.repeat(60));
    }
});

app.post('/api/auth/refresh', authenticateJWT, (req, res) => {
    const newToken = jwt.sign(
        { 
            username: req.user.username,
            dn: req.user.dn,
            attributes: req.user.attributes,
            iat: Math.floor(Date.now() / 1000)
        },
        JWT_SECRET,
        { expiresIn: '8h' }
    );
    
    res.json({ 
        success: true,
        token: newToken,
        expiresIn: '8h'
    });
});

app.get('/api/auth/verify', authenticateJWT, (req, res) => {
    res.json({ 
        valid: true, 
        user: req.user,
        timestamp: new Date().toISOString()
    });
});

// ============ PARCOURIR (ARBORESCENCE) - AVEC PAGINATION ============

app.get('/api/ldap/children', authenticateJWT, async (req, res) => {
    const { parentDN, scope, page = 1, pageSize = 50 } = req.query;
    const client = createLdapClient();
    
    const actualPageSize = Math.min(parseInt(pageSize) || 50, 200); // Max 200 par page
    const currentPage = Math.max(parseInt(page) || 1, 1);
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const searchBase = parentDN || LDAP_CONFIG.BASE_DN;
        const searchScope = scope || 'one';
        
        // D'abord compter le nombre total d'entrées
        const countResult = await ldapSearch(client, searchBase, {
            filter: '(objectClass=*)',
            scope: searchScope,
            attributes: ['dn']
        });
        
        const totalCount = countResult.length;
        const totalPages = Math.ceil(totalCount / actualPageSize);
        
        console.log(`📊 Total entries: ${totalCount}, Page: ${currentPage}/${totalPages}`);
        
        // Calculer les indices
        const startIndex = (currentPage - 1) * actualPageSize;
        const endIndex = Math.min(startIndex + actualPageSize, totalCount);
        
        // Récupérer uniquement les entrées de la page demandée
        const allEntries = await ldapSearch(client, searchBase, {
            filter: '(objectClass=*)',
            scope: searchScope,
            attributes: ['dn', 'cn', 'ou', 'objectClass', 'description', 'member', 'uid']
        });
        
        const paginatedEntries = allEntries.slice(startIndex, endIndex);
        
        client.unbind();
        
        console.log(`📊 Returning ${paginatedEntries.length} entries for page ${currentPage}`);
        
        await logActivity(req.user.username, 'tree_children', { 
            parentDN: searchBase, 
            scope: searchScope,
            page: currentPage,
            pageSize: actualPageSize,
            totalCount
        });
        
        console.log(`📊 Pagination calculation:`, {
            currentPage,
            totalPages,
            actualPageSize,
            startIndex,
            endIndex,
            hasNextPage: currentPage < totalPages,
            hasPreviousPage: currentPage > 1
        });
        
        // Vérifier rapidement si chaque entrée a des enfants (en parallèle avec limite)
        const checkPromises = paginatedEntries.map(async (entry) => {
            let hasChildren = false;
            let childCount = 0;
            
            try {
                const childClient = createLdapClient();
                await ldapBind(childClient, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
                
                childCount = await countChildren(childClient, entry.dn);
                hasChildren = childCount > 0;
                
                childClient.unbind();
            } catch (error) {
                console.warn(`Erreur lors de la vérification des enfants pour ${entry.dn}:`, error);
            }
            
            return {
                ...entry,
                hasChildren,
                childCount
            };
        });
        
        // Limiter le nombre de vérifications simultanées
        const batchSize = 10;
        const entriesWithChildrenInfo = [];
        
        for (let i = 0; i < checkPromises.length; i += batchSize) {
            const batch = checkPromises.slice(i, i + batchSize);
            const results = await Promise.all(batch);
            entriesWithChildrenInfo.push(...results);
        }
        
        res.json({
            success: true,
            entries: entriesWithChildrenInfo,
            pagination: {
                currentPage,
                pageSize: actualPageSize,
                totalCount,
                totalPages,
                hasNextPage: currentPage < totalPages,
                hasPreviousPage: currentPage > 1,
                startIndex,
                endIndex: Math.min(endIndex, totalCount)
            },
            parentDN: searchBase
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Children error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la récupération des enfants' 
        });
    }
});

// Endpoint pour compter rapidement le nombre d'enfants
app.get('/api/ldap/count-children', authenticateJWT, async (req, res) => {
    const { dn } = req.query;
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const count = await countChildren(client, dn);
        
        client.unbind();
        
        res.json({
            success: true,
            dn,
            childCount: count,
            hasChildren: count > 0
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Count children error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors du comptage des enfants' 
        });
    }
});

// Endpoint pour vérifier rapidement si un nœud a des enfants
app.get('/api/ldap/has-children', authenticateJWT, async (req, res) => {
    const { dn } = req.query;
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const children = await ldapSearch(client, dn, {
            filter: '(objectClass=*)',
            scope: 'one',
            attributes: ['dn'],
            paged: false
        });
        
        client.unbind();
        
        res.json({
            success: true,
            hasChildren: children.length > 0
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Has children error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la vérification des enfants' 
        });
    }
});

// ============ GESTION DES UTILISATEURS ============

app.get('/api/ldap/users/search', authenticateJWT, async (req, res) => {
    const { query } = req.query;
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        let filter;
        if (query) {
            filter = `(&(objectClass=inetOrgPerson)(|(uid=*${query}*)(cn=*${query}*)(mail=*${query}*)(sn=*${query}*)))`;
        } else {
            filter = '(objectClass=inetOrgPerson)';
        }
        
        const entries = await ldapSearch(client, LDAP_CONFIG.BASE_DN, {
            filter: filter,
            scope: 'sub',
            attributes: ['dn', 'cn', 'sn', 'uid', 'mail', 'givenName', 'telephoneNumber', 'title', 'description']
        });
        
        client.unbind();
        
        await logActivity(req.user.username, 'user_search', { query });
        
        res.json({
            success: true,
            users: entries,
            count: entries.length
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('User search error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la recherche d\'utilisateurs' 
        });
    }
});

app.get('/api/ldap/users/:dn', authenticateJWT, async (req, res) => {
    const dn = decodeURIComponent(req.params.dn);
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const entries = await ldapSearch(client, dn, {
            filter: '(objectClass=*)',
            scope: 'base',
            attributes: ['*']
        });
        
        client.unbind();
        
        if (entries.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
        }
        
        await logActivity(req.user.username, 'user_view', { dn });
        
        res.json({
            success: true,
            user: entries[0]
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Get user error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la récupération de l\'utilisateur' 
        });
    }
});

app.post('/api/ldap/users', authenticateJWT, async (req, res) => {
    const { cn, sn, mail, uid, userPassword, ou } = req.body;
    
    if (!cn || !sn || !uid || !mail || !userPassword) {
        return res.status(400).json({ 
            success: false,
            error: 'Tous les champs sont requis: cn, sn, uid, mail, userPassword' 
        });
    }
    
    const client = createLdapClient();
    const userDN = `uid=${uid},ou=${ou || 'people'},${LDAP_CONFIG.BASE_DN}`;
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const entry = {
            cn,
            sn,
            mail,
            uid,
            userPassword,
            objectClass: ['inetOrgPerson', 'organizationalPerson', 'person', 'top']
        };
        
        await new Promise((resolve, reject) => {
            client.add(userDN, entry, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        client.unbind();
        
        await logActivity(req.user.username, 'user_created', { cn, uid, dn: userDN });
        
        res.json({
            success: true,
            message: 'Utilisateur créé avec succès',
            dn: userDN
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Create user error:', error);
        
        if (error.message.includes('No Such Object')) {
            return res.status(400).json({
                success: false,
                error: `L'unité organisationnelle '${ou || 'people'}' n'existe pas. Créez-la d'abord.`
            });
        }
        
        await logActivity(req.user.username, 'user_create_failed', { uid, error: error.message }, 'failure');
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

app.put('/api/ldap/users/:uid', authenticateJWT, async (req, res) => {
    const { uid } = req.params;
    const { cn, sn, mail, ou } = req.body;
    const client = createLdapClient();

    const userDN = `uid=${uid},ou=${ou || 'people'},${LDAP_CONFIG.BASE_DN}`;

    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);

        const changes = [];

        if (cn) {
            changes.push(new ldap.Change({
                operation: 'replace',
                modification: new ldap.Attribute({
                    type: 'cn',
                    values: cn
                })
            }));
        }

        if (sn) {
            changes.push(new ldap.Change({
                operation: 'replace',
                modification: new ldap.Attribute({
                    type: 'sn',
                    values: sn
                })
            }));
        }

        if (mail) {
            changes.push(new ldap.Change({
                operation: 'replace',
                modification: new ldap.Attribute({
                    type: 'mail',
                    values: mail
                })
            }));
        }

        if (changes.length === 0) {
            client.unbind();
            return res.status(400).json({
                success: false,
                error: 'Aucune modification fournie'
            });
        }

        await new Promise((resolve, reject) => {
            client.modify(userDN, changes, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        client.unbind();

        await logActivity(
            req.user.username,
            'user_modified',
            { uid, changes: { cn, sn, mail } }
        );

        res.json({
            success: true,
            message: 'Utilisateur modifié avec succès'
        });

    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }

        console.error('Update user error:', error);

        await logActivity(
            req.user.username,
            'user_modify_failed',
            { uid, error: error.message },
            'failure'
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


app.delete('/api/ldap/users/:uid', authenticateJWT, async (req, res) => {
    const { uid } = req.params;
    const { ou } = req.query;
    const client = createLdapClient();
    
    const userDN = `uid=${uid},ou=${ou || 'people'},${LDAP_CONFIG.BASE_DN}`;
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        await new Promise((resolve, reject) => {
            client.del(userDN, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        client.unbind();
        
        await logActivity(req.user.username, 'user_deleted', { uid, dn: userDN });
        
        res.json({
            success: true,
            message: 'Utilisateur supprimé avec succès'
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Delete user error:', error);
        await logActivity(req.user.username, 'user_delete_failed', { uid, error: error.message }, 'failure');
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// ============ GESTION DES GROUPES ============

app.get('/api/ldap/groups/search', authenticateJWT, async (req, res) => {
    const { query } = req.query;
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        let filter;
        if (query) {
            filter = `(&(objectClass=groupOfNames)(|(cn=*${query}*)(description=*${query}*)))`;
        } else {
            filter = '(objectClass=groupOfNames)';
        }
        
        const entries = await ldapSearch(client, LDAP_CONFIG.BASE_DN, {
            filter: filter,
            scope: 'sub',
            attributes: ['dn', 'cn', 'description', 'member', 'owner']
        });
        
        client.unbind();
        
        await logActivity(req.user.username, 'group_search', { query });
        
        res.json({
            success: true,
            groups: entries,
            count: entries.length
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Group search error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la recherche de groupes' 
        });
    }
});

app.get('/api/ldap/groups/:dn', authenticateJWT, async (req, res) => {
    const dn = decodeURIComponent(req.params.dn);
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const entries = await ldapSearch(client, dn, {
            filter: '(objectClass=*)',
            scope: 'base',
            attributes: ['*']
        });
        
        client.unbind();
        
        if (entries.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Groupe non trouvé'
            });
        }
        
        await logActivity(req.user.username, 'group_view', { dn });
        
        res.json({
            success: true,
            group: entries[0]
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Get group error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la récupération du groupe' 
        });
    }
});

app.post('/api/ldap/groups', authenticateJWT, async (req, res) => {
    const { cn, description, members } = req.body;
    
    if (!cn) {
        return res.status(400).json({ 
            success: false,
            error: 'Le nom du groupe (cn) est requis' 
        });
    }
    
    const client = createLdapClient();
    const groupDN = `cn=${cn},ou=groups,${LDAP_CONFIG.BASE_DN}`;
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const entry = {
            cn,
            description: description || '',
            objectClass: ['groupOfNames', 'top'],
            member: members && members.length > 0 ? members : [`cn=${cn},ou=groups,${LDAP_CONFIG.BASE_DN}`]
        };
        
        await new Promise((resolve, reject) => {
            client.add(groupDN, entry, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        client.unbind();
        
        await logActivity(req.user.username, 'group_created', { cn, dn: groupDN });
        
        res.json({
            success: true,
            message: 'Groupe créé avec succès',
            dn: groupDN
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Create group error:', error);
        
        if (error.message.includes('No Such Object')) {
            return res.status(400).json({
                success: false,
                error: "L'unité organisationnelle 'groups' n'existe pas. Créez-la d'abord."
            });
        }
        
        if (error.message.includes('Invalid Attribute Syntax')) {
            return res.status(400).json({
                success: false,
                error: "Syntaxe invalide pour les membres. Les membres doivent être des DN valides."
            });
        }
        
        await logActivity(req.user.username, 'group_create_failed', { cn, error: error.message }, 'failure');
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

app.put('/api/ldap/groups/:dn', authenticateJWT, async (req, res) => {
    const dn = decodeURIComponent(req.params.dn);
    const { description, members, owner } = req.body;
    const client = createLdapClient();

    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);

        const changes = [];

        if (description !== undefined) {
            changes.push(new ldap.Change({
                operation: 'replace',
                modification: new ldap.Attribute({
                    type: 'description',
                    values: description
                })
            }));
        }

        if (members !== undefined) {
            changes.push(new ldap.Change({
                operation: 'replace',
                modification: new ldap.Attribute({
                    type: 'member',
                    values: Array.isArray(members) ? members : [members]
                })
            }));
        }

        if (owner !== undefined) {
            changes.push(new ldap.Change({
                operation: 'replace',
                modification: new ldap.Attribute({
                    type: 'owner',
                    values: owner
                })
            }));
        }

        if (changes.length === 0) {
            client.unbind();
            return res.status(400).json({
                success: false,
                error: 'Aucune modification fournie'
            });
        }

        await new Promise((resolve, reject) => {
            client.modify(dn, changes, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        client.unbind();

        await logActivity(
            req.user.username,
            'group_modified',
            { dn, changes: { description, members, owner } }
        );

        res.json({
            success: true,
            message: 'Groupe modifié avec succès'
        });

    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }

        console.error('Update group error:', error);

        await logActivity(
            req.user.username,
            'group_modify_failed',
            { dn, error: error.message },
            'failure'
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


app.delete('/api/ldap/groups/:dn', authenticateJWT, async (req, res) => {
    const dn = decodeURIComponent(req.params.dn);
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        await new Promise((resolve, reject) => {
            client.del(dn, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        client.unbind();
        
        await logActivity(req.user.username, 'group_deleted', { dn });
        
        res.json({
            success: true,
            message: 'Groupe supprimé avec succès'
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Delete group error:', error);
        await logActivity(req.user.username, 'group_delete_failed', { dn, error: error.message }, 'failure');
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// ============ SCHÉMA LDAP ============

app.get('/api/ldap/schema', authenticateJWT, async (req, res) => {
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const schema = await ldapSearch(client, 'cn=schema', {
            filter: '(objectClass=*)',
            scope: 'base',
            attributes: ['objectClasses', 'attributeTypes']
        });
        
        client.unbind();
        
        await logActivity(req.user.username, 'schema_view', {});
        
        const commonClasses = [
            {
                name: 'inetOrgPerson',
                description: 'Personne avec attributs Internet',
                required: ['cn', 'sn'],
                optional: ['mail', 'uid', 'givenName', 'telephoneNumber', 'description']
            },
            {
                name: 'groupOfNames',
                description: 'Groupe d\'utilisateurs',
                required: ['cn', 'member'],
                optional: ['description', 'owner']
            },
            {
                name: 'organizationalUnit',
                description: 'Unité organisationnelle',
                required: ['ou'],
                optional: ['description', 'businessCategory']
            }
        ];
        
        res.json({
            success: true,
            objectClasses: commonClasses,
            count: commonClasses.length
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Schema error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la récupération du schéma' 
        });
    }
});

// ============ STATISTIQUES ============

app.get('/api/stats', authenticateJWT, async (req, res) => {
    const client = createLdapClient();
    
    try {
        await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
        
        const [users, groups, ous, allEntries] = await Promise.all([
            ldapSearch(client, LDAP_CONFIG.BASE_DN, {
                filter: '(objectClass=inetOrgPerson)',
                scope: 'sub',
                attributes: ['dn']
            }),
            ldapSearch(client, LDAP_CONFIG.BASE_DN, {
                filter: '(objectClass=groupOfNames)',
                scope: 'sub',
                attributes: ['dn']
            }),
            ldapSearch(client, LDAP_CONFIG.BASE_DN, {
                filter: '(objectClass=organizationalUnit)',
                scope: 'sub',
                attributes: ['dn']
            }),
            ldapSearch(client, LDAP_CONFIG.BASE_DN, {
                filter: '(objectClass=*)',
                scope: 'sub',
                attributes: ['dn']
            })
        ]);
        
        client.unbind();
        
        await logActivity(req.user.username, 'stats_view', {});
        
        res.json({
            success: true,
            users: users.length,
            groups: groups.length,
            ous: ous.length,
            totalEntries: allEntries.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        if (client && typeof client.unbind === 'function') {
            client.unbind();
        }
        console.error('Stats error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors du calcul des statistiques' 
        });
    }
});

// ============ JOURNAUX (LOGS) ============

app.get('/api/logs', authenticateJWT, async (req, res) => {
    const { limit = 100, offset = 0, action, status, userId } = req.query;
    
    try {
        let query = 'SELECT * FROM activity_logs WHERE 1=1';
        const params = [];
        let paramCount = 1;
        
        if (action) {
            query += ` AND action = $${paramCount++}`;
            params.push(action);
        }
        if (status) {
            query += ` AND status = $${paramCount++}`;
            params.push(status);
        }
        if (userId) {
            query += ` AND user_id = $${paramCount++}`;
            params.push(userId);
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            logs: result.rows,
            count: result.rowCount,
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Logs error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de la récupération des logs' 
        });
    }
});

app.delete('/api/logs', authenticateJWT, async (req, res) => {
    const { olderThan, action, status } = req.query;
    
    try {
        let query = 'DELETE FROM activity_logs WHERE 1=1';
        const params = [];
        let paramCount = 1;
        
        if (olderThan) {
            query += ` AND created_at < $${paramCount++}`;
            params.push(olderThan);
        }
        if (action) {
            query += ` AND action = $${paramCount++}`;
            params.push(action);
        }
        if (status) {
            query += ` AND status = $${paramCount++}`;
            params.push(status);
        }
        
        // Si aucun filtre n'est spécifié, demander confirmation explicite
        if (params.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Veuillez spécifier un filtre pour effacer les logs'
            });
        }
        
        const result = await pool.query(query, params);
        
        await logActivity(req.user.username, 'logs_cleared', { 
            olderThan, 
            action, 
            status, 
            deletedCount: result.rowCount 
        });
        
        res.json({
            success: true,
            message: `${result.rowCount} logs effacés avec succès`,
            deletedCount: result.rowCount
        });
        
    } catch (error) {
        console.error('Clear logs error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de l\'effacement des logs' 
        });
    }
});

app.delete('/api/logs/all', authenticateJWT, async (req, res) => {
    const { confirmation } = req.query;
    
    if (confirmation !== 'YES_DELETE_ALL_LOGS') {
        return res.status(400).json({
            success: false,
            error: 'Confirmation requise. Ajoutez ?confirmation=YES_DELETE_ALL_LOGS à la requête'
        });
    }
    
    try {
        const result = await pool.query('DELETE FROM activity_logs');
        
        await logActivity(req.user.username, 'all_logs_cleared', { 
            deletedCount: result.rowCount 
        });
        
        res.json({
            success: true,
            message: `Tous les logs (${result.rowCount}) ont été effacés`,
            deletedCount: result.rowCount
        });
        
    } catch (error) {
        console.error('Clear all logs error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erreur lors de l\'effacement de tous les logs' 
        });
    }
});

// ============ ROUTE PAR DÉFAUT ============

app.get('/', (req, res) => {
    res.json({
        name: 'LDAP Admin API',
        version: '2.0.0',
        status: 'running',
        baseDN: LDAP_CONFIG.BASE_DN,
        endpoints: {
            health: '/health',
            ldapHealth: '/api/health/ldap',
            auth: {
                login: 'POST /api/auth/login',
                refresh: 'POST /api/auth/refresh',
                verify: 'GET /api/auth/verify'
            },
            ldap: {
                tree: 'GET /api/ldap/tree',
                search: 'POST /api/ldap/search',
                schema: 'GET /api/ldap/schema',
                children: 'GET /api/ldap/children (avec pagination: page, pageSize)',
                countChildren: 'GET /api/ldap/count-children'
            },
            users: {
                create: 'POST /api/ldap/users',
                update: 'PUT /api/ldap/users/:uid',
                delete: 'DELETE /api/ldap/users/:uid'
            },
            groups: {
                create: 'POST /api/ldap/groups',
                update: 'PUT /api/ldap/groups/:dn',
                delete: 'DELETE /api/ldap/groups/:dn'
            },
            stats: 'GET /api/stats',
            logs: 'GET /api/logs'
        }
    });
});

// ============ INITIALISATION DB ============

const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255),
                action VARCHAR(100) NOT NULL,
                details JSONB,
                status VARCHAR(50) DEFAULT 'success',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_created_at ON activity_logs(created_at DESC);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_user_id ON activity_logs(user_id);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_action ON activity_logs(action);
        `);
        
        console.log('✅ Base de données initialisée');
    } catch (error) {
        console.error('❌ Erreur DB:', error);
    }
};

// ============ GESTION DES ERREURS ============

app.use((err, req, res, next) => {
    console.error('🔥 Server error:', err.stack);
    res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        message: err.message 
    });
});

// ============ DÉMARRAGE ============

app.listen(PORT, async () => {
    console.log(`\n🚀 LDAP Admin API v2.0 - Avec Pagination`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    try {
        await initDB();
        console.log(`✅ Serveur: http://localhost:${PORT}`);
        console.log(`📊 Health: http://localhost:${PORT}/health`);
        console.log(`🔐 LDAP: ${LDAP_CONFIG.URL}`);
        console.log(`📁 Base DN: ${LDAP_CONFIG.BASE_DN}`);
        console.log(`📄 Pagination: 50 entrées par page (max 200)`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`\n✨ Prêt à accepter des connexions !\n`);
    } catch (error) {
        console.error('❌ Failed to start:', error);
        process.exit(1);
    }
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    console.log('SIGTERM reçu, arrêt gracieux...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\nSIGINT reçu, arrêt gracieux...');
    process.exit(0);
});