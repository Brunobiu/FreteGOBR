-- =====================================================
-- Migration 065: Exclusão imediata de dados + bloqueio anti-reuso
--                (legal-exclusao-dados / Feature 4)
--
-- Decisões oficiais (definidas pelo produto):
--   - Exclusão é IMEDIATA (sem janela de 30 dias). Apaga tudo do usuário.
--   - Anti-reuso: ao excluir, gravamos o HASH (sha256) do CPF e do telefone
--     numa blocklist. Quem tentar recriar conta com o mesmo CPF/telefone é
--     bloqueado e orientado a "entrar em contato com o suporte".
--
-- Entrega:
--   1. Tabela `account_deletion_blocklist` (hashes de cpf/phone) + RLS deny-all.
--   2. legal_normalize_identifier()/legal_hash_identifier() — normalização +
--      hash sha256 (qualificando extensions.digest, padrão Supabase).
--   3. is_identifier_blocked(type, value)  — pré-check público (anon) p/ cadastro.
--   4. users_block_deleted_reuse()         — trigger BEFORE INSERT: barreira
--      atômica que aborta cadastro de identificador bloqueado.
--   5. rpc_delete_my_account()             — exclusão imediata do próprio
--      usuário (grava blocklist, apaga storage, public.users e auth.users).
--
-- Idempotente. Par _rollback.sql documentado.
-- =====================================================

BEGIN;

-- ========== 0. Pré-checks defensivos ==========
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='users') THEN
    RAISE EXCEPTION 'Tabela public.users ausente.';
  END IF;
END
$check$;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ========== 1. Blocklist anti-reuso ==========
CREATE TABLE IF NOT EXISTS public.account_deletion_blocklist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf_hash    text,
  phone_hash  text,
  reason      text NOT NULL DEFAULT 'account_deleted',
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_deletion_blocklist IS
  'Hashes (sha256) de CPF/telefone de contas excluidas. Impede recriacao; orienta contato com suporte. (065)';

CREATE INDEX IF NOT EXISTS idx_deletion_blocklist_cpf   ON public.account_deletion_blocklist(cpf_hash)   WHERE cpf_hash   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deletion_blocklist_phone ON public.account_deletion_blocklist(phone_hash) WHERE phone_hash IS NOT NULL;

-- RLS deny-all: a tabela só é acessada por funções SECURITY DEFINER.
ALTER TABLE public.account_deletion_blocklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deletion_blocklist_no_access ON public.account_deletion_blocklist;
CREATE POLICY deletion_blocklist_no_access ON public.account_deletion_blocklist
  FOR ALL USING (false) WITH CHECK (false);

