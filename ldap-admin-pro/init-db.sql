-- ==========================================
-- LDAP Admin Database Schema
-- PostgreSQL 15+
-- ==========================================

-- Extension pour UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Extension pour chiffrement
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- Table: activity_logs
-- Stocke tous les logs d'activité
-- ==========================================
CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    log_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    user_id VARCHAR(255),
    username VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    details JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'success',
    ip_address INET,
    user_agent TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_logs_created_at (created_at DESC),
    INDEX idx_logs_user_id (user_id),
    INDEX idx_logs_username (username),
    INDEX idx_logs_action (action),
    INDEX idx_logs_status (status),
    INDEX idx_logs_resource (resource_type, resource_id)
);

-- ==========================================
-- Table: users
-- Cache des utilisateurs LDAP pour perf
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    dn VARCHAR(500) UNIQUE NOT NULL,
    uid VARCHAR(255) UNIQUE NOT NULL,
    cn VARCHAR(255) NOT NULL,
    sn VARCHAR(255),
    mail VARCHAR(255),
    phone VARCHAR(50),
    title VARCHAR(100),
    department VARCHAR(100),
    organization VARCHAR(255),
    last_login TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    ldap_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_users_uid (uid),
    INDEX idx_users_mail (mail),
    INDEX idx_users_dn (dn),
    INDEX idx_users_active (is_active)
);

-- ==========================================
-- Table: groups
-- Cache des groupes LDAP
-- ==========================================
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    group_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    dn VARCHAR(500) UNIQUE NOT NULL,
    cn VARCHAR(255) NOT NULL,
    gid_number INTEGER,
    description TEXT,
    member_count INTEGER DEFAULT 0,
    ldap_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_groups_cn (cn),
    INDEX idx_groups_dn (dn),
    INDEX idx_groups_gid (gid_number)
);

-- ==========================================
-- Table: group_members
-- Relation many-to-many users <-> groups
-- ==========================================
CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    member_dn VARCHAR(500) NOT NULL,
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_id, user_id),
    INDEX idx_group_members_group (group_id),
    INDEX idx_group_members_user (user_id)
);

-- ==========================================
-- Table: sessions
-- Gestion des sessions JWT
-- ==========================================
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    session_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    last_activity TIMESTAMP DEFAULT NOW(),
    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_token (token_hash),
    INDEX idx_sessions_expires (expires_at),
    INDEX idx_sessions_active (revoked, expires_at)
);

-- ==========================================
-- Table: api_keys
-- Gestion des clés API pour intégrations
-- ==========================================
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    key_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    permissions JSONB DEFAULT '[]',
    rate_limit INTEGER DEFAULT 1000,
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_api_keys_hash (key_hash),
    INDEX idx_api_keys_user (user_id),
    INDEX idx_api_keys_active (is_active)
);

-- ==========================================
-- Table: ldap_schema_cache
-- Cache du schéma LDAP
-- ==========================================
CREATE TABLE IF NOT EXISTS ldap_schema_cache (
    id SERIAL PRIMARY KEY,
    object_class VARCHAR(255) UNIQUE NOT NULL,
    attributes JSONB DEFAULT '[]',
    required_attrs JSONB DEFAULT '[]',
    optional_attrs JSONB DEFAULT '[]',
    superior_class VARCHAR(255),
    description TEXT,
    cached_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_schema_class (object_class)
);

-- ==========================================
-- Table: backup_history
-- Historique des sauvegardes LDAP
-- ==========================================
CREATE TABLE IF NOT EXISTS backup_history (
    id SERIAL PRIMARY KEY,
    backup_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    backup_type VARCHAR(50) NOT NULL,
    file_path VARCHAR(500),
    file_size BIGINT,
    entry_count INTEGER,
    status VARCHAR(50) DEFAULT 'pending',
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    error_message TEXT,
    created_by VARCHAR(255),
    INDEX idx_backup_status (status),
    INDEX idx_backup_started (started_at DESC)
);

-- ==========================================
-- Table: notifications
-- Système de notifications
-- ==========================================
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    notification_uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_notifications_user (user_id),
    INDEX idx_notifications_read (is_read),
    INDEX idx_notifications_created (created_at DESC)
);

