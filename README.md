# 🚀 LDAP Admin Pro - Solution Enterprise Complète

Interface d'administration LDAP moderne avec API Node.js, authentification JWT, logs PostgreSQL et infrastructure Docker complète.

## 📋 Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation](#utilisation)
- [API Documentation](#api-documentation)
- [Sécurité](#sécurité)
- [Monitoring](#monitoring)
- [Backup & Restore](#backup--restore)
- [Troubleshooting](#troubleshooting)

## ✨ Fonctionnalités

### Interface Web
- 🎨 Interface moderne et responsive
- 🌳 Navigation dans l'arborescence LDAP
- 👤 Gestion complète des utilisateurs
- 👥 Gestion des groupes et permissions
- 🔍 Recherche avancée avec filtres LDAP
- 📊 Tableau de bord avec statistiques temps réel
- 📝 Visualisation du schéma LDAP
- 📜 Journaux d'activité détaillés

### API Backend
- 🔐 Authentification LDAP + JWT
- 🔄 CRUD complet pour utilisateurs/groupes
- 📊 Endpoints de statistiques
- 🗃️ Logs persistants PostgreSQL
- ⚡ Cache Redis pour performances
- 🛡️ Rate limiting et sécurité
- 📈 Métriques Prometheus

### Infrastructure
- 🐳 Docker Compose complet
- 🔒 OpenLDAP avec TLS
- 💾 PostgreSQL pour logs
- 🚀 Redis pour cache
- 📊 Grafana + Prometheus
- 🌐 Nginx reverse proxy
- 📱 phpLDAPadmin inclus

## 🏗️ Architecture

```
┌─────────────┐
│   Clients   │
│ (Browsers)  │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│    Nginx    │────▶│   Frontend   │
│ (Port 80)   │     │    (HTML)    │
└──────┬──────┘     └──────────────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│  Node.js    │────▶│  PostgreSQL  │
│    API      │     │    (Logs)    │
│ (Port 3000) │     └──────────────┘
└──────┬──────┘
       │
       ├────────────┐
       ▼            ▼
┌─────────────┐ ┌──────────────┐
│  OpenLDAP   │ │    Redis     │
│ (Port 389)  │ │  (Cache)     │
└─────────────┘ └──────────────┘
```

## 📦 Prérequis

- Docker 20.10+
- Docker Compose 2.0+
- Node.js 18+ (pour développement local)
- 4GB RAM minimum
- 20GB espace disque

## 🚀 Installation

### 1. Cloner le projet

```bash
git clone https://github.com/your-org/ldap-admin-pro.git
cd ldap-admin-pro
```

### 2. Structure du projet

```
ldap-admin-pro/
├── api/
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── .env
├── frontend/
│   └── index.html
├── nginx/
│   └── nginx.conf
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/
├── init-db.sql
├── docker-compose.yml
└── README.md
```

### 3. Configuration

Copier le fichier d'environnement :

```bash
cp .env.example .env
```

Éditer `.env` et personnaliser les valeurs :

```bash
# Modifier les mots de passe en production !
JWT_SECRET=votre-secret-jwt-ultra-securise-64-caracteres-minimum
LDAP_ADMIN_PASSWORD=VotreMotDePasseLDAPSecurise123
DB_PASSWORD=VotreMotDePassePostgreSQL456
```

### 4. Lancer l'infrastructure

```bash
# Démarrer tous les services
docker-compose up -d

# Vérifier les logs
docker-compose logs -f

# Vérifier le statut
docker-compose ps
```

### 5. Initialisation LDAP

Ajouter des données de test :

```bash
# Se connecter au conteneur LDAP
docker exec -it ldap-server bash

# Ajouter une OU pour les utilisateurs
ldapadd -x -D "cn=admin,dc=example,dc=com" -w admin << EOF
dn: ou=users,dc=example,dc=com
objectClass: organizationalUnit
ou: users
EOF

# Ajouter une OU pour les groupes
ldapadd -x -D "cn=admin,dc=example,dc=com" -w admin << EOF
dn: ou=groups,dc=example,dc=com
objectClass: organizationalUnit
ou: groups
EOF

# Ajouter un utilisateur test
ldapadd -x -D "cn=admin,dc=example,dc=com" -w admin << EOF
dn: cn=test.user,ou=users,dc=example,dc=com
objectClass: inetOrgPerson
cn: test.user
sn: User
mail: test.user@example.com
uid: testuser
userPassword: password123
EOF
```

## 🔧 Configuration

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|---------|
| `LDAP_URL` | URL du serveur LDAP | `ldap://openldap:389` |
| `LDAP_BASE_DN` | DN de base | `dc=example,dc=com` |
| `LDAP_ADMIN_DN` | DN administrateur | `cn=admin,dc=example,dc=com` |
| `JWT_SECRET` | Secret pour JWT | À définir |
| `DB_HOST` | Hôte PostgreSQL | `postgres` |
| `REDIS_HOST` | Hôte Redis | `redis` |

### Ports exposés

| Service | Port | Description |
|---------|------|-------------|
| Nginx | 80, 443 | Interface web |
| API | 3000 | API REST |
| OpenLDAP | 389, 636 | LDAP/LDAPS |
| PostgreSQL | 5432 | Base de données |
| Redis | 6379 | Cache |
| phpLDAPadmin | 8080 | Interface alternative |
| Grafana | 3001 | Dashboards |
| Prometheus | 9090 | Métriques |

## 📚 API Documentation

### Authentification

#### POST /api/auth/login
Connexion avec identifiants LDAP et obtention du JWT.

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "password123"
  }'
```

Réponse :
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "username": "testuser",
    "dn": "cn=test.user,ou=users,dc=example,dc=com",
    "mail": "test.user@example.com"
  }
}
```

#### POST /api/auth/refresh
Rafraîchir le token JWT.

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Utilisateurs

#### GET /api/ldap/tree
Récupérer l'arborescence LDAP.

```bash
curl -X GET "http://localhost:3000/api/ldap/tree?baseDN=dc=example,dc=com" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### POST /api/ldap/search
Recherche LDAP avancée.

```bash
curl -X POST http://localhost:3000/api/ldap/search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "baseDN": "dc=example,dc=com",
    "filter": "(uid=*)",
    "scope": "sub",
    "attributes": ["cn", "mail", "uid"]
  }'
```

#### POST /api/ldap/users
Créer un nouvel utilisateur.

```bash
curl -X POST http://localhost:3000/api/ldap/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cn": "john.doe",
    "sn": "Doe",
    "mail": "john.doe@example.com",
    "uid": "jdoe",
    "userPassword": "SecurePass123!",
    "ou": "users"
  }'
```

#### PUT /api/ldap/users/:dn
Modifier un utilisateur.

```bash
curl -X PUT "http://localhost:3000/api/ldap/users/cn=john.doe,ou=users,dc=example,dc=com" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "changes": [
      {
        "operation": "replace",
        "attribute": "mail",
        "value": "new.email@example.com"
      }
    ]
  }'
```

#### DELETE /api/ldap/users/:dn
Supprimer un utilisateur.

```bash
curl -X DELETE "http://localhost:3000/api/ldap/users/cn=john.doe,ou=users,dc=example,dc=com" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Groupes

#### POST /api/ldap/groups
Créer un groupe.

```bash
curl -X POST http://localhost:3000/api/ldap/groups \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cn": "developers",
    "description": "Development team",
    "member": ["cn=john.doe,ou=users,dc=example,dc=com"],
    "ou": "groups"
  }'
```

### Statistiques

#### GET /api/stats
Obtenir les statistiques du système.

```bash
curl -X GET http://localhost:3000/api/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Logs

#### GET /api/logs
Récupérer les logs d'activité.

```bash
curl -X GET "http://localhost:3000/api/logs?limit=50&action=login_success" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 🔒 Sécurité

### Best Practices

1. **Changez tous les mots de passe par défaut** :
   - JWT_SECRET
   - LDAP_ADMIN_PASSWORD
   - DB_PASSWORD
   - REDIS_PASSWORD

2. **Utilisez HTTPS en production** :
   - Configurez des certificats SSL/TLS
   - Activez LDAPS (port 636)

3. **Limitez les accès réseau** :
   - Utilisez un firewall
   - Restreignez les ports exposés
   - Utilisez des réseaux Docker isolés

4. **Activez le logging** :
   - Surveillez les logs d'activité
   - Configurez des alertes

5. **Backups réguliers** :
   - LDAP (ldapsearch + export)
   - PostgreSQL (pg_dump)

### Rate Limiting

L'API implémente du rate limiting :
- Login : 5 requêtes / minute
- API générale : 100 requêtes / 15 minutes

## 📊 Monitoring

### Grafana

Accédez à Grafana : `http://localhost:3001`
- Username : `admin`
- Password : `admin`

Dashboards disponibles :
- Activité LDAP
- Performance API
- Métriques système

### Prometheus

Accédez à Prometheus : `http://localhost:9090`

Métriques disponibles :
- `http_requests_total`
- `http_request_duration_seconds`
- `ldap_operations_total`
- `db_connections_active`

## 💾 Backup & Restore

### Backup LDAP

```bash
# Export complet
docker exec ldap-server ldapsearch -x \
  -D "cn=admin,dc=example,dc=com" -w admin \
  -b "dc=example,dc=com" > backup_ldap.ldif

# Backup avec slapcat
docker exec ldap-server slapcat > backup_slapcat.ldif
```

### Backup PostgreSQL

```bash
# Dump de la base
docker exec ldap-postgres pg_dump -U admin ldap_admin > backup_db.sql

# Backup avec compression
docker exec ldap-postgres pg_dump -U admin ldap_admin | gzip > backup_db.sql.gz
```

### Restore

```bash
# Restore LDAP
docker exec -i ldap-server ldapadd -x \
  -D "cn=admin,dc=example,dc=com" -w admin < backup_ldap.ldif

# Restore PostgreSQL
docker exec -i ldap-postgres psql -U admin ldap_admin < backup_db.sql
```

## 🔧 Troubleshooting

### Le serveur LDAP ne démarre pas

```bash
# Vérifier les logs
docker-compose logs openldap

# Vérifier la configuration
docker exec ldap-server slaptest -v
```

### Erreur de connexion à PostgreSQL

```bash
# Vérifier que PostgreSQL est prêt
docker exec ldap-postgres pg_isready -U admin

# Tester la connexion
docker exec ldap-postgres psql -U admin -d ldap_admin -c "SELECT 1;"
```

### L'API ne se connecte pas au LDAP

```bash
# Tester la connexion LDAP depuis l'API
docker exec ldap-api ldapsearch -x \
  -H ldap://openldap:389 \
  -D "cn=admin,dc=example,dc=com" -w admin \
  -b "dc=example,dc=com"
```

### Problèmes de permissions

```bash
# Vérifier les volumes
docker volume ls
docker volume inspect ldap-admin-pro_ldap_data

# Recréer les volumes
docker-compose down -v
docker-compose up -d
```

## 📝 Commandes utiles

```bash
# Démarrer
docker-compose up -d

# Arrêter
docker-compose down

# Redémarrer un service
docker-compose restart api

# Voir les logs en temps réel
docker-compose logs -f api

# Nettoyer complètement
docker-compose down -v --remove-orphans

# Reconstruire les images
docker-compose build --no-cache

# Exécuter des commandes dans un conteneur
docker-compose exec api sh
docker-compose exec postgres psql -U admin ldap_admin

# Statistiques des conteneurs
docker stats
```

## 🤝 Contributing

Les contributions sont les bienvenues !

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📄 License

MIT License - voir le fichier LICENSE pour plus de détails.

## 👥 Support

- 📧 Email : support@example.com
- 💬 Discord : https://discord.gg/ldap-admin
- 📚 Documentation : https://docs.ldap-admin.example.com

---

Made with ❤️ by the LDAP Admin Pro Team