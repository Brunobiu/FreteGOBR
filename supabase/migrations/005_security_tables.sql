-- =====================================================
-- Migration: Security Tables
-- Description: Tabelas para suporte às funcionalidades de segurança
-- Date: 2024
-- =====================================================

-- =====================================================
-- 1. Adicionar coluna session_version na tabela users
-- Usada para controle de sessão única (derruba sessões anteriores)
-- =====================================================
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS session_version INTEGER DEFAULT 1;

-- Índice para busca rápida por session_version
CREATE INDEX IF NOT EXISTS idx_users_session_version 
ON users(id, session_version);

-- =====================================================
-- 2. Tabela session_blacklist
-- Armazena tokens JWT revogados (logout, sessão expirada)
-- =====================================================
CREATE TABLE IF NOT EXISTS session_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT 'logout',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca rápida de tokens
CREATE INDEX IF NOT EXISTS idx_session_blacklist_token_hash 
ON session_blacklist(token_hash);

-- Índice para limpeza de tokens expirados
CREATE INDEX IF NOT EXISTS idx_session_blacklist_expires_at 
ON session_blacklist(expires_at);

-- RLS para session_blacklist
ALTER TABLE session_blacklist ENABLE ROW LEVEL SECURITY;

-- Apenas o sistema pode inserir/ler (via service role)
CREATE POLICY "Service role only" ON session_blacklist
    FOR ALL USING (false);

-- =====================================================
-- 3. Tabela rate_limits
-- Armazena contadores de rate limiting persistentes
-- =====================================================
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    count INTEGER DEFAULT 0,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    window_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por key
CREATE INDEX IF NOT EXISTS idx_rate_limits_key 
ON rate_limits(key);

-- Índice para limpeza de janelas expiradas
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end 
ON rate_limits(window_end);

-- RLS para rate_limits
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON rate_limits
    FOR ALL USING (false);

-- =====================================================
-- 4. Tabela login_attempts
-- Registra tentativas de login para proteção contra brute force
-- =====================================================
CREATE TABLE IF NOT EXISTS login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    success BOOLEAN DEFAULT false,
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por telefone
CREATE INDEX IF NOT EXISTS idx_login_attempts_phone 
ON login_attempts(phone);

-- Índice para busca por IP
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip 
ON login_attempts(ip_address);

-- Índice para busca por data (limpeza e análise)
CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at 
ON login_attempts(created_at);

-- RLS para login_attempts
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON login_attempts
    FOR ALL USING (false);

-- =====================================================
-- 5. Tabela account_lockouts
-- Registra bloqueios de conta por tentativas excessivas
-- =====================================================
CREATE TABLE IF NOT EXISTS account_lockouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    locked_until TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER DEFAULT 0,
    reason TEXT DEFAULT 'brute_force',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por telefone
CREATE INDEX IF NOT EXISTS idx_account_lockouts_phone 
ON account_lockouts(phone);

-- Índice para verificar bloqueios ativos
CREATE INDEX IF NOT EXISTS idx_account_lockouts_locked_until 
ON account_lockouts(locked_until);

-- RLS para account_lockouts
ALTER TABLE account_lockouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON account_lockouts
    FOR ALL USING (false);

-- =====================================================
-- 6. Tabela honeypot_triggers
-- Registra acionamentos de honeypots (detecção de bots)
-- =====================================================
CREATE TABLE IF NOT EXISTS honeypot_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    trigger_type TEXT NOT NULL, -- 'route' ou 'field'
    trigger_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por IP
CREATE INDEX IF NOT EXISTS idx_honeypot_triggers_ip 
ON honeypot_triggers(ip_address);

-- Índice para análise por tipo
CREATE INDEX IF NOT EXISTS idx_honeypot_triggers_type 
ON honeypot_triggers(trigger_type);

-- Índice para busca por data
CREATE INDEX IF NOT EXISTS idx_honeypot_triggers_created_at 
ON honeypot_triggers(created_at);