-- ==========================================
-- Table: settings
-- Paramètres de configuration
-- ==========================================
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    is_encrypted BOOLEAN DEFAULT false,
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_settings_key (key)
);

-- ==========================================
-- FONCTIONS ET TRIGGERS
-- ==========================================

-- Fonction: mise à jour automatique du timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: users
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: groups
CREATE TRIGGER update_groups_updated_at
    BEFORE UPDATE ON groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: settings
CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Fonction: nettoyage automatique des sessions expirées
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    DELETE FROM sessions
    WHERE expires_at < NOW() AND revoked = false;
END;
$$ LANGUAGE plpgsql;

-- Fonction: statistiques rapides
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS TABLE (
    total_users BIGINT,
    total_groups BIGINT,
    active_sessions BIGINT,
    today_logins BIGINT,
    failed_logins_today BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM users WHERE is_active = true),
        (SELECT COUNT(*) FROM groups),
        (SELECT COUNT(*) FROM sessions WHERE revoked = false AND expires_at > NOW()),
        (SELECT COUNT(*) FROM activity_logs WHERE action = 'login_success' AND created_at >= CURRENT_DATE),
        (SELECT COUNT(*) FROM activity_logs WHERE action = 'login_failed' AND created_at >= CURRENT_DATE);
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- DONNÉES INITIALES
-- ==========================================

-- Paramètres par défaut
INSERT INTO settings (key, value, description) VALUES
    ('ldap_sync_interval', '{"minutes": 15}', 'Intervalle de synchronisation LDAP'),
    ('session_timeout', '{"hours": 8}', 'Durée de validité des sessions'),
    ('max_login_attempts', '{"attempts": 5}', 'Nombre maximum de tentatives de connexion'),
    ('backup_retention', '{"days": 30}', 'Durée de rétention des sauvegardes'),
    ('email_notifications', '{"enabled": true}', 'Activation des notifications par email')
ON CONFLICT (key) DO NOTHING;

-- ==========================================
-- VUES UTILES
-- ==========================================

-- Vue: Activité récente
CREATE OR REPLACE VIEW recent_activity AS
SELECT
    al.id,
    al.username,
    al.action,
    al.resource_type,
    al.status,
    al.ip_address,
    al.created_at,
    u.mail as user_email
FROM activity_logs al
LEFT JOIN users u ON al.username = u.uid
ORDER BY al.created_at DESC
LIMIT 100;

-- Vue: Sessions actives
CREATE OR REPLACE VIEW active_sessions AS
SELECT
    s.id,
    s.user_id,
    u.uid,
    u.cn,
    s.ip_address,
    s.user_agent,
    s.last_activity,
    s.expires_at
FROM sessions s
INNER JOIN users u ON s.user_id = u.id
WHERE s.revoked = false AND s.expires_at > NOW()
ORDER BY s.last_activity DESC;

-- Vue: Groupes avec membres
CREATE OR REPLACE VIEW groups_with_members AS
SELECT
    g.id,
    g.cn,
    g.dn,
    g.description,
    g.member_count,
    COUNT(gm.id) as actual_member_count,
    ARRAY_AGG(u.uid) as members
FROM groups g
LEFT JOIN group_members gm ON g.id = gm.group_id
LEFT JOIN users u ON gm.user_id = u.id
GROUP BY g.id, g.cn, g.dn, g.description, g.member_count;

-- ==========================================
-- INDEX POUR PERFORMANCES
-- ==========================================

-- Index composites pour requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_logs_user_action ON activity_logs(user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_date_status ON activity_logs(created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, revoked, expires_at);

-- Index GIN pour recherche JSONB
CREATE INDEX IF NOT EXISTS idx_logs_details_gin ON activity_logs USING GIN (details);
CREATE INDEX IF NOT EXISTS idx_settings_value_gin ON settings USING GIN (value);

-- ==========================================
-- PERMISSIONS
-- ==========================================

-- Création d'un rôle lecture seule pour monitoring
CREATE ROLE readonly_monitor WITH LOGIN PASSWORD 'monitor_readonly_pass';
GRANT CONNECT ON DATABASE ldap_admin TO readonly_monitor;
GRANT USAGE ON SCHEMA public TO readonly_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_monitor;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO readonly_monitor;

-- Fin du script
SELECT 'Database schema initialized successfully!' AS status;