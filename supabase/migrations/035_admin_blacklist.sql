-- =====================================================
-- Migration 035: admin-blacklist
--
-- Adiciona o modulo de Blacklist do painel administrativo
-- sobre as fundacoes entregues em:
--   - 030_admin_foundation.sql (is_admin_with_permission, admin_audit_logs, log_admin_action)
--   - 031_admin_users.sql      (users.ban_reason / banned_at / banned_by)
--   - 032_admin_fretes.sql     (padrao de skip idempotente, RPCs SECURITY DEFINER)
--   - 033_embarcador_branch.sql (embarcadores.cnpj usado pelo trigger e Master_Admin check)
--
-- NOTA DE NUMERACAO: a migration 034_admin_notify_user.sql e
-- de spec independente (admin-notify). Esta migration
-- (admin-blacklist) usa o numero 035, conforme documentado
-- no tasks.md.
--
-- Componentes:
--   - Tabela admin_blacklist (12 colunas)
--   - 1 constraint chk_admin_blacklist_remove_consistency
--   - 1 indice unico parcial idx_admin_blacklist_active_unique
--   - 5 indices secundarios
--   - 4 funcoes utilitarias:
--       blacklist_normalize, blacklist_validate,
--       is_blacklisted, log_blacklist_block
--   - 5 RPCs SECURITY DEFINER:
--       admin_blacklist_add, admin_blacklist_update,
--       admin_blacklist_reactivate, admin_blacklist_remove,
--       admin_blacklist_remove_by_user
--   - 3 triggers:
--       users_blacklist_block (BEFORE INSERT em users)
--       embarcadores_blacklist_block (BEFORE INSERT em embarcadores)
--       admin_blacklist_set_updated_at (BEFORE UPDATE em admin_blacklist)
--   - 4 policies RLS em admin_blacklist
--   - Atualizacao de is_admin_with_permission para incluir
--     BLACKLIST_VIEW (SUPORTE), BLACKLIST_VIEW + BLACKLIST_MANAGE
--     (MODERADOR), BLACKLIST_VIEW + BLACKLIST_MANAGE + BLACKLIST_BULK
--     (SUPER_ADMIN). BLACKLIST_EDIT removido do SQL.
--
-- Idempotente: pode ser reaplicada sem erros.
-- Acompanhada de 035_admin_blacklist_rollback.sql.
-- =====================================================

BEGIN;

-- ========== 0. Pre-checks defensivos ==========

-- Garante que a migration 030 (admin-foundation) esta aplicada
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'is_admin_with_permission'
  ) THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) nao esta aplicada: is_admin_with_permission ausente';
  END IF;
END
$check$;

-- Garante que admin_audit_logs existe com as colunas esperadas
DO $check$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ',') INTO v_missing
  FROM (
    SELECT unnest(ARRAY['admin_id','action','target_type','target_id',
                        'before_data','after_data','ip','user_agent']) AS c
  ) needed
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_audit_logs'
      AND column_name = needed.c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 030 (admin-foundation) incompleta: admin_audit_logs sem colunas %', v_missing;
  END IF;
END
$check$;

-- Garante que embarcadores.cnpj existe (migration 033 / 016)
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='embarcadores' AND column_name='cnpj'
  ) THEN
    RAISE EXCEPTION 'Migration 033 (embarcador-branch) ou 016 nao aplicada: embarcadores.cnpj ausente';
  END IF;
END
$check$;


-- ========== 1. Tabela admin_blacklist ==========

CREATE TABLE IF NOT EXISTS admin_blacklist (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text         NOT NULL CHECK (type IN ('phone','cpf','cnpj','email','ip_address')),
  value           text         NOT NULL,
  reason          text         NOT NULL CHECK (char_length(trim(reason)) BETWEEN 1 AND 1000),
  expires_at      timestamptz  NULL,
  source_user_id  uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by      uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      timestamptz  NOT NULL DEFAULT NOW(),
  updated_at      timestamptz  NOT NULL DEFAULT NOW(),
  removed_at      timestamptz  NULL,
  removed_by      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
  removed_reason  text         NULL CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 1000)
);

ALTER TABLE admin_blacklist ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  admin_blacklist               IS 'Identificadores bloqueados de signup/login (admin-blacklist 035)';
COMMENT ON COLUMN admin_blacklist.value         IS 'Valor canonico apos blacklist_normalize. Para phone, sem prefixo 55, 10 ou 11 digitos';
COMMENT ON COLUMN admin_blacklist.source_user_id IS 'Usuario cuja conta originou a inclusao (auto-blacklist no ban). NULL para entradas manuais';
COMMENT ON COLUMN admin_blacklist.expires_at   IS 'NULL = permanente; valor futuro = expiracao programada';