-- RLS para honeypot_triggers
ALTER TABLE honeypot_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON honeypot_triggers
    FOR ALL USING (false);

-- =====================================================
-- 7. Tabela blocked_ips
-- IPs bloqueados por atividade suspeita
-- =====================================================
CREATE TABLE IF NOT EXISTS blocked_ips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    blocked_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por IP
CREATE INDEX IF NOT EXISTS idx_blocked_ips_ip 
ON blocked_ips(ip_address);

-- Índice para verificar bloqueios ativos
CREATE INDEX IF NOT EXISTS idx_blocked_ips_blocked_until 
ON blocked_ips(blocked_until);

-- RLS para blocked_ips
ALTER TABLE blocked_ips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON blocked_ips
    FOR ALL USING (false);

-- =====================================================
-- 8. Tabela mfa_secrets (preparação para MFA futuro)
-- Armazena secrets para autenticação de dois fatores
-- =====================================================
CREATE TABLE IF NOT EXISTS mfa_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'totp', -- 'totp', 'sms', 'email'
    is_enabled BOOLEAN DEFAULT false,
    backup_codes_hash TEXT[], -- Códigos de backup hasheados
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, method)
);

-- Índice para busca por usuário
CREATE INDEX IF NOT EXISTS idx_mfa_secrets_user_id 
ON mfa_secrets(user_id);

-- RLS para mfa_secrets
ALTER TABLE mfa_secrets ENABLE ROW LEVEL SECURITY;

-- Usuário só pode ver seus próprios secrets
CREATE POLICY "Users can view own MFA" ON mfa_secrets
    FOR SELECT USING (auth.uid() = user_id);

-- Apenas service role pode modificar
CREATE POLICY "Service role can modify MFA" ON mfa_secrets
    FOR ALL USING (false);

-- =====================================================
-- 9. Funções auxiliares
-- =====================================================

-- Função para limpar dados expirados (executar via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_security_data()
RETURNS void AS $$
BEGIN
    -- Limpar tokens blacklist expirados
    DELETE FROM session_blacklist WHERE expires_at < NOW();
    
    -- Limpar rate limits expirados
    DELETE FROM rate_limits WHERE window_end < NOW() - INTERVAL '1 hour';
    
    -- Limpar login attempts antigos (manter 30 dias)
    DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '30 days';
    
    -- Limpar lockouts expirados
    DELETE FROM account_lockouts WHERE locked_until < NOW();
    
    -- Limpar honeypot triggers antigos (manter 90 dias)
    DELETE FROM honeypot_triggers WHERE created_at < NOW() - INTERVAL '90 days';
    
    -- Limpar IPs bloqueados expirados
    DELETE FROM blocked_ips WHERE blocked_until < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para verificar se IP está bloqueado
CREATE OR REPLACE FUNCTION is_ip_blocked(check_ip TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM blocked_ips 
        WHERE ip_address = check_ip 
        AND blocked_until > NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para incrementar session_version (logout de outras sessões)
CREATE OR REPLACE FUNCTION increment_session_version(target_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_version INTEGER;
BEGIN
    UPDATE users 
    SET session_version = session_version + 1 
    WHERE id = target_user_id
    RETURNING session_version INTO new_version;
    
    RETURN new_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 10. Comentários nas tabelas
-- =====================================================
COMMENT ON TABLE session_blacklist IS 'Tokens JWT revogados para invalidação de sessão';
COMMENT ON TABLE rate_limits IS 'Contadores de rate limiting persistentes';
COMMENT ON TABLE login_attempts IS 'Histórico de tentativas de login para análise de segurança';
COMMENT ON TABLE account_lockouts IS 'Contas bloqueadas por tentativas excessivas de login';
COMMENT ON TABLE honeypot_triggers IS 'Registro de acionamentos de honeypots (detecção de bots)';
COMMENT ON TABLE blocked_ips IS 'IPs bloqueados por atividade maliciosa';
COMMENT ON TABLE mfa_secrets IS 'Secrets para autenticação de dois fatores (preparação futura)';
