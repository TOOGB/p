// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const ldap = require('ldapjs');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// PostgreSQL Pool
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ldap_admin',
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
});

// LDAP Client Configuration
const createLdapClient = () => {
  return ldap.createClient({
    url: process.env.LDAP_URL || 'ldap://openldap:389',
    timeout: 5000,
    connectTimeout: 10000,
  });
};

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============ UTILITIES ============

// Logger vers PostgreSQL
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

// Middleware d'authentification JWT
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// ============ ROUTES D'AUTHENTIFICATION ============

// Login LDAP + JWT
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const client = createLdapClient();

  try {
    const bindDN = `cn=${username},${process.env.LDAP_BASE_DN || 'dc=example,dc=com'}`;
    
    client.bind(bindDN, password, async (err) => {
      if (err) {
        await logActivity(null, 'login_failed', { username }, 'failure');
        client.unbind();
        return res.status(401).json({ error: 'Identifiants invalides' });
      }

      // Recherche des infos utilisateur
      client.search(bindDN, { scope: 'base' }, async (searchErr, searchRes) => {
        if (searchErr) {
          client.unbind();
          return res.status(500).json({ error: 'Erreur LDAP' });
        }

        let userInfo = {};
        searchRes.on('searchEntry', (entry) => {
          userInfo = entry.pojo;
        });

        searchRes.on('end', async () => {
          const token = jwt.sign(
            { username, dn: bindDN, roles: ['admin'] },
            JWT_SECRET,
            { expiresIn: '8h' }
          );

          await logActivity(username, 'login_success', { ip: req.ip }, 'success');
          client.unbind();

          res.json({
            token,
            user: {
              username,
              dn: bindDN,
              ...userInfo.attributes
            }
          });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh token
app.post('/api/auth/refresh', authenticateJWT, (req, res) => {
  const token = jwt.sign(
    { username: req.user.username, dn: req.user.dn, roles: req.user.roles },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token });
});

// ============ ROUTES LDAP TREE ============

// Récupérer l'arborescence LDAP
app.get('/api/ldap/tree', authenticateJWT, async (req, res) => {
  const { baseDN } = req.query;
  const client = createLdapClient();

  try {
    const adminDN = process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com';
    const adminPassword = process.env.LDAP_ADMIN_PASSWORD || 'admin';

    client.bind(adminDN, adminPassword, (err) => {
      if (err) {
        client.unbind();
        return res.status(500).json({ error: 'Erreur de connexion LDAP' });
      }

      const searchBase = baseDN || process.env.LDAP_BASE_DN || 'dc=example,dc=com';
      const opts = {
        filter: '(objectClass=*)',
        scope: 'one',
        attributes: ['dn', 'cn', 'ou', 'objectClass']
      };

      const entries = [];
      client.search(searchBase, opts, (searchErr, searchRes) => {
        if (searchErr) {
          client.unbind();
          return res.status(500).json({ error: 'Erreur de recherche' });
        }

        searchRes.on('searchEntry', (entry) => {
          entries.push(entry.pojo);
        });

        searchRes.on('end', async () => {
          await logActivity(req.user.username, 'tree_browse', { baseDN: searchBase });
          client.unbind();
          res.json({ entries });
        });

        searchRes.on('error', (err) => {
          client.unbind();
          res.status(500).json({ error: err.message });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recherche LDAP avancée
app.post('/api/ldap/search', authenticateJWT, async (req, res) => {
  const { baseDN, filter, scope, attributes } = req.body;
  const client = createLdapClient();

  try {
    const adminDN = process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com';
    const adminPassword = process.env.LDAP_ADMIN_PASSWORD || 'admin';

    client.bind(adminDN, adminPassword, (err) => {
      if (err) {
        client.unbind();
        return res.status(500).json({ error: 'Erreur de connexion LDAP' });
      }

      const opts = {
        filter: filter || '(objectClass=*)',
        scope: scope || 'sub',
        attributes: attributes || []
      };

      const entries = [];
      client.search(baseDN, opts, (searchErr, searchRes) => {
        if (searchErr) {
          client.unbind();
          return res.status(500).json({ error: 'Erreur de recherche' });
        }

        searchRes.on('searchEntry', (entry) => {
          entries.push(entry.pojo);
        });

        searchRes.on('end', async () => {
          await logActivity(req.user.username, 'ldap_search', { filter, baseDN });
          client.unbind();
          res.json({ entries, count: entries.length });
        });

        searchRes.on('error', (err) => {
          client.unbind();
          res.status(500).json({ error: err.message });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ GESTION DES UTILISATEURS ============

// Créer un utilisateur LDAP
app.post('/api/ldap/users', authenticateJWT, async (req, res) => {
  const { cn, sn, mail, uid, userPassword, ou } = req.body;
  const client = createLdapClient();

  try {
    const adminDN = process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com';
    const adminPassword = process.env.LDAP_ADMIN_PASSWORD || 'admin';

    client.bind(adminDN, adminPassword, (err) => {
      if (err) {
        client.unbind();
        return res.status(500).json({ error: 'Erreur de connexion LDAP' });
      }

      const userDN = `cn=${cn},ou=${ou || 'users'},${process.env.LDAP_BASE_DN}`;
      const entry = {
        cn,
        sn,
        mail,
        uid,
        userPassword,
        objectClass: ['inetOrgPerson', 'organizationalPerson', 'person', 'top']
      };

      client.add(userDN, entry, async (addErr) => {
        if (addErr) {
          await logActivity(req.user.username, 'user_create_failed', { cn }, 'failure');
          client.unbind();
          return res.status(500).json({ error: addErr.message });
        }

        await logActivity(req.user.username, 'user_created', { cn, dn: userDN });
        client.unbind();
        res.json({ success: true, dn: userDN });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Modifier un utilisateur
app.put('/api/ldap/users/:dn', authenticateJWT, async (req, res) => {
  const dn = decodeURIComponent(req.params.dn);
  const { changes } = req.body;
  const client = createLdapClient();

  try {
    const adminDN = process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com';
    const adminPassword = process.env.LDAP_ADMIN_PASSWORD || 'admin';

    client.bind(adminDN, adminPassword, (err) => {
      if (err) {
        client.unbind();
        return res.status(500).json({ error: 'Erreur de connexion LDAP' });
      }

      const modifications = changes.map(change => 
        new ldap.Change({
          operation: change.operation || 'replace',
          modification: {
            type: change.attribute,
            values: Array.isArray(change.value) ? change.value : [change.value]
          }
        })
      );

      client.modify(dn, modifications, async (modErr) => {
        if (modErr) {
          await logActivity(req.user.username, 'user_modify_failed', { dn }, 'failure');
          client.unbind();
          return res.status(500).json({ error: modErr.message });
        }

        await logActivity(req.user.username, 'user_modified', { dn, changes });
        client.unbind();
        res.json({ success: true });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Supprimer un utilisateur
app.delete('/api/ldap/users/:dn', authenticateJWT, async (req, res) => {
  const dn = decodeURIComponent(req.params.dn);
  const client = createLdapClient();

  try {
    const adminDN = process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com';
    const adminPassword = process.env.LDAP_ADMIN_PASSWORD || 'admin';

    client.bind(adminDN, adminPassword, (err) => {
      if (err) {
        client.unbind();
        return res.status(500).json({ error: 'Erreur de connexion LDAP' });
      }

      client.del(dn, async (delErr) => {
        if (delErr) {
          await logActivity(req.user.username, 'user_delete_failed', { dn }, 'failure');
          client.unbind();
          return res.status(500).json({ error: delErr.message });
        }

        await logActivity(req.user.username, 'user_deleted', { dn });
        client.unbind();
        res.json({ success: true });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ GESTION DES GROUPES ============

// Créer un groupe
app.post('/api/ldap/groups', authenticateJWT, async (req, res) => {
  const { cn, description, member, ou } = req.body;
  const client = createLdapClient();

  try {
    const adminDN = process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com';
    const adminPassword = process.env.LDAP_ADMIN_PASSWORD || 'admin';

    client.bind(adminDN, adminPassword, (err) => {
      if (err) {
        client.unbind();
        return res.status(500).json({ error: 'Erreur de connexion LDAP' });
      }

      const groupDN = `cn=${cn},ou=${ou || 'groups'},${process.env.LDAP_BASE_DN}`;
      const entry = {
        cn,
        description,
        member: Array.isArray(member) ? member : [member],
        objectClass: ['groupOfNames', 'top']
      };

      client.add(groupDN, entry, async (addErr) => {
        if (addErr) {
          await logActivity(req.user.username, 'group_create_failed', { cn }, 'failure');
          client.unbind();
          return res.status(500).json({ error: addErr.message });
        }

        await logActivity(req.user.username, 'group_created', { cn, dn: groupDN });
        client.unbind();
        res.json({ success: true, dn: groupDN });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ LOGS ============

// Récupérer les logs d'activité
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
    res.json({ logs: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ STATS ============

app.get('/api/stats', authenticateJWT, async (req, res) => {
  const client = createLdapClient();

  try {
    const adminDN = process.env.LDAP_ADMIN_DN || 'cn=admin,dc=example,dc=com';
    const adminPassword = process.env.LDAP_ADMIN_PASSWORD || 'admin';

    client.bind(adminDN, adminPassword, (err) => {
      if (err) {
        client.unbind();
        return res.status(500).json({ error: 'Erreur de connexion LDAP' });
      }

      const baseDN = process.env.LDAP_BASE_DN || 'dc=example,dc=com';
      
      // Compter les utilisateurs
      let userCount = 0;
      client.search(baseDN, { filter: '(objectClass=inetOrgPerson)', scope: 'sub' }, (err1, res1) => {
        res1.on('searchEntry', () => userCount++);
        res1.on('end', () => {
          // Compter les groupes
          let groupCount = 0;
          client.search(baseDN, { filter: '(objectClass=groupOfNames)', scope: 'sub' }, (err2, res2) => {
            res2.on('searchEntry', () => groupCount++);
            res2.on('end', () => {
              client.unbind();
              res.json({
                users: userCount,
                groups: groupCount,
                totalEntries: userCount + groupCount
              });
            });
          });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialisation de la base de données
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

// Démarrage du serveur
app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 Serveur API démarré sur le port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});