-- ========== 2. Normalização + hash ==========
CREATE OR REPLACE FUNCTION legal_normalize_identifier(p_type text, p_value text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $func$
DECLARE
  v_norm text;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  IF p_type = 'phone' THEN
    v_norm := regexp_replace(p_value, '\D', '', 'g');
    -- Remove DDI 55 quando presente (espelha is_identifier_available).
    IF length(v_norm) IN (12, 13) AND left(v_norm, 2) = '55' THEN
      v_norm := substring(v_norm, 3);
    END IF;
  ELSIF p_type = 'cpf' THEN
    v_norm := regexp_replace(p_value, '\D', '', 'g');
  ELSE
    RAISE EXCEPTION 'invalid_identifier_type: %', p_type USING ERRCODE = 'P0001';
  END IF;
  IF v_norm IS NULL OR v_norm = '' THEN RETURN NULL; END IF;
  RETURN v_norm;
END;
$func$;

CREATE OR REPLACE FUNCTION legal_hash_identifier(p_type text, p_value text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $func$
DECLARE
  v_norm text := legal_normalize_identifier(p_type, p_value);
BEGIN
  IF v_norm IS NULL THEN RETURN NULL; END IF;
  RETURN encode(extensions.digest(v_norm, 'sha256'), 'hex');
END;
$func$;

-- ========== 3. is_identifier_blocked (pré-check público) ==========
CREATE OR REPLACE FUNCTION is_identifier_blocked(p_type text, p_value text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_hash text := legal_hash_identifier(p_type, p_value);
BEGIN
  IF v_hash IS NULL THEN RETURN false; END IF;
  IF p_type = 'phone' THEN
    RETURN EXISTS (SELECT 1 FROM account_deletion_blocklist WHERE phone_hash = v_hash);
  ELSIF p_type = 'cpf' THEN
    RETURN EXISTS (SELECT 1 FROM account_deletion_blocklist WHERE cpf_hash = v_hash);
  END IF;
  RETURN false;
END;
$func$;

COMMENT ON FUNCTION is_identifier_blocked(text, text) IS
  'Pre-check publico: identificador (phone|cpf) consta na blocklist de contas excluidas? (065)';

REVOKE ALL ON FUNCTION is_identifier_blocked(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_identifier_blocked(text, text) TO anon, authenticated;

-- ========== 4. Trigger BEFORE INSERT: barreira atômica de reuso ==========
CREATE OR REPLACE FUNCTION users_block_deleted_reuse()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
BEGIN
  IF NEW.phone IS NOT NULL AND is_identifier_blocked('phone', NEW.phone) THEN
    RAISE EXCEPTION 'account_blocked:phone' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.cpf IS NOT NULL AND is_identifier_blocked('cpf', NEW.cpf) THEN
    RAISE EXCEPTION 'account_blocked:cpf' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION users_block_deleted_reuse() IS
  'BEFORE INSERT em users: aborta cadastro de phone/cpf que consta na blocklist (065).';

DROP TRIGGER IF EXISTS users_block_deleted_reuse ON public.users;
CREATE TRIGGER users_block_deleted_reuse
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION users_block_deleted_reuse();

-- ========== 5. rpc_delete_my_account (exclusão imediata) ==========
CREATE OR REPLACE FUNCTION rpc_delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_caller   uuid := auth.uid();
  v_user     record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'permission_denied: missing auth.uid()' USING ERRCODE = '42501';
  END IF;

  SELECT id, phone, cpf, admin_username
    INTO v_user
    FROM users
   WHERE id = v_caller
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Idempotente: conta já não existe.
    RETURN jsonb_build_object('ok', true, 'already_deleted', true);
  END IF;

  -- Master Admin imutável (admin-patterns §8): nunca pode se autoexcluir.
  IF v_user.admin_username = 'Nexus_Vortex99' THEN
    RAISE EXCEPTION 'MASTER_PROTECTED' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Anti-reuso: grava hashes ANTES de apagar (CPF e telefone).
  INSERT INTO account_deletion_blocklist (cpf_hash, phone_hash, reason)
  VALUES (
    legal_hash_identifier('cpf', v_user.cpf),
    legal_hash_identifier('phone', v_user.phone),
    'account_deleted'
  );

  -- 2) Apaga arquivos do Storage do usuário (bucket documents/{uid}/...).
  DELETE FROM storage.objects
   WHERE bucket_id = 'documents'
     AND (name LIKE v_caller::text || '/%' OR name = v_caller::text);

  -- 3) Apaga a linha em public.users — cascateia motoristas/embarcadores/
  --    fretes/documents/chat/notifications/etc (FKs ON DELETE CASCADE da 001).
  DELETE FROM users WHERE id = v_caller;

  -- 4) Apaga a identidade de autenticação (impede login com as credenciais).
  DELETE FROM auth.users WHERE id = v_caller;

  RETURN jsonb_build_object('ok', true, 'already_deleted', false);
END;
$func$;

COMMENT ON FUNCTION rpc_delete_my_account() IS
  'Exclusao imediata da propria conta: grava blocklist, apaga storage, public.users e auth.users. (065)';

REVOKE ALL ON FUNCTION rpc_delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_delete_my_account() TO authenticated;

COMMIT;

-- ========== VERIFY (smoke test manual) ==========
/*
SELECT to_regclass('public.account_deletion_blocklist');
SELECT proname FROM pg_proc WHERE proname IN
  ('is_identifier_blocked','rpc_delete_my_account','users_block_deleted_reuse',
   'legal_hash_identifier','legal_normalize_identifier');
SELECT tgname FROM pg_trigger WHERE tgname='users_block_deleted_reuse';
-- Hash determinístico:
SELECT legal_hash_identifier('phone','(11) 99999-0000'),
       legal_hash_identifier('phone','5511999990000');  -- devem ser iguais
*/