-- ========== 2. Constraint de coerencia da remocao ==========

ALTER TABLE admin_blacklist DROP CONSTRAINT IF EXISTS chk_admin_blacklist_remove_consistency;
ALTER TABLE admin_blacklist ADD  CONSTRAINT chk_admin_blacklist_remove_consistency
  CHECK (
    (removed_at IS NULL     AND removed_by IS NULL     AND removed_reason IS NULL)
    OR
    (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  );


-- ========== 3. Indices ==========

-- Indice UNICO PARCIAL: garante exclusividade APENAS entre entradas ativas (CP-2)
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_blacklist_active_unique
  ON admin_blacklist (type, value) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_blacklist_type
  ON admin_blacklist(type);

CREATE INDEX IF NOT EXISTS idx_admin_blacklist_created_at
  ON admin_blacklist(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_blacklist_created_by
  ON admin_blacklist(created_by);

CREATE INDEX IF NOT EXISTS idx_admin_blacklist_expires_at
  ON admin_blacklist(expires_at) WHERE expires_at IS NOT NULL AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_blacklist_source_user_id
  ON admin_blacklist(source_user_id) WHERE source_user_id IS NOT NULL AND removed_at IS NULL;


-- ========== 4. Funcao blacklist_normalize ==========

CREATE OR REPLACE FUNCTION blacklist_normalize(p_type text, p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SECURITY INVOKER
AS $func$
DECLARE
  v_digits text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_type = 'phone' THEN
    v_digits := regexp_replace(p_raw, '\D', '', 'g');
    -- Remove DDI 55 quando o resultado tem 12 ou 13 digitos (DDI Brasil)
    IF length(v_digits) IN (12, 13) AND substring(v_digits, 1, 2) = '55' THEN
      v_digits := substring(v_digits, 3);
    END IF;
    RETURN v_digits;
  ELSIF p_type = 'cpf' THEN
    RETURN regexp_replace(p_raw, '\D', '', 'g');
  ELSIF p_type = 'cnpj' THEN
    RETURN regexp_replace(p_raw, '\D', '', 'g');
  ELSIF p_type = 'email' THEN
    RETURN lower(trim(p_raw));
  ELSIF p_type = 'ip_address' THEN
    RETURN trim(p_raw);
  ELSE
    RAISE EXCEPTION 'invalid_blacklist_type: %', p_type USING ERRCODE = 'P0001';
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION blacklist_normalize(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION blacklist_normalize(text, text) TO anon, authenticated;


-- ========== 5. Funcao blacklist_validate ==========

CREATE OR REPLACE FUNCTION blacklist_validate(p_type text, p_value text)
RETURNS text   -- 'OK' ou mensagem 'INVALID_INPUT: ...'
LANGUAGE plpgsql IMMUTABLE
SECURITY INVOKER
AS $func$
DECLARE
  v_len  int;
  v_n    int;
  v_d1   int;
  v_d2   int;
  v_sum  int;
  v_w    int[];
  v_i    int;
BEGIN
  IF p_value IS NULL OR p_value = '' THEN
    RETURN 'INVALID_INPUT: valor vazio.';
  END IF;
  v_len := length(p_value);

  IF p_type = 'phone' THEN
    IF v_len NOT IN (10, 11) OR p_value !~ '^\d+$' THEN
      RETURN 'INVALID_INPUT: Telefone deve ter 10 ou 11 digitos.';
    END IF;
    RETURN 'OK';

  ELSIF p_type = 'cpf' THEN
    IF v_len <> 11 OR p_value !~ '^\d+$' THEN
      RETURN 'INVALID_INPUT: CPF invalido.';
    END IF;
    -- rejeita sequencia repetida
    IF p_value ~ '^(\d)\1{10}$' THEN
      RETURN 'INVALID_INPUT: CPF invalido.';
    END IF;
    -- DV 1
    v_sum := 0;
    FOR v_i IN 1..9 LOOP
      v_sum := v_sum + (substring(p_value, v_i, 1)::int * (11 - v_i));
    END LOOP;
    v_d1 := (v_sum * 10) % 11;
    IF v_d1 = 10 THEN v_d1 := 0; END IF;
    IF v_d1 <> substring(p_value, 10, 1)::int THEN
      RETURN 'INVALID_INPUT: CPF invalido.';
    END IF;
    -- DV 2
    v_sum := 0;
    FOR v_i IN 1..10 LOOP
      v_sum := v_sum + (substring(p_value, v_i, 1)::int * (12 - v_i));
    END LOOP;
    v_d2 := (v_sum * 10) % 11;
    IF v_d2 = 10 THEN v_d2 := 0; END IF;
    IF v_d2 <> substring(p_value, 11, 1)::int THEN
      RETURN 'INVALID_INPUT: CPF invalido.';
    END IF;
    RETURN 'OK';

  ELSIF p_type = 'cnpj' THEN
    IF v_len <> 14 OR p_value !~ '^\d+$' THEN
      RETURN 'INVALID_INPUT: CNPJ invalido.';
    END IF;
    IF p_value ~ '^(\d)\1{13}$' THEN
      RETURN 'INVALID_INPUT: CNPJ invalido.';
    END IF;
    -- DV 1: pesos [5,4,3,2,9,8,7,6,5,4,3,2]
    v_w := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
    v_sum := 0;
    FOR v_i IN 1..12 LOOP
      v_sum := v_sum + (substring(p_value, v_i, 1)::int * v_w[v_i]);
    END LOOP;
    v_n  := v_sum % 11;
    v_d1 := CASE WHEN v_n < 2 THEN 0 ELSE 11 - v_n END;
    IF v_d1 <> substring(p_value, 13, 1)::int THEN
      RETURN 'INVALID_INPUT: CNPJ invalido.';
    END IF;
    -- DV 2: pesos [6,5,4,3,2,9,8,7,6,5,4,3,2]
    v_w := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
    v_sum := 0;
    FOR v_i IN 1..13 LOOP
      v_sum := v_sum + (substring(p_value, v_i, 1)::int * v_w[v_i]);
    END LOOP;
    v_n  := v_sum % 11;
    v_d2 := CASE WHEN v_n < 2 THEN 0 ELSE 11 - v_n END;
    IF v_d2 <> substring(p_value, 14, 1)::int THEN
      RETURN 'INVALID_INPUT: CNPJ invalido.';
    END IF;
    RETURN 'OK';

  ELSIF p_type = 'email' THEN
    IF v_len > 320 THEN
      RETURN 'INVALID_INPUT: E-mail invalido.';
    END IF;
    IF p_value !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
      RETURN 'INVALID_INPUT: E-mail invalido.';
    END IF;
    RETURN 'OK';

  ELSIF p_type = 'ip_address' THEN
    -- IPv4: 4 octetos 0..255
    IF p_value ~ '^(\d{1,3}\.){3}\d{1,3}$' THEN
      FOR v_i IN 1..4 LOOP
        v_n := split_part(p_value, '.', v_i)::int;
        IF v_n < 0 OR v_n > 255 THEN
          RETURN 'INVALID_INPUT: IP invalido.';
        END IF;
      END LOOP;
      RETURN 'OK';
    END IF;
    -- IPv6: hex + ':', 2..8 grupos
    IF p_value ~ '^[0-9a-fA-F:]+$'
       AND array_length(string_to_array(p_value, ':'), 1) BETWEEN 2 AND 8 THEN
      RETURN 'OK';
    END IF;
    RETURN 'INVALID_INPUT: IP invalido.';

  ELSE
    RETURN 'INVALID_INPUT: tipo desconhecido.';
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION blacklist_validate(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION blacklist_validate(text, text) TO authenticated;


-- ========== 6. Funcao is_blacklisted ==========

CREATE OR REPLACE FUNCTION is_blacklisted(p_type text, p_value text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT EXISTS (
    SELECT 1 FROM admin_blacklist
    WHERE type = p_type
      AND value = blacklist_normalize(p_type, p_value)
      AND removed_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$func$;

REVOKE ALL ON FUNCTION is_blacklisted(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_blacklisted(text, text) TO anon, authenticated;


-- ========== 7. Funcao log_blacklist_block ==========

CREATE OR REPLACE FUNCTION log_blacklist_block(
  p_action     text,
  p_type       text,
  p_value      text,
  p_ip         text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_normalized    text;
  v_entry_id      uuid;
  v_value_for_log text;
  v_recent_count  int;
BEGIN
  v_normalized := blacklist_normalize(p_type, p_value);

  -- Acha a entrada que matchou (pode ser NULL se ja foi removida no intervalo)
  SELECT id INTO v_entry_id
    FROM admin_blacklist
   WHERE type = p_type AND value = v_normalized AND removed_at IS NULL
   LIMIT 1;

  -- Rate limiting basico: mesmo IP so pode disparar 30 logs por minuto
  -- (defesa contra flood; se exceder, descarta silenciosamente)
  IF p_ip IS NOT NULL THEN
    SELECT COUNT(*) INTO v_recent_count
      FROM admin_audit_logs
     WHERE ip = p_ip
       AND action = p_action
       AND created_at > NOW() - INTERVAL '1 minute';
    IF v_recent_count >= 30 THEN
      RETURN;
    END IF;
  END IF;

  -- Mascaramento para audit (CPF/CNPJ): apenas 2 ultimos digitos visiveis
  v_value_for_log := CASE
    WHEN p_type = 'cpf'  AND length(v_normalized) = 11
      THEN '***.***.***-' || substring(v_normalized, 10, 2)
    WHEN p_type = 'cnpj' AND length(v_normalized) = 14
      THEN '**.***.***/****-' || substring(v_normalized, 13, 2)
    ELSE v_normalized
  END;

  INSERT INTO admin_audit_logs(
    admin_id, action, target_type, target_id,
    before_data, after_data, ip, user_agent
  ) VALUES (
    NULL,                                                -- usuario comum/anonimo: sem admin_id
    p_action, 'admin_blacklist', v_entry_id::text,
    NULL,
    jsonb_build_object('type', p_type, 'value', v_value_for_log, 'source', 'client'),
    p_ip, LEFT(coalesce(p_user_agent, ''), 512)
  );
END;
$func$;

REVOKE ALL ON FUNCTION log_blacklist_block(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_blacklist_block(text, text, text, text, text) TO anon, authenticated;


-- ========== 8. RPC admin_blacklist_add ==========

CREATE OR REPLACE FUNCTION admin_blacklist_add(
  p_type            text,
  p_value           text,
  p_reason          text,
  p_expires_at      timestamptz,
  p_source_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller           uuid := auth.uid();
  v_normalized       text;
  v_validate_msg     text;
  v_master_id        uuid;
  v_master_phone     text;
  v_master_cpf       text;
  v_master_email     text;
  v_master_cnpj      text;
  v_existing_id      uuid;
  v_existing_removed timestamptz;
  v_id               uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_blacklist_add requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('BLACKLIST_MANAGE') THEN
    RAISE EXCEPTION 'permission_denied: BLACKLIST_MANAGE required' USING ERRCODE = 'P0001';
  END IF;

  -- Validacao de campos basicos
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 1 OR char_length(trim(p_reason)) > 1000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: motivo obrigatorio (1..1000 chars)' USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'INVALID_INPUT: expires_at deve ser futuro' USING ERRCODE = 'P0001';
  END IF;

  v_normalized   := blacklist_normalize(p_type, p_value);
  v_validate_msg := blacklist_validate(p_type, v_normalized);
  IF v_validate_msg <> 'OK' THEN
    RAISE EXCEPTION '%', v_validate_msg USING ERRCODE = 'P0001';
  END IF;

  -- Master_Admin protected: identificadores do Master nunca podem ser blacklistados
  SELECT id, phone, cpf, email
    INTO v_master_id, v_master_phone, v_master_cpf, v_master_email
    FROM users WHERE admin_username = 'Nexus_Vortex99' LIMIT 1;
  IF v_master_id IS NOT NULL THEN
    SELECT cnpj INTO v_master_cnpj FROM embarcadores WHERE id = v_master_id;
    IF (p_type = 'phone' AND v_master_phone IS NOT NULL
                         AND v_normalized = blacklist_normalize('phone', v_master_phone))
    OR (p_type = 'cpf'   AND v_master_cpf   IS NOT NULL
                         AND v_normalized = blacklist_normalize('cpf',   v_master_cpf))
    OR (p_type = 'email' AND v_master_email IS NOT NULL
                         AND v_normalized = blacklist_normalize('email', v_master_email))
    OR (p_type = 'cnpj'  AND v_master_cnpj  IS NOT NULL
                         AND v_normalized = blacklist_normalize('cnpj',  v_master_cnpj))
    THEN
      RAISE EXCEPTION 'MASTER_PROTECTED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- INSERT: o indice unico parcial cuida da duplicata entre entradas ativas
  BEGIN
    INSERT INTO admin_blacklist(
      type, value, reason, expires_at, source_user_id, created_by
    ) VALUES (
      p_type, v_normalized, trim(p_reason), p_expires_at, p_source_user_id, v_caller
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Conflito: localiza a entrada ativa preexistente
    SELECT id, removed_at
      INTO v_existing_id, v_existing_removed
      FROM admin_blacklist
     WHERE type = p_type AND value = v_normalized AND removed_at IS NULL
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'ALREADY_BLACKLISTED: % (status=active)', v_existing_id
        USING ERRCODE = 'P0001';
    ELSE
      -- Houve race com outra insercao concorrente
      RAISE;
    END IF;
  END;

  RETURN jsonb_build_object('id', v_id);
END;
$func$;

REVOKE ALL ON FUNCTION admin_blacklist_add(text, text, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_blacklist_add(text, text, text, timestamptz, uuid) TO authenticated;


-- ========== 9. RPC admin_blacklist_update ==========

CREATE OR REPLACE FUNCTION admin_blacklist_update(
  p_id                  uuid,
  p_reason              text,
  p_expires_at          timestamptz,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_existing       record;
  v_new_updated_at timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_blacklist_update requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('BLACKLIST_MANAGE') THEN
    RAISE EXCEPTION 'permission_denied: BLACKLIST_MANAGE required' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 1 OR char_length(trim(p_reason)) > 1000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: motivo obrigatorio (1..1000 chars)' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM admin_blacklist WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_existing.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_REMOVED' USING ERRCODE = 'P0001';
  END IF;
  IF v_existing.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %', p_expected_updated_at, v_existing.updated_at
      USING ERRCODE = 'P0001';
  END IF;
  -- expires_at no passado so e permitido se igual ao valor atual (Req 5.6)
  IF p_expires_at IS NOT NULL
     AND p_expires_at <= NOW()
     AND p_expires_at IS DISTINCT FROM v_existing.expires_at THEN
    RAISE EXCEPTION 'INVALID_INPUT: expires_at deve ser futuro' USING ERRCODE = 'P0001';
  END IF;

  UPDATE admin_blacklist
     SET reason     = trim(p_reason),
         expires_at = p_expires_at,
         updated_at = NOW()
   WHERE id = p_id
   RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object('updated', true, 'updated_at', v_new_updated_at);
END;
$func$;

REVOKE ALL ON FUNCTION admin_blacklist_update(uuid, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_blacklist_update(uuid, text, timestamptz, timestamptz) TO authenticated;


-- ========== 10. RPC admin_blacklist_reactivate ==========

CREATE OR REPLACE FUNCTION admin_blacklist_reactivate(
  p_id                  uuid,
  p_reason              text,
  p_expires_at          timestamptz,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller         uuid := auth.uid();
  v_existing       record;
  v_other_active   uuid;
  v_new_updated_at timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_blacklist_reactivate requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('BLACKLIST_MANAGE') THEN
    RAISE EXCEPTION 'permission_denied: BLACKLIST_MANAGE required' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 1 OR char_length(trim(p_reason)) > 1000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: motivo obrigatorio (1..1000 chars)' USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'INVALID_INPUT: expires_at deve ser futuro' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM admin_blacklist WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_existing.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_VERSION: expected % got %', p_expected_updated_at, v_existing.updated_at
      USING ERRCODE = 'P0001';
  END IF;

  -- Caso ja esteja ativa, evita normalizar a constraint do indice unico parcial
  IF v_existing.removed_at IS NULL THEN
    -- Comportamento idempotente: aplica reason/expires_at e atualiza updated_at
    UPDATE admin_blacklist
       SET reason     = trim(p_reason),
           expires_at = p_expires_at,
           updated_at = NOW()
     WHERE id = p_id
     RETURNING updated_at INTO v_new_updated_at;

    RETURN jsonb_build_object('reactivated', true, 'updated_at', v_new_updated_at);
  END IF;

  -- Antes de reativar, garante que nao existe outra entrada ativa em (type, value)
  -- (cenario: enquanto a entrada estava removida, uma nova foi adicionada)
  SELECT id INTO v_other_active
    FROM admin_blacklist
   WHERE type = v_existing.type
     AND value = v_existing.value
     AND removed_at IS NULL
     AND id <> p_id
   LIMIT 1;
  IF v_other_active IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_BLACKLISTED: % (status=active)', v_other_active
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE admin_blacklist
     SET removed_at     = NULL,
         removed_by     = NULL,
         removed_reason = NULL,
         reason         = trim(p_reason),
         expires_at     = p_expires_at,
         updated_at     = NOW()
   WHERE id = p_id
   RETURNING updated_at INTO v_new_updated_at;

  RETURN jsonb_build_object('reactivated', true, 'updated_at', v_new_updated_at);
END;
$func$;

REVOKE ALL ON FUNCTION admin_blacklist_reactivate(uuid, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_blacklist_reactivate(uuid, text, timestamptz, timestamptz) TO authenticated;


-- ========== 11. RPC admin_blacklist_remove (soft delete idempotente) ==========

CREATE OR REPLACE FUNCTION admin_blacklist_remove(
  p_id            uuid,
  p_remove_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_existing record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_blacklist_remove requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('BLACKLIST_MANAGE') THEN
    RAISE EXCEPTION 'permission_denied: BLACKLIST_MANAGE required' USING ERRCODE = 'P0001';
  END IF;
  IF p_remove_reason IS NOT NULL AND char_length(p_remove_reason) > 1000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: motivo de remocao ate 1000 chars' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM admin_blacklist WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_existing.removed_at IS NOT NULL THEN
    -- Idempotente: ja removida
    RETURN jsonb_build_object('skipped', true, 'reason', 'ALREADY_REMOVED');
  END IF;

  UPDATE admin_blacklist
     SET removed_at     = NOW(),
         removed_by     = v_caller,
         removed_reason = NULLIF(trim(coalesce(p_remove_reason, '')), ''),
         updated_at     = NOW()
   WHERE id = p_id;

  RETURN jsonb_build_object('removed', true);
END;
$func$;

REVOKE ALL ON FUNCTION admin_blacklist_remove(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_blacklist_remove(uuid, text) TO authenticated;


-- ========== 12. RPC admin_blacklist_remove_by_user ==========

CREATE OR REPLACE FUNCTION admin_blacklist_remove_by_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_caller        uuid := auth.uid();
  v_removed_count int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'admin_blacklist_remove_by_user requires authenticated session';
  END IF;
  IF NOT is_admin_with_permission('BLACKLIST_MANAGE') THEN
    RAISE EXCEPTION 'permission_denied: BLACKLIST_MANAGE required' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_user_id obrigatorio' USING ERRCODE = 'P0001';
  END IF;

  UPDATE admin_blacklist
     SET removed_at     = NOW(),
         removed_by     = v_caller,
         removed_reason = 'auto-unblacklist via unban',
         updated_at     = NOW()
   WHERE source_user_id = p_user_id
     AND removed_at IS NULL;

  GET DIAGNOSTICS v_removed_count = ROW_COUNT;

  RETURN jsonb_build_object('removed_count', v_removed_count);
END;
$func$;

REVOKE ALL ON FUNCTION admin_blacklist_remove_by_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_blacklist_remove_by_user(uuid) TO authenticated;


-- ========== 13. Triggers ==========

-- Trigger function: atualiza updated_at em qualquer UPDATE em admin_blacklist
CREATE OR REPLACE FUNCTION admin_blacklist_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS admin_blacklist_set_updated_at ON admin_blacklist;
CREATE TRIGGER admin_blacklist_set_updated_at
  BEFORE UPDATE ON admin_blacklist
  FOR EACH ROW EXECUTE FUNCTION admin_blacklist_set_updated_at();


-- Trigger function: BEFORE INSERT em users (defesa em profundidade)
CREATE OR REPLACE FUNCTION users_blacklist_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_norm text;
  v_id   uuid;
BEGIN
  -- Bypass eligivel para service_role com flag de sessao explicita
  IF current_setting('app.skip_blacklist_check', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- phone (sempre presente)
  IF NEW.phone IS NOT NULL THEN
    v_norm := blacklist_normalize('phone', NEW.phone);
    SELECT id INTO v_id FROM admin_blacklist
     WHERE type = 'phone' AND value = v_norm AND removed_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, after_data)
      VALUES (NULL, 'BLACKLIST_SIGNUP_BLOCKED', 'admin_blacklist', v_id::text,
              jsonb_build_object('type', 'phone', 'value', v_norm, 'source', 'trigger'));
      RAISE EXCEPTION 'blacklisted_phone' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- cpf
  IF NEW.cpf IS NOT NULL THEN
    v_norm := blacklist_normalize('cpf', NEW.cpf);
    SELECT id INTO v_id FROM admin_blacklist
     WHERE type = 'cpf' AND value = v_norm AND removed_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, after_data)
      VALUES (NULL, 'BLACKLIST_SIGNUP_BLOCKED', 'admin_blacklist', v_id::text,
              jsonb_build_object('type', 'cpf', 'value', v_norm, 'source', 'trigger'));
      RAISE EXCEPTION 'blacklisted_cpf' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- email
  IF NEW.email IS NOT NULL THEN
    v_norm := blacklist_normalize('email', NEW.email);
    SELECT id INTO v_id FROM admin_blacklist
     WHERE type = 'email' AND value = v_norm AND removed_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, after_data)
      VALUES (NULL, 'BLACKLIST_SIGNUP_BLOCKED', 'admin_blacklist', v_id::text,
              jsonb_build_object('type', 'email', 'value', v_norm, 'source', 'trigger'));
      RAISE EXCEPTION 'blacklisted_email' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS users_blacklist_block ON users;
CREATE TRIGGER users_blacklist_block
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_blacklist_block();


-- Trigger function: BEFORE INSERT em embarcadores (verifica cnpj)
CREATE OR REPLACE FUNCTION embarcadores_blacklist_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_norm text;
  v_id   uuid;
BEGIN
  IF current_setting('app.skip_blacklist_check', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.cnpj IS NOT NULL THEN
    v_norm := blacklist_normalize('cnpj', NEW.cnpj);
    SELECT id INTO v_id FROM admin_blacklist
     WHERE type = 'cnpj' AND value = v_norm AND removed_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO admin_audit_logs(admin_id, action, target_type, target_id, after_data)
      VALUES (NULL, 'BLACKLIST_SIGNUP_BLOCKED', 'admin_blacklist', v_id::text,
              jsonb_build_object('type', 'cnpj', 'value', v_norm, 'source', 'trigger'));
      RAISE EXCEPTION 'blacklisted_cnpj' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS embarcadores_blacklist_block ON embarcadores;
CREATE TRIGGER embarcadores_blacklist_block
  BEFORE INSERT ON embarcadores
  FOR EACH ROW EXECUTE FUNCTION embarcadores_blacklist_block();


-- ========== 14. RLS Policies em admin_blacklist ==========

DROP POLICY IF EXISTS admin_blacklist_select ON admin_blacklist;
CREATE POLICY admin_blacklist_select ON admin_blacklist
  FOR SELECT TO authenticated
  USING (is_admin_with_permission('BLACKLIST_VIEW'));

DROP POLICY IF EXISTS admin_blacklist_insert ON admin_blacklist;
CREATE POLICY admin_blacklist_insert ON admin_blacklist
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_with_permission('BLACKLIST_MANAGE'));

DROP POLICY IF EXISTS admin_blacklist_update ON admin_blacklist;
CREATE POLICY admin_blacklist_update ON admin_blacklist
  FOR UPDATE TO authenticated
  USING (is_admin_with_permission('BLACKLIST_MANAGE'))
  WITH CHECK (is_admin_with_permission('BLACKLIST_MANAGE'));

-- DELETE fisico NUNCA via cliente: apenas soft delete via UPDATE
DROP POLICY IF EXISTS admin_blacklist_delete ON admin_blacklist;
CREATE POLICY admin_blacklist_delete ON admin_blacklist
  FOR DELETE TO authenticated USING (false);


-- ========== 15. Atualizacao de is_admin_with_permission ==========
--
-- Adiciona BLACKLIST_VIEW (SUPORTE), BLACKLIST_VIEW + BLACKLIST_MANAGE
-- (MODERADOR), BLACKLIST_VIEW + BLACKLIST_MANAGE + BLACKLIST_BULK
-- (SUPER_ADMIN, herdado do "OR a.role = 'SUPER_ADMIN'").
--
-- BLACKLIST_EDIT removido do SQL (era inerte: nao referenciado por
-- nenhuma policy desta migration nem das anteriores). Mantido apenas
-- como @deprecated no enum TS Permission_Matrix.
-- =====================================================

CREATE OR REPLACE FUNCTION is_admin_with_permission(p_action text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  WITH active AS (
    SELECT role
    FROM admin_roles
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1 FROM active a
    WHERE
      a.role = 'SUPER_ADMIN'
      OR (a.role = 'ADMIN' AND p_action NOT IN
           ('USER_DELETE','ADMIN_ROLE_GRANT','ADMIN_ROLE_REVOKE'))
      OR (a.role = 'FINANCEIRO' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FINANCEIRO_VIEW','FINANCEIRO_EDIT','AUDIT_VIEW'))
      OR (a.role = 'SUPORTE' AND p_action IN
           ('USER_VIEW','USER_TOGGLE_ACTIVE','FRETE_VIEW',
            'SUPORTE_VIEW','SUPORTE_REPLY','CRM_VIEW',
            'BLACKLIST_VIEW'))
      OR (a.role = 'MODERADOR' AND p_action IN
           ('USER_VIEW','FRETE_VIEW','FRETE_FORCE_CLOSE',
            'BLACKLIST_VIEW','BLACKLIST_MANAGE'))
  );
$func$;

REVOKE ALL ON FUNCTION is_admin_with_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_with_permission(text) TO authenticated;


COMMIT;

-- =====================================================
-- VERIFY: smoke test pos-deploy (executar manualmente)
-- =====================================================
/*
-- 1. Tabela admin_blacklist com 12 colunas
SELECT count(*) FROM information_schema.columns
 WHERE table_schema='public' AND table_name='admin_blacklist';
-- Esperado: 12

-- 2. Constraint
SELECT conname FROM pg_constraint
 WHERE conrelid='admin_blacklist'::regclass
   AND conname = 'chk_admin_blacklist_remove_consistency';
-- Esperado: 1 linha

-- 3. Indice unico parcial + 5 secundarios = 6 indices proprios
--    (alem do PK gerado automaticamente)
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='admin_blacklist'
   AND indexname IN ('idx_admin_blacklist_active_unique',
                     'idx_admin_blacklist_type',
                     'idx_admin_blacklist_created_at',
                     'idx_admin_blacklist_created_by',
                     'idx_admin_blacklist_expires_at',
                     'idx_admin_blacklist_source_user_id');
-- Esperado: 6 linhas

-- 4. 4 policies RLS
SELECT policyname FROM pg_policies
 WHERE schemaname='public' AND tablename='admin_blacklist'
   AND policyname IN ('admin_blacklist_select','admin_blacklist_insert',
                      'admin_blacklist_update','admin_blacklist_delete');
-- Esperado: 4 linhas

-- 5. 9 funcoes criadas/atualizadas
--    blacklist_normalize, blacklist_validate, is_blacklisted, log_blacklist_block,
--    admin_blacklist_add, admin_blacklist_update, admin_blacklist_reactivate,
--    admin_blacklist_remove, admin_blacklist_remove_by_user
SELECT proname FROM pg_proc
 WHERE proname IN ('blacklist_normalize','blacklist_validate',
                   'is_blacklisted','log_blacklist_block',
                   'admin_blacklist_add','admin_blacklist_update',
                   'admin_blacklist_reactivate','admin_blacklist_remove',
                   'admin_blacklist_remove_by_user',
                   'admin_blacklist_set_updated_at',
                   'users_blacklist_block','embarcadores_blacklist_block');
-- Esperado: 12 linhas (9 RPCs/utilitarios + 3 trigger functions)

-- 6. 3 triggers
SELECT tgname FROM pg_trigger
 WHERE tgname IN ('users_blacklist_block','embarcadores_blacklist_block',
                  'admin_blacklist_set_updated_at')
   AND NOT tgisinternal;
-- Esperado: 3 linhas

-- 7. is_admin_with_permission para SUPORTE/BLACKLIST_VIEW e MODERADOR/BLACKLIST_MANAGE
--    (executar como SUPER_ADMIN para inspecionar; aqui apenas confirma assinatura)
SELECT is_admin_with_permission('BLACKLIST_VIEW');
SELECT is_admin_with_permission('BLACKLIST_MANAGE');
SELECT is_admin_with_permission('BLACKLIST_BULK');

-- 8. Round-trip de normalizacao
SELECT blacklist_normalize('phone', '(64) 99999-9999');
-- Esperado: '64999999999'
SELECT blacklist_normalize('phone', '+55 64 99999-9999');
-- Esperado: '64999999999'
SELECT blacklist_normalize('email', '  Foo@Bar.COM ');
-- Esperado: 'foo@bar.com'

-- 9. Validacao
SELECT blacklist_validate('cpf', '11111111111');
-- Esperado: 'INVALID_INPUT: CPF invalido.'
SELECT blacklist_validate('cpf', '11144477735');
-- Esperado: 'OK'
SELECT blacklist_validate('phone', '64999999999');
-- Esperado: 'OK'

-- 10. is_blacklisted com entrada expirada NAO bloqueia
-- INSERT INTO admin_blacklist(type,value,reason,expires_at,created_by)
--   VALUES ('phone','64900000001','smoke',NOW() - INTERVAL '1 day',
--           (SELECT id FROM users WHERE admin_username='Nexus_Vortex99'));
-- SELECT is_blacklisted('phone','64900000001');
-- Esperado: false
-- ROLLBACK do teste manual.
*/
