// server-final.js - Version complète avec authentification fonctionnelle
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const ldap = require('ldapjs');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ldap_admin',
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
});

// Configuration
const LDAP_CONFIG = {
  URL: process.env.LDAP_URL || 'ldap://openldap:389',
  BASE_DN: process.env.LDAP_BASE_DN || 'dc=example,dc=com',
  ADMIN_DN: process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com',
  ADMIN_PASSWORD: process.env.LDAP_ADMIN_PASSWORD || 'admin'
};

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

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

// ============ UTILITAIRES ============

// Helper function for LDAP bind with promises
const ldapBind = (client, dn, password) => {
  return new Promise((resolve, reject) => {
    client.bind(dn, String(password), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Helper function for LDAP search
const ldapSearch = (client, baseDN, options) => {
  return new Promise((resolve, reject) => {
    let entries = [];
    
    const search = client.search(baseDN, options, (err, searchRes) => {
      if (err) {
        return reject(err);
      }
      
      searchRes.on('searchEntry', (entry) => {
        entries.push({
          dn: entry.objectName.toString(),
          attributes: entry.attributes.reduce((acc, attr) => {
            acc[attr.type] = attr.values;
            return acc;
          }, {})
        });
      });
      
      searchRes.on('error', (err) => {
        reject(err);
      });
      
      searchRes.on('end', () => {
        resolve(entries);
      });
    });
  });
};

// Logger d'activité
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

// ============ ROUTES PUBLIQUES ============

// Health checks
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'ldap-admin-api'
  });
});

app.get('/api/health/ldap', async (req, res) => {
  const client = ldap.createClient({ url: LDAP_CONFIG.URL });
  
  try {
    await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
    client.unbind();
    res.json({ 
      status: 'healthy', 
      ldap: 'connected',
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

// Login
app.post('/api/auth/login', async (req, res) => {
  console.log('🔐 Login attempt for:', req.body.username);
  
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }
  
  const searchClient = ldap.createClient({ 
    url: LDAP_CONFIG.URL,
    timeout: 10000
  });
  
  try {
    // 1. Bind admin pour la recherche
    await ldapBind(searchClient, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
    console.log('✅ Admin bind successful');
    
    // 2. Recherche utilisateur
    const users = await ldapSearch(searchClient, LDAP_CONFIG.BASE_DN, {
      filter: `(|(uid=${username})(cn=${username}))`,
      scope: 'sub',
      attributes: ['dn', 'cn', 'uid', 'mail', 'sn']
    });
    
    searchClient.unbind();
    
    if (users.length === 0) {
      await logActivity(username, 'login_failed', { reason: 'user_not_found' }, 'failure');
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    
    const userEntry = users[0];
    const userDN = userEntry.dn;
    
    console.log('✅ Found user:', userDN);
    
    // 3. Authentification utilisateur
    const authClient = ldap.createClient({ 
      url: LDAP_CONFIG.URL,
      timeout: 10000
    });
    
    await ldapBind(authClient, userDN, password);
    authClient.unbind();
    
    console.log('✅✅✅ Authentication successful!');
    
    // 4. Générer JWT
    const token = jwt.sign(
      { 
        username: username,
        dn: userDN,
        attributes: userEntry.attributes,
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    
    // 5. Log de l'activité
    await logActivity(username, 'login', { method: 'ldap' });
    
    res.json({
      success: true,
      token,
      user: {
        username,
        dn: userDN,
        ...userEntry.attributes
      },
      expiresIn: '8h'
    });
    
  } catch (error) {
    // Nettoyage
    try {
      if (searchClient && typeof searchClient.unbind === 'function') {
        searchClient.unbind();
      }
    } catch (e) {}
    
    console.error('Login error:', error.message);
    
    await logActivity(username || 'unknown', 'login_failed', { 
      error: error.message 
    }, 'failure');
    
    let errorMessage = 'Authentification échouée';
    if (error.message.includes('Invalid credentials')) {
      errorMessage = 'Mot de passe invalide';
    } else if (error.message.includes('No such object')) {
      errorMessage = 'Utilisateur non trouvé';
    }
    
    res.status(401).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============ ROUTES PROTÉGÉES ============

// Test de token
app.get('/api/auth/verify', authenticateJWT, (req, res) => {
  res.json({ 
    valid: true, 
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

// Refresh token
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
    token: newToken,
    expiresIn: '8h'
  });
});

// Arborescence LDAP
app.get('/api/ldap/tree', authenticateJWT, async (req, res) => {
  const client = ldap.createClient({ 
    url: LDAP_CONFIG.URL,
    timeout: 10000
  });
  
  try {
    await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
    
    const entries = await ldapSearch(client, LDAP_CONFIG.BASE_DN, {
      filter: '(objectClass=*)',
      scope: 'one',
      attributes: ['dn', 'objectClass', 'ou', 'cn', 'description']
    });
    
    client.unbind();
    
    await logActivity(req.user.username, 'tree_browse', { 
      baseDN: LDAP_CONFIG.BASE_DN 
    });
    
    res.json({
      success: true,
      entries,
      count: entries.length
    });
    
  } catch (error) {
    if (client && typeof client.unbind === 'function') {
      client.unbind();
    }
    
    console.error('Tree browse error:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération de l\'arborescence',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Recherche LDAP
app.post('/api/ldap/search', authenticateJWT, async (req, res) => {
  const { baseDN = LDAP_CONFIG.BASE_DN, filter = '(objectClass=*)', scope = 'sub', attributes = [] } = req.body;
  
  const client = ldap.createClient({ 
    url: LDAP_CONFIG.URL,
    timeout: 10000
  });
  
  try {
    await ldapBind(client, LDAP_CONFIG.ADMIN_DN, LDAP_CONFIG.ADMIN_PASSWORD);
    
    const entries = await ldapSearch(client, baseDN, {
      filter,
      scope,
      attributes: attributes.length > 0 ? attributes : undefined
    });
    
    client.unbind();
    
    await logActivity(req.user.username, 'ldap_search', { 
      baseDN, filter, scope 
    });
    
    res.json({
      success: true,
      entries,
      count: entries.length
    });
    
  } catch (error) {
    if (client && typeof client.unbind === 'function') {
      client.unbind();
    }
    
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la recherche',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Logs d'activité
app.get('/api/logs', authenticateJWT, async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  
  try {
    const result = await pool.query(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    
    res.json({
      success: true,
      logs: result.rows,
      count: result.rowCount
    });
    
  } catch (error) {
    console.error('Logs fetch error:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération des logs'
    });
  }
});

// ============ INITIALISATION ============

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
    
    console.log('✅ Base de données initialisée');
    
  } catch (error) {
    console.error('❌ Erreur DB:', error);
  }
};

// ============ DÉMARRAGE ============

app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 Serveur API démarré sur le port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 LDAP: ${LDAP_CONFIG.URL}`);
  console.log(`📁 Base DN: ${LDAP_CONFIG.BASE_DN}`);
  console.log(`👑 Admin DN: ${LDAP_CONFIG.ADMIN_DN}`);
});

// Gestion des erreurs
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
