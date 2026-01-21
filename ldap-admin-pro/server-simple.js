// server-simple.js - Version ultra simple qui fonctionne
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const ldap = require('ldapjs');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// Routes de base
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working', timestamp: new Date().toISOString() });
});

// LOGIN SIMPLIFIÉ AU MAXIMUM
app.post('/api/auth/login', async (req, res) => {
  console.log('🔐 Login attempt');
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  try {
    // ÉTAPE 1: Recherche de l'utilisateur (approche simplifiée)
    console.log('Step 1: Searching user...');
    
    const searchClient = ldap.createClient({ 
      url: 'ldap://openldap:389',
      timeout: 5000
    });
    
    // Fonction utilitaire pour les promesses
    const bindAsync = (client, dn, password) => {
      return new Promise((resolve, reject) => {
        client.bind(dn, String(password), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };
    
    // Bind admin
    await bindAsync(searchClient, 'cn=admin,dc=example,dc=com', 'admin');
    console.log('Admin bind successful');
    
    // Recherche utilisateur
    const userDN = await new Promise((resolve, reject) => {
      let foundDN = null;
      
      const search = searchClient.search('dc=example,dc=com', {
        filter: `(|(uid=${username})(cn=${username}))`,
        scope: 'sub',
        attributes: ['dn']
      }, (err, searchRes) => {
        if (err) {
          searchClient.unbind();
          return reject(err);
        }
        
        searchRes.on('searchEntry', (entry) => {
          foundDN = entry.objectName.toString();
          console.log('Found user DN:', foundDN);
        });
        
        searchRes.on('error', (err) => {
          console.error('Search error:', err);
        });
        
        searchRes.on('end', () => {
          searchClient.unbind();
          if (foundDN) {
            resolve(foundDN);
          } else {
            reject(new Error('User not found'));
          }
        });
      });
    });
    
    console.log('User DN found:', userDN);
    
    // ÉTAPE 2: Authentification
    console.log('Step 2: Authenticating user...');
    
    const authClient = ldap.createClient({ 
      url: 'ldap://openldap:389',
      timeout: 5000
    });
    
    // Essayer plusieurs méthodes pour le mot de passe
    try {
      // Méthode 1: String direct
      await bindAsync(authClient, userDN, password);
    } catch (err1) {
      console.log('Method 1 failed:', err1.message);
      
      // Méthode 2: Buffer
      const authClient2 = ldap.createClient({ url: 'ldap://openldap:389' });
      try {
        await new Promise((resolve, reject) => {
          authClient2.bind(userDN, Buffer.from(String(password)), (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        authClient2.unbind();
      } catch (err2) {
        console.log('Method 2 failed:', err2.message);
        throw new Error('Authentication failed');
      }
    }
    
    authClient.unbind();
    
    console.log('✅ Authentication successful!');
    
    // Générer JWT
    const token = jwt.sign(
      { username, dn: userDN },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '8h' }
    );
    
    res.json({
      success: true,
      token,
      user: { username, dn: userDN }
    });
    
  } catch (error) {
    console.error('Login error:', error.message);
    
    let errorMessage = 'Authentication failed';
    if (error.message.includes('Invalid credentials')) {
      errorMessage = 'Invalid password';
    } else if (error.message.includes('User not found')) {
      errorMessage = 'User not found';
    }
    
    res.status(401).json({ error: errorMessage });
  }
});

// Route de test direct
app.post('/api/auth/simple-test', async (req, res) => {
  const { password } = req.body;
  
  console.log('Simple test with password:', password ? '***' : 'none');
  
  const client = ldap.createClient({ url: 'ldap://openldap:389' });
  
  try {
    await new Promise((resolve, reject) => {
      client.bind('cn=testuser,ou=users,dc=example,dc=com', String(password), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    client.unbind();
    res.json({ success: true, message: 'Direct bind worked!' });
    
  } catch (error) {
    client.unbind();
    console.error('Simple test error:', error.message);
    res.status(401).json({ success: false, error: error.message });
  }
});

// Init DB
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        action VARCHAR(100),
        details JSONB,
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ DB error:', error);
  }
};

// Start server
app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
});
